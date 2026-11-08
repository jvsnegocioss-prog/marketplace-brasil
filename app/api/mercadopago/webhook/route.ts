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

export async function POST(request: Request) {
  try {
    const secret = process.env.MERCADO_PAGO_WEBHOOK_SECRET;
    const accessToken = process.env.MERCADO_PAGO_ACCESS_TOKEN;

    if (!secret || !accessToken) {
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
      return NextResponse.json(
        { error: "Notificação incompleta." },
        { status: 400 }
      );
    }

    const parts = Object.fromEntries(
      xSignature.split(",").map((part) => {
        const [key, value] = part.trim().split("=");
        return [key, value];
      })
    );

    const ts = parts.ts;
    const receivedHash = parts.v1;

    if (!ts || !receivedHash) {
      return NextResponse.json(
        { error: "Assinatura inválida." },
        { status: 401 }
      );
    }

    const manifest =
      `id:${dataId};request-id:${requestId};ts:${ts};`;

    const expectedHash = createHmac("sha256", secret)
      .update(manifest)
      .digest("hex");

    const expectedBuffer = Buffer.from(expectedHash, "hex");
    const receivedBuffer = Buffer.from(receivedHash, "hex");

    if (
      expectedBuffer.length !== receivedBuffer.length ||
      !timingSafeEqual(expectedBuffer, receivedBuffer)
    ) {
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
      return NextResponse.json(
        { error: "Não foi possível consultar o pedido." },
        { status: 502 }
      );
    }

    const mpOrder = await mpResponse.json();

    const orderId = mpOrder.external_reference;
    const mpStatus = mpOrder.status;

    if (!orderId) {
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
        .eq("status", "Aguardando");

      if (error) {
        console.error("Erro ao atualizar pedido:", error);
        return NextResponse.json(
          { error: "Erro ao atualizar pedido." },
          { status: 500 }
        );
      }
    }

    if (
      mpStatus === "cancelled" ||
      mpStatus === "expired"
    ) {
      const { error } = await supabaseAdmin.rpc(
        "cancel_unpaid_order_and_restore_stock",
        { p_order_id: orderId }
      );

      if (error) {
        console.error("Erro ao cancelar pedido:", error);
        return NextResponse.json(
          { error: "Erro ao cancelar pedido." },
          { status: 500 }
        );
      }
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("Erro no webhook:", error);

    return NextResponse.json(
      { error: "Erro interno no webhook." },
      { status: 500 }
    );
  }
}
