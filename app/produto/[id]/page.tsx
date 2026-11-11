"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, ShoppingCart, Package } from "lucide-react";
import { supabase } from "@/lib/supabase";

type Product = {
  id: string;
  name: string;
  description: string | null;
  price: number;
  stock: number;
  category: string | null;
  image_url: string | null;
};

type Review = {
  id: string;
  reviewer_name: string;
  rating: number;
  comment: string;
  created_at: string;
};

const money = (value: number) =>
  Number(value || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });

export default function ProductPage() {
  const params = useParams<{ id: string }>();
  const productId = params.id;
  const [product, setProduct] = useState<Product | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [orderId, setOrderId] = useState("");
  const [phone, setPhone] = useState("");
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");
  const [reviewId, setReviewId] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  async function loadReviews() {
    const response = await fetch(`/api/reviews?productId=${encodeURIComponent(productId)}`);
    const result = await response.json();
    if (response.ok) setReviews(result.reviews || []);
  }

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from("products")
        .select("id,name,description,price,stock,category,image_url")
        .eq("id", productId)
        .eq("active", true)
        .maybeSingle();

      setProduct(data as Product | null);
      await loadReviews();
      setLoading(false);
    }
    if (productId) load();
  }, [productId]);

  const average = reviews.length
    ? reviews.reduce((sum, item) => sum + item.rating, 0) / reviews.length
    : 0;

  async function findMyReview() {
    if (!orderId || !phone) {
      setMessage("Informe o número do pedido e o telefone da compra.");
      return;
    }
    setSaving(true);
    const query = new URLSearchParams({ productId, orderId, phone });
    const response = await fetch(`/api/reviews?${query.toString()}`);
    const result = await response.json();
    if (response.ok && result.ownReview) {
      setReviewId(result.ownReview.id);
      setRating(result.ownReview.rating);
      setComment(result.ownReview.comment);
      setMessage(`Sua avaliação foi localizada. Situação: ${result.ownReview.status === "approved" ? "publicada" : "aguardando aprovação"}.`);
    } else {
      setReviewId("");
      setMessage("Não encontramos uma avaliação sua para este produto e pedido.");
    }
    setSaving(false);
  }

  async function submitReview() {
    if (saving) return;
    setSaving(true);
    setMessage("");

    const response = await fetch("/api/reviews", {
      method: reviewId ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        reviewId: reviewId || undefined,
        orderId,
        productId,
        phone,
        rating,
        comment,
      }),
    });
    const result = await response.json();

    if (!response.ok) {
      setMessage(result.error || "Não foi possível enviar sua avaliação.");
    } else {
      setReviewId(result.review?.id || reviewId);
      setMessage(result.message || "Avaliação enviada para aprovação.");
      await loadReviews();
    }
    setSaving(false);
  }

  async function deleteReview() {
    if (!reviewId || saving) return;
    if (!window.confirm("Deseja excluir sua avaliação?")) return;
    setSaving(true);
    const response = await fetch("/api/reviews", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reviewId, orderId, productId, phone }),
    });
    const result = await response.json();
    setMessage(result.message || result.error || "");
    if (response.ok) {
      setReviewId("");
      setComment("");
      setRating(5);
      await loadReviews();
    }
    setSaving(false);
  }

  if (loading) {
    return <main className="mx-auto max-w-5xl p-6">Carregando produto...</main>;
  }

  if (!product) {
    return (
      <main className="mx-auto max-w-5xl p-6">
        <p>Produto não encontrado ou indisponível.</p>
        <Link className="mt-4 inline-block text-blue-700 underline" href="/">Voltar à loja</Link>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50 px-4 py-8">
      <div className="mx-auto max-w-5xl">
        <Link href="/" className="mb-6 inline-flex items-center gap-2 font-semibold text-blue-700">
          <ArrowLeft size={18} /> Voltar à loja
        </Link>

        <section className="grid gap-8 rounded-2xl bg-white p-5 shadow-sm md:grid-cols-2 md:p-8">
          <div className="flex min-h-72 items-center justify-center rounded-xl bg-gray-50 p-4">
            {product.image_url ? (
              <img src={product.image_url} alt={product.name} className="max-h-64 max-w-full w-auto object-contain" />
            ) : (
              <Package size={100} className="text-gray-300" />
            )}
          </div>
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-blue-700">{product.category || "Geral"}</p>
            <h1 className="mt-2 text-3xl font-bold text-gray-900">{product.name}</h1>
            <div className="mt-3 flex items-center gap-2 text-amber-500">
              <span>{"★".repeat(Math.round(average))}{"☆".repeat(5 - Math.round(average))}</span>
              <span className="text-sm text-gray-600">
                {reviews.length ? `${average.toFixed(1)} de 5 • ${reviews.length} avaliação(ões)` : "Ainda sem avaliações"}
              </span>
            </div>
            <p className="mt-5 text-3xl font-bold text-gray-900">{money(product.price)}</p>
            <p className="mt-2 text-sm text-gray-500">{product.stock > 0 ? `${product.stock} unidade(s) disponíveis` : "Produto indisponível"}</p>
            {product.description && <p className="mt-5 whitespace-pre-wrap leading-7 text-gray-700">{product.description}</p>}
            <Link href="/#produtos" className="mt-7 inline-flex items-center gap-2 rounded-lg bg-blue-700 px-5 py-3 font-semibold text-white">
              <ShoppingCart size={18} /> Voltar e comprar
            </Link>
          </div>
        </section>

        <section className="mt-8 grid gap-8 md:grid-cols-[1.2fr_0.8fr]">
          <div className="rounded-2xl bg-white p-5 shadow-sm md:p-7">
            <h2 className="text-2xl font-bold text-gray-900">Avaliações dos clientes</h2>
            {reviews.length === 0 ? (
              <p className="mt-5 text-gray-600">Este produto ainda não recebeu avaliações aprovadas.</p>
            ) : (
              <div className="mt-5 space-y-5">
                {reviews.map((review) => (
                  <article key={review.id} className="border-b border-gray-100 pb-5 last:border-0">
                    <div className="flex items-center justify-between gap-3">
                      <strong className="text-gray-900">{review.reviewer_name}</strong>
                      <span className="text-xs text-gray-500">{new Date(review.created_at).toLocaleDateString("pt-BR")}</span>
                    </div>
                    <div className="mt-1 text-amber-500">{"★".repeat(review.rating)}{"☆".repeat(5 - review.rating)}</div>
                    <p className="mt-2 whitespace-pre-wrap text-gray-700">{review.comment}</p>
                    <span className="mt-2 inline-block rounded-full bg-green-50 px-3 py-1 text-xs font-semibold text-green-700">Compra verificada</span>
                  </article>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-2xl bg-white p-5 shadow-sm md:p-7">
            <h2 className="text-2xl font-bold text-gray-900">Avalie este produto</h2>
            <p className="mt-2 text-sm text-gray-600">Disponível somente para quem comprou, pagou e recebeu este produto.</p>
            <label className="mt-5 block text-sm font-semibold text-gray-700">Número do pedido</label>
            <input value={orderId} onChange={(e) => setOrderId(e.target.value)} className="mt-1 w-full rounded-lg border p-3" placeholder="Cole o código do pedido" />
            <label className="mt-4 block text-sm font-semibold text-gray-700">Telefone usado na compra</label>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} className="mt-1 w-full rounded-lg border p-3" placeholder="Seu telefone" inputMode="tel" />
            <button type="button" onClick={findMyReview} disabled={saving || !orderId || !phone} className="mt-3 w-full rounded-lg border border-blue-200 px-4 py-2 text-sm font-semibold text-blue-700 disabled:opacity-50">
              Buscar minha avaliação anterior
            </button>
            <label className="mt-4 block text-sm font-semibold text-gray-700">Sua nota</label>
            <div className="mt-2 flex gap-2">
              {[1, 2, 3, 4, 5].map((value) => (
                <button key={value} type="button" onClick={() => setRating(value)} aria-label={`${value} estrelas`} className={value <= rating ? "text-3xl text-amber-400" : "text-3xl text-gray-300"}>★</button>
              ))}
            </div>
            <label className="mt-4 block text-sm font-semibold text-gray-700">Comentário</label>
            <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={4} className="mt-1 w-full rounded-lg border p-3" placeholder="Conte como foi sua experiência..." />
            <button onClick={submitReview} disabled={saving || !orderId || !phone || !comment.trim()} className="mt-4 w-full rounded-lg bg-blue-700 px-4 py-3 font-bold text-white disabled:opacity-50">
              {saving ? "Enviando..." : reviewId ? "Salvar alterações" : "Enviar avaliação"}
            </button>
            {reviewId && <button onClick={deleteReview} disabled={saving} className="mt-2 w-full rounded-lg border border-red-200 px-4 py-3 font-semibold text-red-700">Excluir minha avaliação</button>}
            {message && <p className="mt-4 rounded-lg bg-blue-50 p-3 text-sm text-blue-800">{message}</p>}
          </div>
        </section>
      </div>
    </main>
  );
}
