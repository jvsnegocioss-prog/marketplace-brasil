import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const authorization = request.headers.get("authorization") || "";
    const token = authorization.startsWith("Bearer ")
      ? authorization.slice(7)
      : "";

    if (!token) {
      return NextResponse.json({ error: "Acesso não autorizado." }, { status: 401 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseAnonKey) {
      console.error("CONFIGURAÇÃO PÚBLICA DO SUPABASE AUSENTE NO AMBIENTE.");
      return NextResponse.json(
        { error: "Histórico temporariamente indisponível." },
        { status: 503 }
      );
    }

    // Consulta em nome do cliente autenticado. O JWT ativa as políticas RLS
    // existentes, que limitam orders e order_items ao próprio customer_user_id.
    // Não depende da chave privilegiada service_role.
    const supabaseUser = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: authData, error: authError } =
      await supabaseUser.auth.getUser(token);

    const user = authData?.user;
    if (authError || !user?.id) {
      return NextResponse.json({ error: "Sessão inválida. Entre novamente." }, { status: 401 });
    }

    const { data, error } = await supabaseUser
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
      .eq("customer_user_id", user.id)
      .in("status", ["Pago", "pago", "Aprovado", "aprovado", "approved", "paid"])
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      console.error("ERRO AO CARREGAR HISTÓRICO DO CLIENTE:", error);
      return NextResponse.json({ error: "Não foi possível carregar seu histórico agora." }, { status: 500 });
    }

    return NextResponse.json({ orders: data || [] });
  } catch (error) {
    console.error("ERRO NO HISTÓRICO DO CLIENTE:", error);
    return NextResponse.json({ error: "Ocorreu um erro ao consultar seus pedidos." }, { status: 500 });
  }
}
