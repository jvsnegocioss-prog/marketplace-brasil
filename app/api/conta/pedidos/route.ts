import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

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

export async function GET(request: Request) {
  try {
    const authorization = request.headers.get("authorization") || "";
    const token = authorization.startsWith("Bearer ")
      ? authorization.slice(7)
      : "";

    if (!token) {
      return NextResponse.json({ error: "Acesso não autorizado." }, { status: 401 });
    }

    const { data: authData, error: authError } =
      await getSupabaseAdmin().auth.getUser(token);

    const user = authData?.user;
    if (authError || !user?.email) {
      return NextResponse.json({ error: "Sessão inválida. Entre novamente." }, { status: 401 });
    }

    const { data, error } = await getSupabaseAdmin()
      .from("orders")
      .select(`
        id,
        order_number,
        total,
        coupon_code,
        discount_amount,
        status,
        delivery_status,
        tracking_code,
        created_at,
        shipped_at,
        delivered_at,
        delivery_method,
        estimated_delivery_at,
        order_items (
          product_name,
          quantity,
          unit_price,
          subtotal
        )
      `)
      .eq("customer_email", user.email)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      console.error("ERRO AO CARREGAR HISTÓRICO DO CLIENTE:", error);
      return NextResponse.json({ error: "Não foi possível carregar seu histórico agora." }, { status: 500 });
    }

    return NextResponse.json({ orders: data || [] }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("ERRO NO HISTÓRICO DO CLIENTE:", error);
    return NextResponse.json({ error: "Ocorreu um erro ao consultar seus pedidos." }, { status: 500 });
  }
}
