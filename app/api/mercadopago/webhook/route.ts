import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createHmac } from "node:crypto";
import {
  amountToCents,
  classifyMercadoPagoOrderStatus,
  compareSignatures,
  validateProcessedPayment,
} from "@/lib/mercado-pago-webhook-helpers";
export const runtime = "nodejs";
export async function POST(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    console.error("[MP webhook] Configuração do Supabase ausente.");
    return NextResponse.json(
      { error: "Configuração do serviço indisponível." },
      { status: 503 }
    );
  }

  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  try {
    const secret = process.env.MERCADO_PAGO_WEBHOOK_SECRET;
    const accessToken = process.env.MERCADO_PAGO_ACCESS_TOKEN;
    if (!secret || !accessToken) {
      console.error("[MP webhook] Configuração ausente.");
      return NextResponse.json(
        { error: "Configuração ausente." },
        { status: 500 }
      );
    }
    const url = new URL(request.url);
    const dataId = url.searchParams.get("data.id");
    const xSignature = request.headers.get("x-signature");
    const requestId = request.headers.get("x-request-id");
    if (!dataId || !xSignature || !requestId) {
      console.warn("[MP webhook] Cabeçalhos ou identificador ausentes:", {
        hasDataId: Boolean(dataId),
        hasSignature: Boolean(xSignature),
        hasRequestId: Boolean(requestId),
      });
      return NextResponse.json(
        { error: "Notificação incompleta." },
        { status: 400 }
      );
    }
    const parts: Record<string, string> = {};
    for (const part of xSignature.split(",")) {
      const separator = part.indexOf("=");
      if (separator === -1) continue;
      const key = part.slice(0, separator).trim();
      const value = part.slice(separator + 1).trim();
      if (key && value) {
        parts[key] = value;
      }
    }
    const ts = parts.ts;
    const receivedHash = parts.v1;
    if (!ts || !receivedHash || !/^\d+$/.test(ts)) {
      console.warn("[MP webhook] Assinatura sem timestamp/hash válido.");
      return NextResponse.json(
        { error: "Assinatura inválida." },
        { status: 401 }
      );
    }

    // O Mercado Pago envia ts em milissegundos para notificações Orders.
    // Aceitamos também o formato Unix em segundos para compatibilidade
    // com outros formatos oficiais de notificação da plataforma.
    const timestampValue = Number(ts);
    const timestampMs =
      ts.length >= 13 ? timestampValue : timestampValue * 1000;
    const maxFutureClockSkewMs = 5 * 60 * 1000;
    if (
      !Number.isSafeInteger(timestampValue) ||
      !Number.isFinite(timestampMs) ||
      timestampMs > Date.now() + maxFutureClockSkewMs
    ) {
      console.warn("[MP webhook] Timestamp inválido ou excessivamente futuro.");
      return NextResponse.json(
        { error: "Timestamp inválido." },
        { status: 401 }
      );
    }

    // Não rejeita assinaturas antigas válidas: o Mercado Pago pode reenviar
    // notificações após 15 minutos ou mais. Replays não repetem efeitos porque
    // o pedido só muda se ainda estiver aguardando, e o cancelamento é atômico.

    // O Mercado Pago exige data.id em letras minúsculas
    // para identificadores alfanuméricos.
    const normalizedDataId = dataId.toLowerCase();
    const normalizedManifest =
      `id:${normalizedDataId};request-id:${requestId};ts:${ts};`;
    const normalizedHash = createHmac("sha256", secret)
      .update(normalizedManifest)
      .digest("hex");
    const signatureMatches = compareSignatures(
      normalizedHash,
      receivedHash
    );
    console.info("[MP webhook] Resultado da validação:", {
      hasDataId: true,
      dataIdLength: dataId.length,
      dataIdWasNormalized: dataId !== normalizedDataId,
      hasRequestId: true,
      requestIdLength: requestId.length,
      hasTimestamp: true,
      timestampNotTooFarInFuture: true,
      signatureMatches,
    });
    if (!signatureMatches) {
      console.error("[MP webhook] Assinatura não autorizada.");
      return NextResponse.json(
        { error: "Assinatura não autorizada." },
        { status: 401 }
      );
    }
    const mpResponse = await fetch(
      `https://api.mercadopago.com/v1/orders/${encodeURIComponent(dataId)}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        cache: "no-store",
      }
    );
    if (!mpResponse.ok) {
      console.error(
        "[MP webhook] Erro ao consultar Mercado Pago:",
        mpResponse.status
      );
      return NextResponse.json(
        { error: "Não foi possível consultar o pedido." },
        { status: 502 }
      );
    }
    const mpOrder = await mpResponse.json();
    const orderId = mpOrder.external_reference;
    const mpStatus = mpOrder.status;
    if (!orderId) {
      console.warn("[MP webhook] Notificação ignorada: sem referência externa.");
      return NextResponse.json({ received: true, ignored: true });
    }

    // A referência externa deve apontar para um pedido UUID existente
    // nesta loja. Nunca chamar RPC de estoque com uma referência arbitrária.
    const uuidPattern =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (typeof orderId !== "string" || !uuidPattern.test(orderId)) {
      console.warn("[MP webhook] Notificação ignorada: referência inválida.");
      return NextResponse.json({ received: true, ignored: true });
    }

    const { data: storeOrder, error: orderLookupError } = await supabaseAdmin
      .from("orders")
      .select("id, status, mercado_pago_order_id, total")
      .eq("id", orderId)
      .maybeSingle();

    if (orderLookupError) {
      console.error(
        "[MP webhook] Erro ao localizar pedido:",
        orderLookupError.message
      );
      return NextResponse.json(
        { error: "Não foi possível validar o pedido." },
        { status: 500 }
      );
    }

    if (!storeOrder) {
      console.warn("[MP webhook] Notificação ignorada: pedido não pertence à loja.");
      return NextResponse.json({ received: true, ignored: true });
    }

    // Se o vínculo já foi gravado, exigir que corresponda ao ID consultado
    // no Mercado Pago. Null é permitido para pedidos cujo salvamento do ID falhou.
    if (
      storeOrder.mercado_pago_order_id &&
      String(storeOrder.mercado_pago_order_id) !== String(dataId)
    ) {
      console.warn("[MP webhook] Notificação ignorada: vínculo MP divergente.");
      return NextResponse.json({ received: true, ignored: true });
    }

    if (String(mpOrder.id) !== String(dataId)) {
      console.error("[MP webhook] ID retornado pela API diverge do ID consultado.");
      return NextResponse.json(
        { error: "Identificador de pagamento divergente." },
        { status: 409 }
      );
    }

    const webhookAction = classifyMercadoPagoOrderStatus(mpStatus);

    if (webhookAction === "approve") {
      const paymentValidation = validateProcessedPayment(storeOrder.total, mpOrder);
      if (!paymentValidation.valid) {
        console.error("[MP webhook] Pagamento processado com valor, moeda ou transações divergentes.", {
          reason: paymentValidation.reason,
        });
        return NextResponse.json(
          { error: "Pagamento não corresponde integralmente ao pedido." },
          { status: 409 }
        );
      }
    }

    if (webhookAction === "reconcile") {
      // Reembolso e contestação são eventos financeiros posteriores à aprovação.
      // Persistir para conciliação administrativa; nunca devolver estoque automaticamente.
      const { error: reconciliationEventError } = await supabaseAdmin
        .from("mercado_pago_webhook_events")
        .upsert(
          {
            notification_id: requestId,
            resource_id: String(dataId),
            request_id: requestId,
            notification_type: "order",
            processing_status: "reconciliation_required",
            last_error_code: `mercado_pago_${mpStatus}`,
            last_received_at: new Date().toISOString(),
          },
          { onConflict: "notification_id" }
        );

      if (reconciliationEventError) {
        console.error("[MP webhook] Não foi possível registrar evento para conciliação:", reconciliationEventError.message);
        return NextResponse.json(
          { error: "Não foi possível registrar o evento financeiro para conciliação." },
          { status: 500 }
        );
      }

      console.error("[MP webhook] Evento financeiro registrado para reconciliação manual:", {
        orderId,
        mercadoPagoOrderId: dataId,
        paymentStatus: mpStatus,
      });
      return NextResponse.json({
        received: true,
        reconciliationRequired: true,
        paymentStatus: mpStatus,
      });
    }

    const currentStoreStatus = String(storeOrder.status).trim().toLowerCase();
    if (currentStoreStatus !== "aguardando") {
      const isCancelled = ["cancelado", "cancelada", "canceled", "cancelled"].includes(currentStoreStatus);
      if (webhookAction === "approve" && isCancelled) {
        console.error("[MP webhook] Pagamento aprovado após cancelamento; exige reconciliação manual.", {
          orderId,
          mercadoPagoOrderId: dataId,
        });
        return NextResponse.json(
          { error: "Pagamento aprovado para pedido cancelado. O caso foi sinalizado para reconciliação manual." },
          { status: 409 }
        );
      }
      console.info("[MP webhook] Pedido já finalizado; notificação sem alteração.");
      return NextResponse.json({ received: true, ignored: true });
    }

    if (webhookAction === "approve") {
      const { data: updatedOrder, error } = await supabaseAdmin
        .from("orders")
        .update({ status: "Pago" })
        .eq("id", orderId)
        .ilike("status", "aguardando")
        .select("id")
        .maybeSingle();
      if (error) {
        console.error(
          "[MP webhook] Erro ao atualizar pedido:",
          error.message
        );
        return NextResponse.json(
          { error: "Erro ao atualizar pedido." },
          { status: 500 }
        );
      }

      if (!updatedOrder) {
        const { data: latestOrder, error: latestOrderError } = await supabaseAdmin
          .from("orders")
          .select("status")
          .eq("id", orderId)
          .maybeSingle();

        if (latestOrderError) {
          console.error("[MP webhook] Não foi possível reconciliar estado após conflito:", latestOrderError.message);
          return NextResponse.json({ error: "Não foi possível confirmar o estado do pedido." }, { status: 500 });
        }

        const latestStatus = String(latestOrder?.status || "").trim().toLowerCase();
        if (["cancelado", "cancelada", "canceled", "cancelled"].includes(latestStatus)) {
          console.error("[MP webhook] Corrida entre cancelamento e aprovação; pagamento exige reconciliação manual.", {
            orderId,
            mercadoPagoOrderId: dataId,
          });
          return NextResponse.json(
            { error: "Pagamento aprovado para pedido cancelado. O caso foi sinalizado para reconciliação manual." },
            { status: 409 }
          );
        }

        if (["pago", "aprovado", "approved", "paid"].includes(latestStatus)) {
          return NextResponse.json({ received: true, alreadyProcessed: true });
        }

        return NextResponse.json(
          { error: "O estado do pedido mudou durante a confirmação do pagamento." },
          { status: 409 }
        );
      }
    }
    if (webhookAction === "cancel") {
      const { data: cancellation, error } = await supabaseAdmin.rpc(
        "cancel_unpaid_order_and_restore_stock",
        { p_order_id: orderId }
      );
      if (error) {
        console.error(
          "[MP webhook] Erro ao cancelar pedido:",
          error.message
        );
        return NextResponse.json(
          { error: "Erro ao cancelar pedido; a reconciliação do estoque continua pendente." },
          { status: 500 }
        );
      }

      const outcome = (cancellation as { outcome?: string } | null)?.outcome;
      if (outcome !== "cancelled" && outcome !== "already_restored") {
        console.error("[MP webhook] RPC não confirmou cancelamento elegível:", {
          orderId,
          outcome,
        });
        return NextResponse.json(
          { error: "O pedido não pôde ser cancelado automaticamente; requer reconciliação." },
          { status: 409 }
        );
      }
    }
    console.info("[MP webhook] Notificação processada:", {
      status: mpStatus,
    });
    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("[MP webhook] Erro interno:", error);
    return NextResponse.json(
      { error: "Erro interno no webhook." },
      { status: 500 }
    );
  }
}
