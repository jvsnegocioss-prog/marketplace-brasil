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
  const allowedTypes: Record<string, { extension: string; maxBytes: number; kind: "image" | "video" }> = {
    "image/jpeg": { extension: "jpg", maxBytes: 10 * 1024 * 1024, kind: "image" },
    "image/png": { extension: "png", maxBytes: 10 * 1024 * 1024, kind: "image" },
    "image/webp": { extension: "webp", maxBytes: 10 * 1024 * 1024, kind: "image" },
    "image/gif": { extension: "gif", maxBytes: 10 * 1024 * 1024, kind: "image" },
    "video/mp4": { extension: "mp4", maxBytes: 50 * 1024 * 1024, kind: "video" },
    "video/webm": { extension: "webm", maxBytes: 50 * 1024 * 1024, kind: "video" },
    "video/quicktime": { extension: "mov", maxBytes: 50 * 1024 * 1024, kind: "video" },
  };
  const urls: string[] = [];
  const paths: string[] = [];
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  if (totalBytes > 100 * 1024 * 1024) throw new Error("O tamanho total dos arquivos não pode ultrapassar 100 MB.");

  try {
    for (const file of files) {
      const type = allowedTypes[file.type];
      if (!type) throw new Error("Formato não permitido. Use JPG, PNG, WEBP, GIF, MP4, WEBM ou MOV.");
      if (file.size > type.maxBytes) {
        throw new Error(type.kind === "image" ? "Cada foto deve ter no máximo 10 MB." : "Cada vídeo deve ter no máximo 50 MB.");
      }

      const header = new Uint8Array(await file.slice(0, 12).arrayBuffer());
      const starts = (...values: number[]) => values.every((value, index) => header[index] === value);
      const ascii = (offset: number, value: string) =>
        value.split("").every((char, index) => header[offset + index] === char.charCodeAt(0));
      const validSignature =
        file.type === "image/jpeg" ? starts(0xff, 0xd8, 0xff) :
        file.type === "image/png" ? starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a) :
        file.type === "image/webp" ? ascii(0, "RIFF") && ascii(8, "WEBP") :
        file.type === "image/gif" ? ascii(0, "GIF87a") || ascii(0, "GIF89a") :
        file.type === "video/webm" ? starts(0x1a, 0x45, 0xdf, 0xa3) :
        (file.type === "video/mp4" || file.type === "video/quicktime") ? ascii(4, "ftyp") :
        false;
      if (!validSignature) throw new Error("O conteúdo de um arquivo não corresponde ao formato informado.");

      const path = `reviews/${userId}/${randomUUID()}.${type.extension}`;
      const { error } = await supabaseAdmin.storage.from(mediaBucket).upload(path, file, {
        contentType: file.type,
        upsert: false,
      });
      if (error) throw new Error("Não foi possível enviar as mídias. Tente novamente.");
      paths.push(path);
      const { data } = supabaseAdmin.storage.from(mediaBucket).getPublicUrl(path);
      urls.push(data.publicUrl);
    }
    return { urls, paths };
  } catch (error) {
    if (paths.length) await supabaseAdmin.storage.from(mediaBucket).remove(paths);
    throw error;
  }
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

    const uploaded = await uploadReviewFiles(files, user.id);
    const { data, error } = await supabaseAdmin
      .from("product_reviews")
      .insert({
        product_id: productId,
        order_id: validation.order.id,
        reviewer_name: user.user_metadata?.full_name || user.email.split("@")[0] || "Cliente",
        customer_phone_hash: user.id,
        rating,
        comment: "",
        photos: uploaded.urls,
        status: "pending",
      })
      .select("id,status")
      .single();

    if (error) {
      if (uploaded.paths.length) await supabaseAdmin.storage.from(mediaBucket).remove(uploaded.paths);
      if (error.code === "23505") return NextResponse.json({ error: "Você já avaliou este produto nesta compra." }, { status: 409 });
      return NextResponse.json({ error: "Não foi possível salvar a avaliação." }, { status: 500 });
    }
    return NextResponse.json({ success: true, review: data, message: "Avaliação enviada e aguardando aprovação da loja." }, { status: 201 });
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
    const uploaded = files.length ? await uploadReviewFiles(files, user.id) : undefined;
    const update: Record<string, unknown> = { rating, status: "pending", updated_at: new Date().toISOString() };
    if (uploaded) update.photos = uploaded.urls;

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
    return NextResponse.json({ success: true, review: data, message: "Avaliação atualizada e enviada para nova aprovação." });
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
