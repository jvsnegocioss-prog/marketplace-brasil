import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { calculateCouponDiscount } from "../../../../lib/coupon-security.cjs";

export const runtime = "nodejs";

function unavailableCouponResponse() {
  return NextResponse.json(
    { error: "Cupom inválido ou indisponível." },
    { status: 400, headers: { "Cache-Control": "no-store" } }
  );
}

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

async function readLimitedJson(request: Request): Promise<
  { ok: true; value: unknown } | { ok: false; status: 400 | 413 }
> {
  if (!request.body) return { ok: false, status: 400 };
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let totalBytes = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > 8000) {
        await reader.cancel();
        return { ok: false, status: 413 };
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, status: 400 };
  } finally {
    reader.releaseLock();
  }
}

export async function POST(request: Request) {
  try {
    const contentLength = Number(request.headers.get("content-length") || 0);
    if (Number.isFinite(contentLength) && contentLength > 8000) {
      return NextResponse.json({ error: "Solicitação muito grande." }, { status: 413, headers: { "Cache-Control": "no-store" } });
    }
    const parsedBody = await readLimitedJson(request);
    if (!parsedBody.ok) {
      return NextResponse.json(
        { error: parsedBody.status === 413 ? "Solicitação muito grande." : "Corpo da solicitação inválido." },
        { status: parsedBody.status, headers: { "Cache-Control": "no-store" } }
      );
    }
    if (!parsedBody.value || typeof parsedBody.value !== "object" || Array.isArray(parsedBody.value)) {
      return NextResponse.json({ error: "Corpo da solicitação inválido." }, { status: 400, headers: { "Cache-Control": "no-store" } });
    }
    const body = parsedBody.value as Record<string, unknown>;
    const code = typeof body.code === "string"
      ? body.code.trim().toUpperCase().replace(/\s+/g, "")
      : "";
    const items = body.items;

    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!code || code.length > 64 || !Array.isArray(items) ||
        items.length === 0 || items.length > 100 ||
        items.some((item: any) =>
          !item || typeof item.id !== "string" || !uuidPattern.test(item.id) ||
          !Number.isSafeInteger(item.qty) || item.qty < 1 || item.qty > 1000
        )) {
      return NextResponse.json({ error: "Informe um cupom válido e até 100 itens válidos no carrinho." }, { status: 400 });
    }

    const quantities = new Map<string, number>();
    for (const item of items) {
      const combinedQuantity = (quantities.get(item.id) || 0) + item.qty;
      if (!Number.isSafeInteger(combinedQuantity)) {
        return NextResponse.json({ error: "Quantidade inválida para um dos produtos." }, { status: 400 });
      }
      quantities.set(item.id, combinedQuantity);
    }

    const ids = Array.from(quantities.keys());
    const supabaseAdmin = getSupabaseAdmin();
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
      return unavailableCouponResponse();
    }

    const now = Date.now();
    if (!coupon.active) {
      return unavailableCouponResponse();
    }
    if (coupon.starts_at && new Date(coupon.starts_at).getTime() > now) {
      return unavailableCouponResponse();
    }
    if (coupon.expires_at && new Date(coupon.expires_at).getTime() < now) {
      return unavailableCouponResponse();
    }
    if (coupon.usage_limit !== null && Number(coupon.usage_count) >= Number(coupon.usage_limit)) {
      return unavailableCouponResponse();
    }

    const minimumCents = Math.round(Number(coupon.min_order_amount || 0) * 100);
    if (subtotalCents < minimumCents) {
      return NextResponse.json({
        error: "O pedido mínimo para este cupom é " +
          (minimumCents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) + "."
      }, { status: 400 });
    }

    const discount = calculateCouponDiscount({
      subtotalCents,
      discountType: coupon.discount_type,
      discountValue: coupon.discount_value,
      maxDiscount: coupon.max_discount,
    });
    if (!discount) {
      return unavailableCouponResponse();
    }
    const discountCents = discount.discountCents;

    return NextResponse.json({
      valid: true,
      code: coupon.code,
      subtotal: subtotalCents / 100,
      discount: discountCents / 100,
      total: (subtotalCents - discountCents) / 100,
      message: "Cupom aplicado com sucesso!"
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("ERRO AO VALIDAR CUPOM:", error);
    return NextResponse.json({ error: "Não foi possível validar o cupom agora." }, { status: 500 });
  }
}
