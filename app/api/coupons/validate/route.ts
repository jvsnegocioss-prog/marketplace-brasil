import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const code = typeof body.code === "string"
      ? body.code.trim().toUpperCase().replace(/\\s+/g, "")
      : "";
    const items = body.items;

    if (!code || !Array.isArray(items) || items.length === 0 ||
        items.some((item: any) =>
          !item || typeof item.id !== "string" ||
          !Number.isInteger(item.qty) || item.qty < 1
        )) {
      return NextResponse.json({ error: "Informe um cupom e os produtos do carrinho." }, { status: 400 });
    }

    const quantities = new Map<string, number>();
    for (const item of items) {
      quantities.set(item.id, (quantities.get(item.id) || 0) + item.qty);
    }

    const ids = Array.from(quantities.keys());
    const { data: products, error: productsError } = await supabaseAdmin
      .from("products")
      .select("id,price,stock")
      .in("id", ids)
      .eq("active", true);

    if (productsError || !products || products.length !== ids.length) {
      return NextResponse.json({ error: "Um ou mais produtos não estão disponíveis." }, { status: 400 });
    }

    let subtotalCents = 0;
    for (const product of products) {
      const qty = quantities.get(product.id) || 0;
      if (qty < 1 || qty > Number(product.stock)) {
        return NextResponse.json({ error: "Quantidade indisponível para um dos produtos." }, { status: 400 });
      }
      subtotalCents += Math.round(Number(product.price) * 100) * qty;
    }

    const { data: coupon, error: couponError } = await supabaseAdmin
      .from("discount_coupons")
      .select("id,code,discount_type,discount_value,min_order_amount,max_discount,starts_at,expires_at,usage_limit,usage_count,active")
      .eq("code", code)
      .maybeSingle();

    if (couponError || !coupon) {
      return NextResponse.json({ error: "Cupom não encontrado." }, { status: 404 });
    }

    const now = Date.now();
    if (!coupon.active) {
      return NextResponse.json({ error: "Este cupom está inativo." }, { status: 400 });
    }
    if (coupon.starts_at && new Date(coupon.starts_at).getTime() > now) {
      return NextResponse.json({ error: "Este cupom ainda não está válido." }, { status: 400 });
    }
    if (coupon.expires_at && new Date(coupon.expires_at).getTime() < now) {
      return NextResponse.json({ error: "Este cupom está expirado." }, { status: 400 });
    }
    if (coupon.usage_limit !== null && Number(coupon.usage_count) >= Number(coupon.usage_limit)) {
      return NextResponse.json({ error: "Este cupom atingiu o limite de utilizações." }, { status: 400 });
    }

    const minimumCents = Math.round(Number(coupon.min_order_amount || 0) * 100);
    if (subtotalCents < minimumCents) {
      return NextResponse.json({
        error: "O pedido mínimo para este cupom é " +
          (minimumCents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) + "."
      }, { status: 400 });
    }

    let discountCents = coupon.discount_type === "percent"
      ? Math.round(subtotalCents * Number(coupon.discount_value) / 100)
      : Math.round(Number(coupon.discount_value) * 100);

    if (coupon.max_discount !== null) {
      discountCents = Math.min(discountCents, Math.round(Number(coupon.max_discount) * 100));
    }
    discountCents = Math.min(discountCents, subtotalCents);

    if (discountCents <= 0 || discountCents >= subtotalCents) {
      return NextResponse.json({ error: "Este cupom não gera um valor de compra válido." }, { status: 400 });
    }

    return NextResponse.json({
      valid: true,
      code: coupon.code,
      subtotal: subtotalCents / 100,
      discount: discountCents / 100,
      total: (subtotalCents - discountCents) / 100,
      message: "Cupom aplicado com sucesso!"
    });
  } catch (error) {
    console.error("ERRO AO VALIDAR CUPOM:", error);
    return NextResponse.json({ error: "Não foi possível validar o cupom agora." }, { status: 500 });
  }
}
