import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

export const runtime = "nodejs";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const paidStatuses = ["pago", "aprovado", "approved", "concluido", "concluído"];
const mediaBucket = "products-media";

async function getAccount(request: Request) {
  const authorization = request.headers.get("authorization") || "";
  if (!authorization.startsWith("Bearer ")) return null;
  const token = authorization.slice(7);
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data.user?.email) return null;
  return data.user;
}

async function validatePurchase(email: string, productId: string) {
  const { data: orders, error } = await supabaseAdmin
    .from("orders")
    .select("id,customer_name,status,delivery_status,customer_email")
    .ilike("customer_email", email)
    .order("created_at", { ascending: false });

  if (error) throw new Error("Não foi possível localizar suas compras.");
  const eligibleOrders = (orders || []).filter((order) =>
    paidStatuses.includes(String(order.status || "").trim().toLowerCase()) &&
    String(order.delivery_status || "").trim().toLowerCase() === "entregue"
  );

  for (const order of eligibleOrders) {
    const { data: item, error: itemError } = await supabaseAdmin
      .from("order_items")
      .select("product_id")
      .eq("order_id", order.id)
      .eq("product_id", productId)
      .maybeSingle();

    if (itemError) throw new Error("Não foi possível confirmar o produto comprado.");
    if (item) return { order };
  }

  return { error: "A avaliação será liberada quando este produto de uma compra da sua conta estiver pago e entregue.", status: 403 as const };
}

async function uploadReviewFiles(files: File[], userId: string) {
  const urls: string[] = [];
  for (const file of files) {
    const isImage = file.type.startsWith("image/");
    const isVideo = file.type.startsWith("video/");
    if (!isImage && !isVideo) throw new Error("Envie somente fotos ou vídeos.");
    if (file.size > 50 * 1024 * 1024) throw new Error("Cada arquivo deve ter no máximo 50 MB.");
    const extension = file.name.split(".").pop()?.toLowerCase() || (isImage ? "jpg" : "mp4");
    const path = `reviews/${userId}/${randomUUID()}.${extension}`;
    const { error } = await supabaseAdmin.storage.from(mediaBucket).upload(path, file, {
      contentType: file.type,
      upsert: false,
    });
    if (error) throw new Error("Não foi possível enviar as mídias. Tente novamente.");
    const { data } = supabaseAdmin.storage.from(mediaBucket).getPublicUrl(path);
    urls.push(data.publicUrl);
  }
  return urls;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const productId = searchParams.get("productId");
  if (!productId) return NextResponse.json({ error: "Informe o produto." }, { status: 400 });

  const { data, error } = await supabaseAdmin
    .from("product_reviews")
    .select("id,product_id,reviewer_name,rating,comment,photos,created_at")
    .eq("product_id", productId)
    .eq("status", "approved")
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: "Não foi possível carregar as avaliações." }, { status: 500 });

  const user = await getAccount(request);
  let ownReview = null;
  if (user?.email) {
    const { data: orders } = await supabaseAdmin
      .from("orders")
      .select("id")
      .ilike("customer_email", user.email);
    const orderIds = (orders || []).map((order) => order.id);
    if (orderIds.length) {
      const { data: owned } = await supabaseAdmin
        .from("product_reviews")
        .select("id,rating,comment,photos,status,order_id")
        .eq("product_id", productId)
        .in("order_id", orderIds)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      ownReview = owned || null;
    }
  }

  return NextResponse.json({ reviews: data || [], ownReview });
}

