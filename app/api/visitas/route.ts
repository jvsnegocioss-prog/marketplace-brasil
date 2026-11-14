import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const supabasePublic = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

// Limite por instância: proteção básica contra rajadas; não substitui rate limiting distribuído.
const requestBuckets = new Map<string, { minute: number; count: number }>();
const recentViews = new Map<string, number>();

function getClientIp(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for");
  const realIp = request.headers.get("x-real-ip");
  return (forwarded?.split(",")[0] || realIp || "").trim();
}

export async function POST(request: Request) {
  try {
    const contentLength = Number(request.headers.get("content-length") || 0);
    if (contentLength > 2000) {
      return NextResponse.json({ error: "Solicitação muito grande." }, { status: 413 });
    }

    const ip = getClientIp(request);
    if (!ip) {
      return NextResponse.json({ error: "Não foi possível validar a origem da solicitação." }, { status: 503 });
    }

    const body = await request.json();
    const visitorId = typeof body.visitorId === "string" ? body.visitorId.trim() : "";
    const productId = typeof body.productId === "string" ? body.productId.trim() : "";

    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(visitorId)) {
      return NextResponse.json({ error: "Identificador de visitante inválido." }, { status: 400 });
    }

    const minute = Math.floor(Date.now() / 60000);
    const bucket = requestBuckets.get(ip);
    if (bucket && bucket.minute === minute && bucket.count >= 60) {
      return NextResponse.json(
        { error: "Muitas solicitações. Tente novamente em instantes." },
        { status: 429, headers: { "Retry-After": "60", "Cache-Control": "no-store" } }
      );
    }
    requestBuckets.set(ip, {
      minute,
      count: bucket && bucket.minute === minute ? bucket.count + 1 : 1,
    });

    let path = "/";
    let verifiedProductId: string | null = null;
    let verifiedProductName: string | null = null;

    if (productId) {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(productId)) {
        return NextResponse.json({ error: "Produto inválido." }, { status: 400 });
      }

      const { data: product, error: productError } = await supabasePublic
        .from("products")
        .select("id,name")
        .eq("id", productId)
        .eq("active", true)
        .maybeSingle();

      if (productError) {
        console.error("Falha ao validar produto para visualização:", productError);
        return NextResponse.json({ error: "Não foi possível registrar a visualização." }, { status: 500 });
      }
      if (!product) {
        return NextResponse.json({ error: "Produto não encontrado ou indisponível." }, { status: 404 });
      }

      path = `/produto/${product.id}`;
      verifiedProductId = product.id;
      verifiedProductName = product.name;
    }

    const dedupeKey = `${visitorId}:${path}`;
    const lastView = recentViews.get(dedupeKey) || 0;
    if (Date.now() - lastView < 5000) {
      return NextResponse.json({ recorded: true, deduplicated: true }, {
        headers: { "Cache-Control": "no-store" },
      });
    }
    recentViews.set(dedupeKey, Date.now());

    if (requestBuckets.size > 10000 || recentViews.size > 20000) {
      const cutoff = Date.now() - 60000;
      for (const [key, value] of recentViews) {
        if (value < cutoff) recentViews.delete(key);
      }
      for (const [key, value] of requestBuckets) {
        if (value.minute < minute - 1) requestBuckets.delete(key);
      }
    }

    const { error } = await supabaseAdmin.rpc("record_store_page_view", {
      p_visitor_id: visitorId,
      p_path: path,
      p_product_id: verifiedProductId,
      p_product_name: verifiedProductName,
    });

    if (error) {
      recentViews.delete(dedupeKey);
      console.error("Falha ao gravar visualização no Supabase:", error);
      return NextResponse.json({ error: "Não foi possível registrar a visualização." }, { status: 500 });
    }

    return NextResponse.json({ recorded: true }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("Erro na rota de registro de visualizações:", error);
    return NextResponse.json({ error: "Erro ao registrar visualização." }, { status: 500 });
  }
}
