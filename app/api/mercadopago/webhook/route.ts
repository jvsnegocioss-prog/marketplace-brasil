import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import {
  isValidWebhookTimestamp,
  verifyMercadoPagoSignature,
  getOrderPaymentDisposition,
  getWebhookNotificationId,
  isWebhookResourceMatch,
  isWebhookNotificationResourceMatch,
} from "@/lib/mercadopago-security.cjs";

export const runtime = "nodejs";
let supabaseAdmin: ReturnType<typeof createClient<any>> | null = null;

function getSupabaseAdmin() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Configuração do Supabase indisponível.");
  }
  if (!supabaseAdmin) {
    supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return supabaseAdmin;
}

type EventStatus = "processed" | "ignored" | "failed";

async function readLimitedWebhookJson(request: Request): Promise<{ ok: true; value: unknown } | { ok: false; tooLarge: boolean }> {
  if (!request.body) return { ok: false, tooLarge: false };
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let totalBytes = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > 16_384) {
        await reader.cancel();
        return { ok: false, tooLarge: true };
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, tooLarge: false };
  } finally {
    reader.releaseLock();
  }
}

export async function POST(request: Request) {
  let notificationId: string | null = null;
  let eventClaimed = false;
  let claimToken: string | null = null;

  const finishEvent = async (
    status: EventStatus,
    errorCode?: string,
    orderAction: "none" | "set_status" | "cancel_unpaid" = "none",
    orderId?: string,
    orderStatus?: string,
    allowedCurrentStatuses?: string[] | null
  ) => {
    if (!notificationId || !eventClaimed || !claimToken) return null;
    const { data, error } = await getSupabaseAdmin().rpc(
      "finalize_mercado_pago_webhook_event",
      {
        p_notification_id: notificationId,
        p_processing_token: claimToken,
        p_final_status: status,
        p_error_code: errorCode ?? null,
        p_order_id: orderId ?? null,
        p_order_action: orderAction,
        p_order_status: orderStatus ?? null,
        p_allowed_current_statuses: allowedCurrentStatuses ?? null,
      }
    ).maybeSingle();

    if (error) {
      console.error("[MP webhook] Não foi possível finalizar atomicamente o evento:", error.message);
      throw new Error("Falha ao registrar resultado do evento.");
    }
    const result = data as { finalized: boolean; order_updated: boolean; order_cancelled: boolean } | null;
    if (!result?.finalized) {
      console.warn("[MP webhook] Reserva perdida ou alteração do pedido não aplicada.", { notificationId });
      return null;
    }
    eventClaimed = false;
    return result;
  };

  try {
    const secret = process.env.MERCADO_PAGO_WEBHOOK_SECRET;
    const accessToken = process.env.MERCADO_PAGO_ACCESS_TOKEN;
    if (!secret || !accessToken) {
      console.error("[MP webhook] Configuração ausente.");
      return NextResponse.json({ error: "Configuração ausente." }, { status: 500 });
    }

    const url = new URL(request.url);
    const dataId = url.searchParams.get("data.id");
    const xSignature = request.headers.get("x-signature");
    const requestId = request.headers.get("x-request-id");
    if (!dataId || !xSignature || !requestId) {
      return NextResponse.json({ error: "Notificação incompleta." }, { status: 400 });
    }

    const parts: Record<string, string> = {};
    for (const part of xSignature.split(",")) {
      const separator = part.indexOf("=");
      if (separator === -1) continue;
      const key = part.slice(0, separator).trim();
      const value = part.slice(separator + 1).trim();
      if (key && value) parts[key] = value;
    }

    const ts = parts.ts;
    const receivedHash = parts.v1;
    if (!ts || !receivedHash || !/^\d+$/.test(ts) || !isValidWebhookTimestamp(ts)) {
      return NextResponse.json({ error: "Timestamp ou assinatura inválida." }, { status: 401 });
    }

    const signatureMatches = verifyMercadoPagoSignature(secret, dataId, requestId, ts, receivedHash);
    if (!signatureMatches) {
      console.warn("[MP webhook] Assinatura não autorizada.");
      return NextResponse.json({ error: "Assinatura não autorizada." }, { status: 401 });
    }

    // O ID único do evento só é aceito depois da validação HMAC.
    // Webhooks têm payload pequeno; limite o corpo para evitar consumo excessivo de memória.
    const contentLength = Number(request.headers.get("content-length") || 0);
    if (Number.isFinite(contentLength) && contentLength > 16_384) {
      return NextResponse.json({ error: "Notificação muito grande." }, { status: 413, headers: { "Cache-Control": "no-store" } });
    }
    const parsedNotification = await readLimitedWebhookJson(request);
    if (!parsedNotification.ok) {
      return NextResponse.json(
        { error: parsedNotification.tooLarge ? "Notificação muito grande." : "Corpo da notificação inválido." },
        { status: parsedNotification.tooLarge ? 413 : 400, headers: { "Cache-Control": "no-store" } }
      );
    }
    const notificationBody: any = parsedNotification.value;
    // A assinatura autentica o data.id da URL; confirme que o corpo aponta
    // para exatamente o mesmo recurso antes de registrar/processar o evento.
    if (!isWebhookNotificationResourceMatch(notificationBody, dataId)) {
      return NextResponse.json({ error: "O recurso do corpo não corresponde ao recurso assinado." }, { status: 400 });
    }

    notificationId = getWebhookNotificationId(notificationBody);
    if (!notificationId) {
      return NextResponse.json({ error: "ID único da notificação ausente ou inválido." }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const eventRecord = {
      notification_id: notificationId,
      resource_id: dataId,
      request_id: requestId,
      notification_type: typeof notificationBody?.type === "string" ? notificationBody.type.slice(0, 100) : null,
      action: typeof notificationBody?.action === "string" ? notificationBody.action.slice(0, 100) : null,
    };

    const { data: existingEventData, error: eventRegistrationError } = await supabase
      .rpc("register_mercado_pago_webhook_delivery", {
        p_notification_id: eventRecord.notification_id,
        p_resource_id: eventRecord.resource_id,
        p_request_id: eventRecord.request_id,
        p_notification_type: eventRecord.notification_type,
        p_action: eventRecord.action,
      })
      .maybeSingle();

    const existingEvent = existingEventData as {
      resource_id: string;
      processing_status: string;
      delivery_count: number;
    } | null;

    if (eventRegistrationError) {
      console.error("[MP webhook] Erro ao registrar entrega da notificação:", eventRegistrationError.message);
      return NextResponse.json({ error: "Não foi possível registrar a notificação." }, { status: 500 });
    }

    if (!existingEvent) {
      console.warn("[MP webhook] ID de notificação reutilizado para recurso diferente.", {
        notificationId,
      });
      return NextResponse.json({ error: "ID da notificação associado a outro recurso." }, { status: 409 });
    }

    if (existingEvent.processing_status === "processed" || existingEvent.processing_status === "ignored") {
      return NextResponse.json({ received: true, duplicate: true, ignored: existingEvent.processing_status === "ignored" });
    }

    // A reserva é controlada no banco e tem token próprio. Entregas
    // repetidas não alteram o relógio da reserva em andamento.
    claimToken = randomUUID();
    const { data: claimData, error: claimError } = await supabase
      .rpc("claim_mercado_pago_webhook_event", {
        p_notification_id: notificationId,
        p_processing_token: claimToken,
      })
      .maybeSingle();

    if (claimError) {
      console.error("[MP webhook] Erro ao reivindicar evento:", claimError.message);
      return NextResponse.json({ error: "Não foi possível iniciar o processamento." }, { status: 500 });
    }
    const claimedEvent = claimData as { claimed: boolean; processing_status: string | null } | null;
    if (!claimedEvent?.claimed) {
      const { data: latestEvent } = await supabase
        .from("mercado_pago_webhook_events")
        .select("processing_status")
        .eq("notification_id", notificationId)
        .maybeSingle();
      if (latestEvent?.processing_status === "processed" || latestEvent?.processing_status === "ignored") {
        return NextResponse.json({ received: true, duplicate: true });
      }
      return NextResponse.json({ error: "Notificação já está sendo processada; tente novamente." }, { status: 503 });
    }
    eventClaimed = true;

    const mpResponse = await fetch(
      `https://api.mercadopago.com/v1/orders/${encodeURIComponent(dataId)}`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      }
    );

    if (!mpResponse.ok) {
      await finishEvent("failed", `mp_lookup_${mpResponse.status}`);
      return NextResponse.json({ error: "Não foi possível consultar o pedido." }, { status: 502 });
    }

    const mpOrder = await mpResponse.json();
    const orderId = mpOrder.external_reference;

    if (!orderId) {
      await finishEvent("ignored", "missing_external_reference");
      return NextResponse.json({ received: true, ignored: true });
    }

    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (typeof orderId !== "string" || !uuidPattern.test(orderId)) {
      await finishEvent("ignored", "invalid_external_reference");
      return NextResponse.json({ received: true, ignored: true });
    }

    const { data: storeOrderData, error: orderLookupError } = await supabase
      .from("orders")
      .select("id, status, mercado_pago_order_id, total")
      .eq("id", orderId)
      .maybeSingle();

    const storeOrder = storeOrderData as {
      id: string;
      status: string;
      mercado_pago_order_id: string | null;
      total: number | string;
    } | null;

    if (orderLookupError) {
      await finishEvent("failed", "store_order_lookup_failed");
      console.error("[MP webhook] Erro ao localizar pedido:", orderLookupError.message);
      return NextResponse.json({ error: "Não foi possível validar o pedido." }, { status: 500 });
    }

    if (!storeOrder) {
      await finishEvent("ignored", "store_order_not_found");
      return NextResponse.json({ received: true, ignored: true });
    }

    if (!isWebhookResourceMatch(storeOrder.mercado_pago_order_id, String(dataId))) {
      await finishEvent("failed", "mercado_pago_order_id_missing_or_mismatch");
      console.warn("[MP webhook] ID do pedido Mercado Pago ausente ou divergente.", {
        orderId,
      });
      return NextResponse.json({ error: "O pagamento não está vinculado ao pedido esperado." }, { status: 409 });
    }

    if (String(mpOrder.id) !== String(dataId)) {
      await finishEvent("failed", "resource_id_mismatch");
      return NextResponse.json({ error: "Identificador de pagamento divergente." }, { status: 409 });
    }

    const disposition = getOrderPaymentDisposition(storeOrder.total, mpOrder);

    if (disposition === "review" || disposition === "chargeback_resolved") {
      const currentStatus = String(storeOrder.status).trim().toLowerCase();
      if (disposition === "chargeback_resolved" || !["em contestação", "reembolsado"].includes(currentStatus)) {
        const result = await finishEvent("processed", "payment_state_requires_manual_review", "set_status", orderId, "Revisão necessária", [storeOrder.status]);
        if (!result) return NextResponse.json({ error: "A reserva do evento expirou antes da atualização." }, { status: 503 });
        return NextResponse.json({ received: true, reviewRequired: true });
      }
      await finishEvent("processed", "payment_state_requires_manual_review");
      return NextResponse.json({ received: true, reviewRequired: true });
    }

    if (disposition === "chargeback") {
      const result = await finishEvent("processed", "chargeback_requires_manual_review", "set_status", orderId, "Em contestação", [storeOrder.status]);
      if (!result) return NextResponse.json({ error: "A reserva do evento expirou antes da atualização." }, { status: 503 });
      return NextResponse.json({ received: true, reviewRequired: true });
    }

    if (disposition === "refunded" || disposition === "partial_refund") {
      const refundStatus = disposition === "refunded" ? "Reembolsado" : "Reembolso parcial";
      const currentStatus = String(storeOrder.status).trim().toLowerCase();
      if (currentStatus !== "em contestação" && currentStatus !== "revisão necessária") {
        const result = await finishEvent("processed", disposition === "refunded" ? "full_refund_recorded" : "partial_refund_recorded", "set_status", orderId, refundStatus, [storeOrder.status]);
        if (!result) return NextResponse.json({ error: "A reserva do evento expirou ou o estado do pedido mudou." }, { status: 503 });
      }
      if (currentStatus === "em contestação" || currentStatus === "revisão necessária") {
        await finishEvent("processed", disposition === "refunded" ? "full_refund_recorded" : "partial_refund_recorded");
      }
      return NextResponse.json({ received: true, reviewRequired: disposition === "partial_refund" });
    }

    if (disposition === "not_paid") {
      const cancelResult = await finishEvent("processed", undefined, "cancel_unpaid", orderId);
      if (cancelResult?.order_cancelled) {
        return NextResponse.json({ received: true });
      }
      if (!eventClaimed) {
        return NextResponse.json({ error: "A reserva do evento expirou." }, { status: 503 });
      }
      if (!cancelResult?.order_cancelled) {
        const { data: latestOrder, error: latestOrderError } = await supabase
          .from("orders")
          .select("status")
          .eq("id", orderId)
          .maybeSingle();
        if (latestOrderError || !latestOrder) {
          await finishEvent("failed", "store_order_cancel_state_lookup_failed");
          return NextResponse.json({ error: "Não foi possível confirmar o estado do pedido." }, { status: 500 });
        }
        const latestStatus = String(latestOrder.status).trim().toLowerCase();
        if (latestStatus === "aguardando") {
          await finishEvent("failed", "store_order_cancel_not_applied");
          return NextResponse.json({ error: "O cancelamento ainda não foi aplicado." }, { status: 503 });
        }
      }
      await finishEvent("processed");
      return NextResponse.json({ received: true });
    }

    if (disposition === "paid") {
      const currentStatus = String(storeOrder.status).trim().toLowerCase();
      if (currentStatus === "cancelado" || currentStatus === "cancelada" || currentStatus === "canceled") {
        const result = await finishEvent("processed", "payment_received_after_order_cancel", "set_status", orderId, "Revisão necessária", [storeOrder.status]);
        if (!result) return NextResponse.json({ error: "A reserva expirou ou o estado do pedido mudou." }, { status: 503 });
        return NextResponse.json({ received: true, reviewRequired: true });
      }

      if (currentStatus !== "aguardando") {
        await finishEvent("ignored", "store_order_already_finalized");
        return NextResponse.json({ received: true, ignored: true });
      }

      const paidResult = await finishEvent("processed", undefined, "set_status", orderId, "Pago", ["aguardando"]);

      if (!paidResult?.order_updated) {
        const { data: latestOrder, error: latestOrderError } = await supabase
          .from("orders")
          .select("status")
          .eq("id", orderId)
          .maybeSingle();

        if (latestOrderError || !latestOrder) {
          await finishEvent("failed", "store_order_payment_state_lookup_failed");
          return NextResponse.json({ error: "Não foi possível confirmar o estado do pedido." }, { status: 500 });
        }

        const latestStatus = String(latestOrder.status).trim().toLowerCase();
        if (latestStatus === "cancelado" || latestStatus === "cancelada" || latestStatus === "canceled") {
          const result = await finishEvent("processed", "payment_received_after_order_cancel", "set_status", orderId, "Revisão necessária", ["Cancelado", "cancelada", "canceled"]);
          if (!result) return NextResponse.json({ error: "A reserva expirou ou o estado do pedido mudou." }, { status: 503 });
          return NextResponse.json({ received: true, reviewRequired: true });
        }

        if (latestStatus !== "aguardando") {
          await finishEvent("ignored", "store_order_finalized_during_payment_update");
          return NextResponse.json({ received: true, ignored: true });
        }

        await finishEvent("failed", "store_order_payment_update_not_applied");
        return NextResponse.json({ error: "Atualização do pagamento não foi aplicada." }, { status: 503 });
      }

      if (eventClaimed) await finishEvent("ignored", "store_order_finalized_during_payment_update");
      return NextResponse.json({ received: true });
    }

    await finishEvent("ignored", "unsupported_payment_status");
    return NextResponse.json({ received: true, ignored: true });
  } catch (error) {
    if (notificationId && eventClaimed) {
      try {
        await finishEvent("failed", "unexpected_webhook_error");
      } catch {
        // Mantém o erro original; o evento poderá ser retomado após o lease.
      }
    }
    console.error("[MP webhook] Erro interno:", error);
    return NextResponse.json({ error: "Erro interno no webhook." }, { status: 500 });
  }
}
