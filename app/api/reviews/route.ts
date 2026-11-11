import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: { autoRefreshToken: false, persistSession: false },
  }
);

const paidStatuses = ["pago", "aprovado", "approved", "concluido", "concluído"];

function digits(value: string) {
  return value.replace(/\D/g, "");
}

function phoneHash(phone: string) {
  const secret =
    process.env.REVIEWS_PHONE_HASH_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    "";
  return createHash("sha256")
    .update(secret + ":" + digits(phone))
    .digest("hex");
}

async function validatePurchase(orderId: string, productId: string, phone: string) {
  const { data: order, error } = await supabaseAdmin
    .from("orders")
    .select("id,customer_name,customer_phone,status,delivery_status")
    .eq("id", orderId)
    .maybeSingle();

  if (error) throw new Error("Não foi possível validar o pedido.");
  if (!order) return { error: "Pedido não encontrado.", status: 404 as const };

  if (digits(order.customer_phone || "") !== digits(phone)) {
    return { error: "Telefone não corresponde ao pedido.", status: 403 as const };
  }

  if (!paidStatuses.includes(String(order.status || "").trim().toLowerCase())) {
    return { error: "A avaliação só é liberada após a confirmação do pagamento.", status: 403 as const };
  }

  if (String(order.delivery_status || "").trim().toLowerCase() !== "entregue") {
    return { error: "A avaliação só é liberada após a entrega do pedido.", status: 403 as const };
  }

  const { data: item, error: itemError } = await supabaseAdmin
    .from("order_items")
    .select("product_id")
    .eq("order_id", orderId)
    .eq("product_id", productId)
    .maybeSingle();

  if (itemError) throw new Error("Não foi possível confirmar o produto do pedido.");
  if (!item) return { error: "Este produto não consta no pedido informado.", status: 403 as const };

  return { order };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const productId = searchParams.get("productId");

  if (!productId) {
    return NextResponse.json({ error: "Informe o produto." }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from("product_reviews")
    .select("id,product_id,reviewer_name,rating,comment,photos,created_at")
    .eq("product_id", productId)
    .eq("status", "approved")
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: "Não foi possível carregar as avaliações." }, { status: 500 });
  }

  let ownReview = null;
  const orderId = searchParams.get("orderId");
  const phone = searchParams.get("phone");
  if (orderId && phone) {
    const { data: owned } = await supabaseAdmin
      .from("product_reviews")
      .select("id,rating,comment,status")
      .eq("product_id", productId)
      .eq("order_id", orderId)
      .eq("customer_phone_hash", phoneHash(phone))
      .maybeSingle();
    ownReview = owned || null;
  }

  return NextResponse.json({ reviews: data || [], ownReview });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const orderId = typeof body.orderId === "string" ? body.orderId.trim() : "";
    const productId = typeof body.productId === "string" ? body.productId.trim() : "";
    const phone = typeof body.phone === "string" ? body.phone.trim() : "";
    const rating = Number(body.rating);
    const comment = typeof body.comment === "string" ? body.comment.trim() : "";

    if (!orderId || !productId || !phone || !Number.isInteger(rating) || rating < 1 || rating > 5 || !comment) {
      return NextResponse.json({ error: "Preencha pedido, telefone, nota e comentário." }, { status: 400 });
    }

    const validation = await validatePurchase(orderId, productId, phone);
    if ("error" in validation) {
      return NextResponse.json({ error: validation.error }, { status: validation.status });
    }

    const { data, error } = await supabaseAdmin
      .from("product_reviews")
      .insert({
        product_id: productId,
        order_id: orderId,
        reviewer_name: validation.order.customer_name || "Cliente",
        customer_phone_hash: phoneHash(phone),
        rating,
        comment,
        photos: [],
        status: "pending",
      })
      .select("id,status")
      .single();

    if (error) {
      if (error.code === "23505") {
        return NextResponse.json({ error: "Você já avaliou este produto. Use a opção de editar sua avaliação." }, { status: 409 });
      }
      return NextResponse.json({ error: "Não foi possível salvar a avaliação." }, { status: 500 });
    }

    return NextResponse.json({ success: true, review: data, message: "Avaliação enviada para aprovação." }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Não foi possível processar a avaliação." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const reviewId = typeof body.reviewId === "string" ? body.reviewId.trim() : "";
    const orderId = typeof body.orderId === "string" ? body.orderId.trim() : "";
    const productId = typeof body.productId === "string" ? body.productId.trim() : "";
    const phone = typeof body.phone === "string" ? body.phone.trim() : "";
    const rating = Number(body.rating);
    const comment = typeof body.comment === "string" ? body.comment.trim() : "";

    if (!reviewId || !orderId || !productId || !phone || !Number.isInteger(rating) || rating < 1 || rating > 5 || !comment) {
      return NextResponse.json({ error: "Confira os dados da avaliação." }, { status: 400 });
    }

    const validation = await validatePurchase(orderId, productId, phone);
    if ("error" in validation) {
      return NextResponse.json({ error: validation.error }, { status: validation.status });
    }

    const { data, error } = await supabaseAdmin
      .from("product_reviews")
      .update({ rating, comment, status: "pending", updated_at: new Date().toISOString() })
      .eq("id", reviewId)
      .eq("product_id", productId)
      .eq("order_id", orderId)
      .eq("customer_phone_hash", phoneHash(phone))
      .select("id,status")
      .maybeSingle();

    if (error) return NextResponse.json({ error: "Não foi possível atualizar a avaliação." }, { status: 500 });
    if (!data) return NextResponse.json({ error: "Avaliação não encontrada para este comprador." }, { status: 404 });

    return NextResponse.json({ success: true, review: data, message: "Alteração enviada para nova aprovação." });
  } catch {
    return NextResponse.json({ error: "Não foi possível processar a alteração." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const body = await request.json();
    const reviewId = typeof body.reviewId === "string" ? body.reviewId.trim() : "";
    const orderId = typeof body.orderId === "string" ? body.orderId.trim() : "";
    const productId = typeof body.productId === "string" ? body.productId.trim() : "";
    const phone = typeof body.phone === "string" ? body.phone.trim() : "";

    if (!reviewId || !orderId || !productId || !phone) {
      return NextResponse.json({ error: "Informe os dados para excluir a avaliação." }, { status: 400 });
    }

    const validation = await validatePurchase(orderId, productId, phone);
    if ("error" in validation) {
      return NextResponse.json({ error: validation.error, status: validation.status });
    }

    const { data, error } = await supabaseAdmin
      .from("product_reviews")
      .delete()
      .eq("id", reviewId)
      .eq("product_id", productId)
      .eq("order_id", orderId)
      .eq("customer_phone_hash", phoneHash(phone))
      .select("id")
      .maybeSingle();

    if (error) return NextResponse.json({ error: "Não foi possível excluir a avaliação." }, { status: 500 });
    if (!data) return NextResponse.json({ error: "Avaliação não encontrada para este comprador." }, { status: 404 });

    return NextResponse.json({ success: true, message: "Avaliação excluída." });
  } catch {
    return NextResponse.json({ error: "Não foi possível processar a exclusão." }, { status: 500 });
  }
}
