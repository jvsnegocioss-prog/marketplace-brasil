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
    <main className="product-detail-page">
      <div className="product-detail-container">
        <Link href="/" className="detail-back-link">
          <ArrowLeft size={18} /> Voltar à loja
        </Link>

        <section className="detail-overview">
          <div className="detail-photo-frame">
            {product.image_url ? (
              <img src={product.image_url} alt={product.name} className="detail-product-photo" />
            ) : (
              <Package size={100} className="detail-placeholder" />
            )}
          </div>
          <div>
            <p className="detail-category">{product.category || "Geral"}</p>
            <h1 className="detail-product-title">{product.name}</h1>
            <div className="detail-rating">
              <span>{"★".repeat(Math.round(average))}{"☆".repeat(5 - Math.round(average))}</span>
              <span className="detail-rating-caption">
                {reviews.length ? `${average.toFixed(1)} de 5 • ${reviews.length} avaliação(ões)` : "Ainda sem avaliações"}
              </span>
            </div>
            <p className="detail-price">{money(product.price)}</p>
            <p className="detail-stock">{product.stock > 0 ? `${product.stock} unidade(s) disponíveis` : "Produto indisponível"}</p>
            {product.description && <p className="detail-description">{product.description}</p>}
            <Link href="/#produtos" className="detail-buy-link">
              <ShoppingCart size={18} /> Voltar e comprar
            </Link>
          </div>
        </section>

        <section className="detail-review-layout">
          <div className="detail-panel">
            <h2 className="detail-panel-title">Avaliações dos clientes</h2>
            {reviews.length === 0 ? (
              <p className="mt-5 text-gray-600">Este produto ainda não recebeu avaliações aprovadas.</p>
            ) : (
              <div className="review-list">
                {reviews.map((review) => (
                  <article key={review.id} className="review-item">
                    <div className="flex items-center justify-between gap-3">
                      <strong className="reviewer-name">{review.reviewer_name}</strong>
                      <span className="review-date">{new Date(review.created_at).toLocaleDateString("pt-BR")}</span>
                    </div>
                    <div className="review-stars">{"★".repeat(review.rating)}{"☆".repeat(5 - review.rating)}</div>
                    <p className="review-comment">{review.comment}</p>
                    <span className="verified-purchase">Compra verificada</span>
                  </article>
                ))}
              </div>
            )}
          </div>

          <div className="detail-panel review-form-panel">
            <h2 className="detail-panel-title">Avalie este produto</h2>
            <p className="review-form-intro">Disponível somente para quem comprou, pagou e recebeu este produto.</p>
            <label className="review-label">Número do pedido</label>
            <input value={orderId} onChange={(e) => setOrderId(e.target.value)} className="review-input" placeholder="Cole o código do pedido" />
            <label className="review-label review-label-spaced">Telefone usado na compra</label>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} className="review-input" placeholder="Seu telefone" inputMode="tel" />
            <button type="button" onClick={findMyReview} disabled={saving || !orderId || !phone} className="review-secondary-button">
              Buscar minha avaliação anterior
            </button>
            <label className="review-label review-label-spaced">Sua nota</label>
            <div className="review-star-picker">
              {[1, 2, 3, 4, 5].map((value) => (
                <button key={value} type="button" onClick={() => setRating(value)} aria-label={`${value} estrelas`} className={value <= rating ? "review-star-selected" : "review-star-unselected"}>★</button>
              ))}
            </div>
            <label className="review-label review-label-spaced">Comentário</label>
            <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={4} className="review-input review-textarea" placeholder="Conte como foi sua experiência..." />
            <button onClick={submitReview} disabled={saving || !orderId || !phone || !comment.trim()} className="review-submit-button">
              {saving ? "Enviando..." : reviewId ? "Salvar alterações" : "Enviar avaliação"}
            </button>
            {reviewId && <button onClick={deleteReview} disabled={saving} className="review-delete-button">Excluir minha avaliação</button>}
            {message && <p className="review-message">{message}</p>}
          </div>
        </section>
      </div>
    </main>
  );
}
