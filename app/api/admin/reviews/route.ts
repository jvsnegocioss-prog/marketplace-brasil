import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function responseError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

async function getAdminClient(request: NextRequest) {
  const authorization = request.headers.get("authorization") || "";
  const token = authorization.startsWith("Bearer ")
    ? authorization.slice(7)
    : "";

  if (!token) return null;

  const userClient = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data: userData, error: userError } = await userClient.auth.getUser(token);
  if (userError || !userData.user) return null;

  const { data: isAdmin, error: adminError } = await userClient.rpc(
    "is_marketplace_admin"
  );
  if (adminError || isAdmin !== true) return null;

  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function GET(request: NextRequest) {
  const supabase = await getAdminClient(request);
  if (!supabase) return responseError("Acesso administrativo não autorizado.", 401);

  const status = request.nextUrl.searchParams.get("status") || "all";
  let query = supabase
    .from("product_reviews")
    .select("id,product_id,order_id,reviewer_name,rating,comment,photos,status,created_at,updated_at")
    .order("created_at", { ascending: false })
    .limit(200);

  if (["pending", "approved", "hidden"].includes(status)) {
    query = query.eq("status", status);
  }

  const { data: reviews, error } = await query;
  if (error) return responseError("Não foi possível carregar as avaliações: " + error.message, 500);

  const productIds = [...new Set((reviews || []).map((review) => review.product_id))];
  const { data: products, error: productsError } = productIds.length
    ? await supabase.from("products").select("id,name").in("id", productIds)
    : { data: [], error: null };

  if (productsError) {
    return responseError("Não foi possível carregar os nomes dos produtos.", 500);
  }

  const productNames = new Map((products || []).map((product) => [product.id, product.name]));
  return NextResponse.json({
    reviews: (reviews || []).map((review) => ({
      ...review,
      product_name: productNames.get(review.product_id) || "Produto",
    })),
  });
}

export async function PATCH(request: NextRequest) {
  const supabase = await getAdminClient(request);
  if (!supabase) return responseError("Acesso administrativo não autorizado.", 401);

  let body: { reviewId?: string; status?: string };
  try {
    body = await request.json();
  } catch {
    return responseError("Dados inválidos.", 400);
  }

  const reviewId = body.reviewId;
  const status = body.status;
  if (!reviewId || !["pending", "approved", "hidden"].includes(status || "")) {
    return responseError("Informe uma avaliação e uma situação válida.", 400);
  }

  const { data, error } = await supabase
    .from("product_reviews")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", reviewId)
    .select("id,status")
    .single();

  if (error || !data) {
    return responseError("Não foi possível atualizar a avaliação: " + (error?.message || "registro não encontrado"), 500);
  }

  return NextResponse.json({ success: true, review: data });
}
