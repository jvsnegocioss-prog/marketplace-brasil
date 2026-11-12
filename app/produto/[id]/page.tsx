"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, ShoppingCart, Package, X, ZoomIn, ChevronLeft, ChevronRight } from "lucide-react";
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

type ProductMedia = {
  id: string;
  media_type: "image" | "video";
  url: string;
  poster_url?: string | null;
  sort_order: number;
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
  const [productMedia, setProductMedia] = useState<ProductMedia[]>([]);
  const [selectedMedia, setSelectedMedia] = useState<ProductMedia | null>(null);
  const [imageExpanded, setImageExpanded] = useState(false);
  const [touchStartX, setTouchStartX] = useState<number | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [orderId, setOrderId] = useState("");
  const [phone, setPhone] = useState("");
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");
  const [reviewId, setReviewId] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [cartMessage, setCartMessage] = useState("");

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
      const { data: mediaData } = await supabase
        .from("product_media")
        .select("id,media_type,url,poster_url,sort_order")
        .eq("product_id", productId)
        .order("sort_order", { ascending: true });
      const media = (mediaData || []) as ProductMedia[];
      setProductMedia(media);
      // Sempre abrir com a foto principal do cadastro. Se não existir, usar a primeira foto da galeria; vídeo nunca deve ser selecionado automaticamente quando houver imagem.
      const firstImage = media.find((item) => item.media_type === "image") || null;
      setSelectedMedia(data?.image_url ? null : firstImage || media[0] || null);
      setImageExpanded(false);
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

  const galleryItems = [
    ...(product.image_url ? [{ id: "main", media_type: "image" as const, url: product.image_url }] : []),
    ...productMedia,
  ];
  const currentGalleryIndex = selectedMedia
    ? Math.max(0, galleryItems.findIndex((item) => item.id === selectedMedia.id))
    : 0;

  function showGalleryItem(index: number) {
    if (!galleryItems.length) return;
    const nextIndex = (index + galleryItems.length) % galleryItems.length;
    const next = galleryItems[nextIndex];
    setSelectedMedia(next.id === "main" ? null : next as ProductMedia);
    setImageExpanded(false);
  }

  function handleGalleryTouchEnd(event: React.TouchEvent<HTMLDivElement>) {
    if (touchStartX === null) return;
    const deltaX = event.changedTouches[0].clientX - touchStartX;
    if (Math.abs(deltaX) > 45 && galleryItems.length > 1) {
      showGalleryItem(currentGalleryIndex + (deltaX < 0 ? 1 : -1));
    }
    setTouchStartX(null);
  }

  function addProductToCart() {
    if (!product || product.stock <= 0) return;
    try {
      const saved = localStorage.getItem("novashopp_cart");
      const cart = saved ? JSON.parse(saved) : [];
      const items: { id: string; qty: number }[] = Array.isArray(cart) ? cart : [];
      const existing = items.find((item) => item.id === product.id);
      if (existing && existing.qty >= product.stock) {
        setCartMessage("Você já adicionou todo o estoque disponível deste produto.");
        return;
      }
      const updated = existing
        ? items.map((item) =>
            item.id === product.id ? { ...item, qty: item.qty + 1 } : item
          )
        : [...items, { id: product.id, qty: 1 }];
      localStorage.setItem("novashopp_cart", JSON.stringify(updated));
      setCartMessage("Produto adicionado ao carrinho com sucesso!");
    } catch {
      setCartMessage("Não foi possível adicionar o produto. Tente novamente.");
    }
  }

  return (
    <main className="product-detail-page">
      <div className="product-detail-container">
        <Link href="/" className="detail-back-link">
          <ArrowLeft size={18} /> Voltar à loja
        </Link>

        <section className="detail-overview">
          <div>
            <div
              className="detail-photo-frame"
              onTouchStart={(event) => setTouchStartX(event.touches[0].clientX)}
              onTouchEnd={handleGalleryTouchEnd}
            >
              {selectedMedia?.media_type === "video" ? (
                <video
                  key={selectedMedia.id}
                  src={selectedMedia.url}
                  poster={selectedMedia.poster_url || undefined}
                  controls
                  playsInline
                  preload="metadata"
                  className="detail-product-photo detail-product-video"
                />
              ) : (
                <button
                  type="button"
                  className="detail-image-open"
                  onClick={() => setImageExpanded(true)}
                  aria-label="Ampliar foto do produto"
                >
                  <img
                    src={selectedMedia?.url || product.image_url || ""}
                    alt={product.name}
                    className="detail-product-photo"
                  />
                  <span className="detail-image-zoom"><ZoomIn size={17} /> Ampliar foto</span>
                </button>
              )}
              {!selectedMedia && !product.image_url && (
                <Package size={100} className="detail-placeholder" />
              )}
              {galleryItems.length > 1 && (
                <>
                  <button
                    type="button"
                    className="detail-gallery-arrow detail-gallery-arrow-left"
                    onClick={() => showGalleryItem(currentGalleryIndex - 1)}
                    aria-label="Foto anterior"
                  ><ChevronLeft size={25} /></button>
                  <button
                    type="button"
                    className="detail-gallery-arrow detail-gallery-arrow-right"
                    onClick={() => showGalleryItem(currentGalleryIndex + 1)}
                    aria-label="Próxima foto"
                  ><ChevronRight size={25} /></button>
                </>
              )}
            </div>
            {productMedia.length > 0 && (
              <div className="detail-media-thumbnails" aria-label="Fotos e vídeos do produto">
                {product.image_url && (
                  <button
                    type="button"
                    className={selectedMedia === null ? "detail-media-thumb active" : "detail-media-thumb"}
                    onClick={() => showGalleryItem(0)}
                    aria-label="Ver foto principal"
                  >
                    <img src={product.image_url} alt="" />
                  </button>
                )}
                {productMedia.map((media) => (
                  <button
                    key={media.id}
                    type="button"
                    className={selectedMedia?.id === media.id ? "detail-media-thumb active" : "detail-media-thumb"}
                    onClick={() => setSelectedMedia(media)}
                    aria-label={media.media_type === "video" ? "Reproduzir vídeo do produto" : "Ver foto do produto"}
                  >
                    {media.media_type === "image" ? (
                      <img src={media.url} alt="" />
                    ) : (
                      <span className="detail-video-thumb">
                        {media.poster_url ? (
                          <img src={media.poster_url} alt="Prévia do vídeo" />
                        ) : (
                          <span className="detail-video-fallback">▶</span>
                        )}
                        <span className="detail-video-play">▶</span>
                        <span className="detail-video-label">Vídeo</span>
                      </span>
                    )}
                  </button>
                ))}
              </div>
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
            <button
              type="button"
              className="detail-buy-link"
              onClick={addProductToCart}
              disabled={product.stock <= 0}
              aria-label="Adicionar produto ao carrinho"
            >
              <ShoppingCart size={18} /> {product.stock > 0 ? "Adicionar ao carrinho" : "Produto indisponível"}
            </button>
            {cartMessage && (
              <p role="status" aria-live="polite" className="mt-3 text-sm font-semibold text-green-700">
                {cartMessage}
              </p>
            )}
            <Link href="/#produtos" className="mt-3 inline-block text-sm font-semibold text-blue-700 underline">
              Continuar comprando
            </Link>
          </div>
        </section>

        {imageExpanded && selectedMedia?.media_type !== "video" && (
          <div
            className="detail-image-lightbox"
            role="dialog"
            aria-modal="true"
            aria-label="Foto ampliada do produto"
            onClick={() => setImageExpanded(false)}
            onTouchStart={(event) => {
              if (event.touches.length === 1) setTouchStartX(event.touches[0].clientX);
            }}
            onTouchEnd={(event) => {
              if (touchStartX === null || galleryItems.length < 2) return;
              const deltaX = event.changedTouches[0].clientX - touchStartX;
              if (Math.abs(deltaX) > 45) {
                const nextIndex = (currentGalleryIndex + (deltaX < 0 ? 1 : -1) + galleryItems.length) % galleryItems.length;
                const next = galleryItems[nextIndex];
                setSelectedMedia(next.id === "main" ? null : next as ProductMedia);
              }
              setTouchStartX(null);
            }}
          >
            <button
              type="button"
              className="detail-image-lightbox-close"
              onClick={() => setImageExpanded(false)}
              aria-label="Fechar foto ampliada"
            >
              <X size={28} />
            </button>
            <img
              src={selectedMedia?.url || product.image_url || ""}
              alt={product.name}
              className="detail-image-lightbox-photo"
              onClick={(event) => event.stopPropagation()}
              draggable={false}
            />
            {galleryItems.filter((item) => item.media_type === "image").length > 1 && (
              <>
                <button
                  type="button"
                  className="detail-image-lightbox-arrow detail-image-lightbox-arrow-left"
                  aria-label="Foto anterior"
                  onClick={(event) => {
                    event.stopPropagation();
                    const imageItems = galleryItems.filter((item) => item.media_type === "image");
                    const currentImageIndex = imageItems.findIndex((item) => item.id === (selectedMedia?.id || "main"));
                    const next = imageItems[(currentImageIndex - 1 + imageItems.length) % imageItems.length];
                    setSelectedMedia(next.id === "main" ? null : next as ProductMedia);
                  }}
                ><ChevronLeft size={30} /></button>
                <button
                  type="button"
                  className="detail-image-lightbox-arrow detail-image-lightbox-arrow-right"
                  aria-label="Próxima foto"
                  onClick={(event) => {
                    event.stopPropagation();
                    const imageItems = galleryItems.filter((item) => item.media_type === "image");
                    const currentImageIndex = imageItems.findIndex((item) => item.id === (selectedMedia?.id || "main"));
                    const next = imageItems[(currentImageIndex + 1) % imageItems.length];
                    setSelectedMedia(next.id === "main" ? null : next as ProductMedia);
                  }}
                ><ChevronRight size={30} /></button>
              </>
            )}
            <p className="detail-image-lightbox-caption">{product.name} · Deslize para trocar a foto ou toque fora para fechar</p>
          </div>
        )}

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
