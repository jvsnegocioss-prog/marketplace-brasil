import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  createHmac,
  timingSafeEqual,
} from "node:crypto";
export const runtime = "nodejs";
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);
function compareSignatures(expected: string, received: string) {
  if (!/^[a-f0-9]{64}$/i.test(received)) {
    return false;
  }
  const expectedBuffer = Buffer.from(expected, "hex");
  const receivedBuffer = Buffer.from(received, "hex");
  return (
    expectedBuffer.length === receivedBuffer.length &&
    timingSafeEqual(expectedBuffer, receivedBuffer)
  );
}
export async function POST(request: Request) {
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
    if (!ts || !receivedHash) {
      console.warn("[MP webhook] Assinatura sem ts ou v1:", {
        hasTs: Boolean(ts),
        hasV1: Boolean(receivedHash),
      });
      return NextResponse.json(
        { error: "Assinatura inválida." },
        { status: 401 }
      );
    }
    // O Mercado Pago exige data.id em letras minúsculas
    // para identificadores alfanuméricos.
    const normalizedDataId = dataId.toLowerCase();
    const normalizedManifest =
      `id:${normalizedDataId};request-id:${requestId};ts:${ts};`;
    const normalizedHash = createHmac("sha256", secret)
      .update(normalizedManifest)
      .digest("hex");
    // Comparação adicional somente para diagnóstico.
    // Esta segunda comparação NÃO autoriza o processamento.
    const originalManifest =
      `id:${dataId};request-id:${requestId};ts:${ts};`;
    const originalHash = createHmac("sha256", secret)
      .update(originalManifest)
      .digest("hex");
    const normalizedMatches = compareSignatures(
      normalizedHash,
      receivedHash
    );
    const originalMatches = compareSignatures(
      originalHash,
      receivedHash
    );
    console.info("[MP webhook] Resultado da validação:", {
      hasDataId: true,
      dataIdLength: dataId.length,
      dataIdWasNormalized: dataId !== normalizedDataId,
      hasRequestId: true,
      requestIdLength: requestId.length,
      hasTimestamp: true,
      hasSignatureHash: true,
      normalizedMatches,
      originalMatches,
    });
    if (!normalizedMatches) {
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
      console.error("[MP webhook] Pedido sem referência externa.");
      return NextResponse.json(
        { error: "Pedido sem referência externa." },
        { status: 400 }
      );
    }
    if (mpStatus === "processed") {
      const { error } = await supabaseAdmin
        .from("orders")
        .update({ status: "Pago" })
        .eq("id", orderId)
        .ilike("status", "aguardando");
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
    }
    if (
      mpStatus === "canceled" ||
      mpStatus === "failed"
    ) {
      const { error } = await supabaseAdmin.rpc(
        "cancel_unpaid_order_and_restore_stock",
        { p_order_id: orderId }
      );
      if (error) {
        console.error(
          "[MP webhook] Erro ao cancelar pedido:",
          error.message
        );
        return NextResponse.json(
          { error: "Erro ao cancelar pedido." },
          { status: 500 }
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
