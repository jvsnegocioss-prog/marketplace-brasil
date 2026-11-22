import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

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
  if (!token) {
    return NextResponse.json({ error: "Entre na sua conta para consultar este pedido." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }

  const orderId = new URL(request.url).searchParams.get("pedido") || "";
  if (!UUID_PATTERN.test(orderId)) {
    return NextResponse.json({ error: "Referência de pedido inválida." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json({ error: "Consulta temporariamente indisponível." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }

  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(token);
    const userId = authData.user?.id;
    if (authError || !userId) {
      return NextResponse.json({ error: "Sua sessão expirou. Entre novamente." }, { status: 401, headers: { "Cache-Control": "no-store" } });
    }

    // A referência recebida na URL serve apenas para localizar o pedido.
    // A autorização depende exclusivamente do vínculo customer_user_id validado no servidor.
    const { data: order, error } = await supabaseAdmin
      .from("orders")
      .select("id, order_number, status, delivery_status, created_at")
      .eq("id", orderId)
      .eq("customer_user_id", userId)
      .maybeSingle();

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