export async function POST(request: Request) {
  try {
    const user = await getAccount(request);
    if (!user?.email) return NextResponse.json({ error: "Entre na sua conta para avaliar este produto." }, { status: 401 });

    const form = await request.formData();
    const productId = String(form.get("productId") || "").trim();
    const rating = Number(form.get("rating"));
    const files = form.getAll("media").filter((item): item is File => item instanceof File && item.size > 0);

    if (!productId || !Number.isInteger(rating) || rating < 1 || rating > 5) {
      return NextResponse.json({ error: "Selecione sua nota de 1 a 5 estrelas." }, { status: 400 });
    }

    if (files.length > 5) return NextResponse.json({ error: "Você pode enviar até 5 fotos ou vídeos por avaliação." }, { status: 400 });
    const validation = await validatePurchase(user.email, productId);
    if ("error" in validation) return NextResponse.json({ error: validation.error }, { status: validation.status });

    const photos = await uploadReviewFiles(files, user.id);
    const { data, error } = await supabaseAdmin
      .from("product_reviews")
      .insert({
        product_id: productId,
        order_id: validation.order.id,
        reviewer_name: user.user_metadata?.full_name || user.email.split("@")[0] || "Cliente",
        customer_phone_hash: user.id,
        rating,
        comment: "",
        photos,
        status: "approved",
      })
      .select("id,status")
      .single();

    if (error) {
      if (error.code === "23505") return NextResponse.json({ error: "Você já avaliou este produto nesta compra." }, { status: 409 });
      return NextResponse.json({ error: "Não foi possível salvar a avaliação." }, { status: 500 });
    }
    return NextResponse.json({ success: true, review: data, message: "Avaliação publicada com sucesso!" }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Não foi possível processar a avaliação." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const user = await getAccount(request);
    if (!user?.email) return NextResponse.json({ error: "Entre na sua conta para editar a avaliação." }, { status: 401 });
    const form = await request.formData();
    const reviewId = String(form.get("reviewId") || "").trim();
    const productId = String(form.get("productId") || "").trim();
    const rating = Number(form.get("rating"));
    if (!reviewId || !productId || !Number.isInteger(rating) || rating < 1 || rating > 5) {
      return NextResponse.json({ error: "Selecione sua nota de 1 a 5 estrelas." }, { status: 400 });
    }

    const validation = await validatePurchase(user.email, productId);
    if ("error" in validation) return NextResponse.json({ error: validation.error }, { status: validation.status });

    const files = form.getAll("media").filter((item): item is File => item instanceof File && item.size > 0);
    if (files.length > 5) return NextResponse.json({ error: "Você pode enviar até 5 fotos ou vídeos por avaliação." }, { status: 400 });
    const photos = files.length ? await uploadReviewFiles(files, user.id) : undefined;
    const update: Record<string, unknown> = { rating, status: "pending", updated_at: new Date().toISOString() };
    if (photos) update.photos = photos;

    const { data, error } = await supabaseAdmin
      .from("product_reviews")
      .update(update)
      .eq("id", reviewId)
      .eq("product_id", productId)
      .eq("order_id", validation.order.id)
      .select("id,status")
      .maybeSingle();

    if (error) return NextResponse.json({ error: "Não foi possível atualizar a avaliação." }, { status: 500 });
    if (!data) return NextResponse.json({ error: "Avaliação não encontrada para esta conta." }, { status: 404 });
    return NextResponse.json({ success: true, review: data, message: "Avaliação atualizada e publicada com sucesso!" });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Não foi possível processar a alteração." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const user = await getAccount(request);
    if (!user?.email) return NextResponse.json({ error: "Entre na sua conta para excluir a avaliação." }, { status: 401 });
    const body = await request.json();
    const reviewId = typeof body.reviewId === "string" ? body.reviewId.trim() : "";
    const productId = typeof body.productId === "string" ? body.productId.trim() : "";
    const validation = await validatePurchase(user.email, productId);
    if ("error" in validation) return NextResponse.json({ error: validation.error }, { status: validation.status });

    const { data, error } = await supabaseAdmin
      .from("product_reviews")
      .delete()
      .eq("id", reviewId)
      .eq("product_id", productId)
      .eq("order_id", validation.order.id)
      .select("id")
      .maybeSingle();
    if (error) return NextResponse.json({ error: "Não foi possível excluir a avaliação." }, { status: 500 });
    if (!data) return NextResponse.json({ error: "Avaliação não encontrada para esta conta." }, { status: 404 });
    return NextResponse.json({ success: true, message: "Avaliação excluída." });
  } catch {
    return NextResponse.json({ error: "Não foi possível processar a exclusão." }, { status: 500 });
  }
}
