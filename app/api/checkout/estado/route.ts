import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createHmac, timingSafeEqual } from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function paymentState(status: string) {
  const normalized = status.trim().toLowerCase();
  if (["pago", "aprovado", "approved", "paid"].includes(normalized)) return "approved";
  if (["cancelado", "cancelada", "canceled", "cancelled", "failed"].includes(normalized)) return "cancelled";
  if (["aguardando", "pendente", "pending", "processing"].includes(normalized)) return "pending";
  return "under_review";
}

export async function GET(request: Request) {
  const authorization = request.headers.get("authorization") || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  const params = new URL(request.url).searchParams;
  const orderId = params.get("pedido") || "";
  const suppliedSignature = params.get("verificacao") || "";

  if (!UUID_PATTERN.test(orderId)) {
    return NextResponse.json({ error: "Referência de pedido inválida." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const mercadoPagoAccessToken = process.env.MERCADO_PAGO_ACCESS_TOKEN;
  if (!supabaseUrl || !serviceRoleKey || !mercadoPagoAccessToken) {
    return NextResponse.json({ error: "Consulta temporariamente indisponível." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }

  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    const expectedSignature = createHmac("sha256", mercadoPagoAccessToken)
      .update(`novashopp-checkout-return:${orderId}`)
      .digest("hex");
    const signatureBuffer = Buffer.from(suppliedSignature, "hex");
    const expectedBuffer = Buffer.from(expectedSignature, "hex");
    const validSignedReturn =
      /^[0-9a-f]{64}$/i.test(suppliedSignature) &&
      signatureBuffer.length === expectedBuffer.length &&
      timingSafeEqual(signatureBuffer, expectedBuffer);

    let authenticatedUserId: string | null = null;
    if (token) {
      const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(token);
      authenticatedUserId = authError ? null : authData.user?.id || null;
    }

    if (!validSignedReturn && !authenticatedUserId) {
      return NextResponse.json({ error: "Não foi possível validar o acesso a este pedido. Entre na sua conta ou use o link original de retorno." }, { status: 401, headers: { "Cache-Control": "no-store" } });
    }

    // O link assinado permite retorno seguro também para compras como visitante.
    // Se houver sessão autenticada, ela deve pertencer ao titular do pedido.
    let orderQuery = supabaseAdmin
      .from("orders")
      .select("id, order_number, status, delivery_status, created_at, customer_user_id")
      .eq("id", orderId);
    if (authenticatedUserId) {
      orderQuery = orderQuery.eq("customer_user_id", authenticatedUserId);
    }
    const { data: order, error } = await orderQuery.maybeSingle();

    if (error) {
      console.error("[checkout status] Falha ao consultar pedido:", error.message);
      return NextResponse.json({ error: "Não foi possível consultar o pedido agora." }, { status: 500, headers: { "Cache-Control": "no-store" } });
    }

    if (!order) {
      return NextResponse.json({ error: "Pedido não encontrado para esta conta." }, { status: 404, headers: { "Cache-Control": "no-store" } });
    }

    return NextResponse.json({
      order: {
        orderId: order.id,
        orderNumber: order.order_number,
        orderStatus: order.status,
        paymentState: paymentState(String(order.status || "")),
        deliveryStatus: order.delivery_status,
        createdAt: order.created_at,
      },
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[checkout status] Erro inesperado:", error);
    return NextResponse.json({ error: "Não foi possível consultar o pedido agora." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
