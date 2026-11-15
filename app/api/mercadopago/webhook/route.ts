import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  isValidWebhookTimestamp,
  verifyMercadoPagoSignature,
  getOrderPaymentDisposition,
  getWebhookNotificationId,
  isWebhookResourceMatch,
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

export async function POST(request: Request) {
  let notificationId: string | null = null;
  let eventClaimed = false;

  const finishEvent = async (status: EventStatus, errorCode?: string) => {
    if (!notificationId || !eventClaimed) return;
    const now = new Date().toISOString();
    const { error } = await getSupabaseAdmin()
      .from("mercado_pago_webhook_events")
      .update({
        processing_status: status,
        processed_at: status === "processed" ? now : null,
        last_error_code: errorCode ?? null,
      })
      .eq("notification_id", notificationId);
    if (error) {
      console.error("[MP webhook] Não foi possível finalizar registro do evento:", error.message);
      throw new Error("Falha ao registrar resultado do evento.");
    }
    eventClaimed = false;
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
    let notificationBody: any;
    try {
      notificationBody = await request.json();
    } catch {
      return NextResponse.json({ error: "Corpo da notificação inválido." }, { status: 400 });
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

    // Claim atômico: apenas um processamento por evento. Um processamento
    // abandonado pode ser retomado após cinco minutos sem atualização.
    const staleBefore = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const { data: claimedEvent, error: claimError } = await supabase
      .from("mercado_pago_webhook_events")
      .update({
        processing_status: "processing",
        last_received_at: new Date().toISOString(),
        last_error_code: null,
      })
      .eq("notification_id", notificationId)
      .or(`processing_status.in.(received,failed),and(processing_status.eq.processing,last_received_at.lt.${staleBefore})`)
      .select("notification_id")
      .maybeSingle();

    if (claimError) {
      console.error("[MP webhook] Erro ao reivindicar evento:", claimError.message);
      return NextResponse.json({ error: "Não foi possível iniciar o processamento." }, { status: 500 });
    }
    if (!claimedEvent) {
      const { data: latestEvent } = await supabase
        .from("mercado_pago_webhook_events")
        .select("processing_status")
        .eq("notification_id", notificationId)
        .maybeSingle();
      if (latestEvent?.processing_status === "processed") {
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

    if (disposition === "review") {
      const currentStatus = String(storeOrder.status).trim().toLowerCase();
      if (!["em contestação", "reembolsado"].includes(currentStatus)) {
        const { error: reviewError } = await supabase
          .from("orders")
          .update({ status: "Revisão necessária" })
          .eq("id", orderId);
        if (reviewError) {
          await finishEvent("failed", "manual_review_status_update_failed");
          return NextResponse.json({ error: "Não foi possível sinalizar o pedido para revisão manual." }, { status: 500 });
        }
      }
      await finishEvent("processed", "payment_state_requires_manual_review");
      return NextResponse.json({ received: true, reviewRequired: true });
    }

    if (disposition === "chargeback") {
      const { error: chargebackError } = await supabase
        .from("orders")
        .update({ status: "Em contestação" })
        .eq("id", orderId);
      if (chargebackError) {
        await finishEvent("failed", "chargeback_status_update_failed");
        return NextResponse.json({ error: "Não foi possível atualizar a contestação." }, { status: 500 });
      }
      await finishEvent("processed", "chargeback_requires_manual_review");
      return NextResponse.json({ received: true, reviewRequired: true });
    }

    if (disposition === "refunded" || disposition === "partial_refund") {
      const refundStatus = disposition === "refunded" ? "Reembolsado" : "Reembolso parcial";
      const currentStatus = String(storeOrder.status).trim().toLowerCase();
      if (currentStatus !== "em contestação" && currentStatus !== "revisão necessária") {
        const { error: refundError } = await supabase
          .from("orders")
          .update({ status: refundStatus })
          .eq("id", orderId);
        if (refundError) {
          await finishEvent("failed", "refund_status_update_failed");
          return NextResponse.json({ error: "Não foi possível atualizar o reembolso." }, { status: 500 });
        }
      }
      await finishEvent("processed", disposition === "refunded" ? "full_refund_recorded" : "partial_refund_recorded");
      return NextResponse.json({ received: true, reviewRequired: disposition === "partial_refund" });
    }

    if (disposition === "not_paid") {
      const { data: canceled, error: cancelError } = await supabase.rpc("cancel_unpaid_order_and_restore_stock", {
        p_order_id: orderId,
      });
      if (cancelError) {
        await finishEvent("failed", "store_order_cancel_failed");
        console.error("[MP webhook] Erro ao cancelar pedido:", cancelError.message);
        return NextResponse.json({ error: "Erro ao cancelar pedido." }, { status: 500 });
      }

      if (canceled !== true) {
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
        const { error: reviewError } = await supabase
          .from("orders")
          .update({ status: "Revisão necessária" })
          .eq("id", orderId)
          .in("status", ["Cancelado", "cancelada", "canceled"]);
        if (reviewError) {
          await finishEvent("failed", "late_payment_review_update_failed");
          return NextResponse.json({ error: "Não foi possível sinalizar pagamento após cancelamento." }, { status: 500 });
        }
        await finishEvent("processed", "payment_received_after_order_cancel");
        return NextResponse.json({ received: true, reviewRequired: true });
      }

      if (currentStatus !== "aguardando") {
        await finishEvent("ignored", "store_order_already_finalized");
        return NextResponse.json({ received: true, ignored: true });
      }

      const { data: paidOrder, error } = await supabase
        .from("orders")
        .update({ status: "Pago" })
        .eq("id", orderId)
        .ilike("status", "aguardando")
        .select("id")
        .maybeSingle();

      if (error) {
        await finishEvent("failed", "store_order_payment_update_failed");
        console.error("[MP webhook] Erro ao atualizar pedido:", error.message);
        return NextResponse.json({ error: "Erro ao atualizar pedido." }, { status: 500 });
      }

      if (!paidOrder) {
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
          const { error: reviewError } = await supabase
            .from("orders")
            .update({ status: "Revisão necessária" })
            .eq("id", orderId)
            .in("status", ["Cancelado", "cancelada", "canceled"]);
          if (reviewError) {
            await finishEvent("failed", "late_payment_review_update_failed");
            return NextResponse.json({ error: "Não foi possível sinalizar pagamento após cancelamento." }, { status: 500 });
          }
          await finishEvent("processed", "payment_received_after_order_cancel");
          return NextResponse.json({ received: true, reviewRequired: true });
        }

        if (latestStatus !== "aguardando") {
          await finishEvent("ignored", "store_order_finalized_during_payment_update");
          return NextResponse.json({ received: true, ignored: true });
        }

        await finishEvent("failed", "store_order_payment_update_not_applied");
        return NextResponse.json({ error: "Atualização do pagamento não foi aplicada." }, { status: 503 });
      }

      await finishEvent("processed");
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
