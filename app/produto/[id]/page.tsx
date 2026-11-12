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
  photos?: string[] | null;
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
  const [rating, setRating] = useState(5);
  const [reviewFiles, setReviewFiles] = useState<File[]>([]);
  const [reviewId, setReviewId] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [cartMessage, setCartMessage] = useState("");
  const [cartPreview, setCartPreview] = useState<{ product: Product; qty: number }[]>([]);
  const [cartPreviewLoading, setCartPreviewLoading] = useState(true);


  async function loadCartPreview() {
    setCartPreviewLoading(true);
    try {
      const { data: authData } = await supabase.auth.getUser();
      let items: { id: string; qty: number }[] = [];
      if (authData.user?.id) {
        const { data, error } = await supabase
          .from("customer_carts")
          .select("items")
          .eq("user_id", authData.user.id)
          .maybeSingle();
        if (error) throw error;
        items = Array.isArray(data?.items) ? data.items : [];
      } else {
        const saved = localStorage.getItem("novashopp_cart");
        const parsed = saved ? JSON.parse(saved) : [];
        items = Array.isArray(parsed) ? parsed : [];
      }

      const validItems = items.filter((item: any) =>
        item && typeof item.id === "string" &&
        Number.isInteger(item.qty) && item.qty > 0
      );
      const ids = [...new Set(validItems.map((item) => item.id))];
      if (!ids.length) {
        setCartPreview([]);
        return;
      }

      const { data, error } = await supabase
        .from("products")
        .select("id,name,description,price,stock,category,image_url")
        .in("id", ids)
        .eq("active", true);
      if (error) throw error;

      const productsById = new Map((data || []).map((item) => [item.id, item as Product]));
      setCartPreview(
        validItems.flatMap((item) => {
          const cartProduct = productsById.get(item.id);
          return cartProduct ? [{ product: cartProduct, qty: item.qty }] : [];
        })
      );
    } catch (error) {
      console.error("Erro ao carregar a prévia do carrinho:", error);
      setCartPreview([]);
    } finally {
      setCartPreviewLoading(false);
    }
  }

  useEffect(() => {
    void loadCartPreview();
  }, []);

  async function loadReviews() {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    const response = await fetch(`/api/reviews?productId=${encodeURIComponent(productId)}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      cache: "no-store",
    });
    const result = await response.json();
    if (response.ok) {
      setReviews(result.reviews || []);
      if (result.ownReview) {
        setReviewId(result.ownReview.id);
        setRating(result.ownReview.rating);
      }
    }
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

  async function submitReview() {
    if (saving) return;
    setSaving(true);
    setMessage("");
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) {
        setMessage("Entre na sua conta para avaliar este produto.");
        return;
      }

      const form = new FormData();
      form.append("productId", productId);
      form.append("rating", String(rating));
      reviewFiles.forEach((file) => form.append("media", file));

      const response = await fetch("/api/reviews", {
        method: reviewId ? "PATCH" : "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: reviewId ? (() => { form.append("reviewId", reviewId); return form; })() : form,
      });
      const result = await response.json();
      if (!response.ok) {
        setMessage(result.error || "Não foi possível enviar a avaliação.");
      } else {
        setReviewId(result.review?.id || reviewId);
        setReviewFiles([]);
        setMessage(result.message || "Avaliação enviada para aprovação.");
        await loadReviews();
      }
    } catch {
      setMessage("Não foi possível enviar sua avaliação. Tente novamente.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteReview() {
    if (!reviewId || saving) return;
    if (!window.confirm("Deseja excluir sua avaliação?")) return;
    setSaving(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      const response = await fetch("/api/reviews", {
        method: "DELETE",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ reviewId, productId }),
      });
      const result = await response.json();
      setMessage(result.message || result.error || "");
      if (response.ok) {
        setReviewId("");
        setRating(5);
        setReviewFiles([]);
        await loadReviews();
      }
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <main className="mx-auto max-w-5xl p-6">Carregando produto...</main>;
  }

  if (!product) {
    return (
      <main className="mx-auto max-w-5xl p-6">
        <p>Produto não encontrado ou indisponível.</p>
        <Link className="detail-back-link" href="/"><span aria-hidden="true">←</span> Voltar à loja</Link>
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

  async function addProductToCart() {
    if (!product || product.stock <= 0) return;
    try {
      const { data: authData } = await supabase.auth.getUser();
      const userId = authData.user?.id || null;
      let items: { id: string; qty: number }[] = [];

      if (userId) {
        const { data: cloudCart, error: readError } = await supabase
          .from("customer_carts")
          .select("items")
          .eq("user_id", userId)
          .maybeSingle();

        if (readError) throw readError;
        const cloudItems = Array.isArray(cloudCart?.items) ? cloudCart.items : [];
        items = cloudItems.filter((item: any) =>
          item && typeof item.id === "string" &&
          Number.isInteger(item.qty) && item.qty > 0
        );
      } else {
        const saved = localStorage.getItem("novashopp_cart");
        const parsed = saved ? JSON.parse(saved) : [];
        items = Array.isArray(parsed)
          ? parsed.filter((item: any) =>
              item && typeof item.id === "string" &&
              Number.isInteger(item.qty) && item.qty > 0
            )
          : [];
      }

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

      if (userId) {
        const { error: saveError } = await supabase
          .from("customer_carts")
          .upsert({
            user_id: userId,
            items: updated,
            updated_at: new Date().toISOString(),
          }, { onConflict: "user_id" });

        if (saveError) throw saveError;
      }

      setCartMessage("Produto adicionado ao carrinho com sucesso!");
      await loadCartPreview();
    } catch (error) {
      console.error("Erro ao adicionar produto ao carrinho:", error);
      setCartMessage("Não foi possível atualizar seu carrinho. Tente novamente.");
    }
  }

  return (
    <main className="product-detail-page">
      <div className="product-detail-container">
        <Link
          href="/"
          className="detail-back-link"
          style={{
            display: "inline-flex",
            minHeight: "46px",
            alignItems: "center",
            gap: "10px",
            margin: "0 0 22px",
            padding: "0 20px 0 14px",
            border: "1px solid #173b70",
            borderRadius: "13px",
            background: "linear-gradient(115deg, #071b43 0%, #17477f 100%)",
            color: "#fff",
            fontSize: "13px",
            fontWeight: 800,
            letterSpacing: ".01em",
            boxShadow: "0 5px 0 #d6a91d, 0 9px 20px #071b4322",
            transition: "transform .2s ease, box-shadow .2s ease",
            textDecoration: "none",
          }}
        >
          <span style={{
            display: "grid",
            width: "28px",
            height: "28px",
            placeItems: "center",
            borderRadius: "9px",
            background: "#ffc928",
            color: "#071b43",
          }}>
            <ArrowLeft size={17} />
          </span>
          Voltar à loja
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
            <section
              aria-label="Meu carrinho"
              style={{
                marginTop: 22,
                padding: 18,
                border: "1px solid #dbe3ef",
                borderRadius: 16,
                background: "#f8fafc",
                boxShadow: "0 8px 24px #0f27400d",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 14 }}>
                <h2 style={{ margin: 0, color: "#102a56", fontSize: 18, fontWeight: 800 }}>
                  <ShoppingCart size={19} style={{ display: "inline", verticalAlign: "middle", marginRight: 7 }} />
                  Meu carrinho
                </h2>
                <span style={{ borderRadius: 999, padding: "5px 10px", background: "#facc15", color: "#102a56", fontSize: 12, fontWeight: 800 }}>
                  {cartPreview.reduce((sum, item) => sum + item.qty, 0)} item(ns)
                </span>
              </div>
              {cartPreviewLoading ? (
                <p style={{ margin: 0, color: "#64748b", fontSize: 14 }}>Carregando seu carrinho...</p>
              ) : cartPreview.length === 0 ? (
                <p style={{ margin: 0, color: "#64748b", fontSize: 14 }}>Seu carrinho está vazio. Adicione este produto para começar.</p>
              ) : (
                <>
                  <div style={{ display: "grid", gap: 12 }}>
                    {cartPreview.map(({ product: cartProduct, qty }) => (
                      <div key={cartProduct.id} style={{ display: "flex", alignItems: "center", gap: 12, paddingBottom: 10, borderBottom: "1px solid #e2e8f0" }}>
                        <div style={{ width: 54, height: 54, flex: "0 0 54px", display: "grid", placeItems: "center", overflow: "hidden", borderRadius: 10, background: "#fff" }}>
                          {cartProduct.image_url ? (
                            <img src={cartProduct.image_url} alt={cartProduct.name} style={{ width: "100%", height: "100%", objectFit: "contain" }} />
                          ) : <Package size={25} color="#64748b" />}
                        </div>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <strong style={{ display: "block", color: "#172554", fontSize: 13, lineHeight: 1.35 }}>{cartProduct.name}</strong>
                          <span style={{ color: "#64748b", fontSize: 12 }}>{qty} × {money(Number(cartProduct.price))}</span>
                        </div>
                        <strong style={{ color: "#102a56", fontSize: 13, whiteSpace: "nowrap" }}>{money(Number(cartProduct.price) * qty)}</strong>
                      </div>
                    ))}
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, paddingTop: 14 }}>
                    <span style={{ color: "#475569", fontWeight: 700 }}>Subtotal</span>
                    <strong style={{ color: "#102a56", fontSize: 18 }}>
                      {money(cartPreview.reduce((sum, item) => sum + Number(item.product.price) * item.qty, 0))}
                    </strong>
                  </div>
                  <Link href="/#produtos" style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: 46, marginTop: 14, padding: "10px 16px", borderRadius: 11, background: "#102a56", color: "#fff", fontWeight: 800, fontSize: 14, textDecoration: "none" }}>
                    Ir ao carrinho e finalizar compra <ArrowLeft size={16} style={{ transform: "rotate(180deg)", marginLeft: 8 }} />
                  </Link>
                </>
              )}
            </section>
            <Link
              href="/#produtos"
              aria-label="Voltar à loja para continuar comprando"
              style={{
                display: "flex",
                width: "100%",
                minHeight: "54px",
                marginTop: "16px",
                padding: "14px 22px",
                alignItems: "center",
                justifyContent: "center",
                gap: "10px",
                border: "2px solid #14264d",
                borderRadius: "14px",
                background: "#facc15",
                color: "#14264d",
                fontSize: "16px",
                fontWeight: 800,
                lineHeight: 1.2,
                textDecoration: "none",
                boxShadow: "0 4px 0 #14264d",
                cursor: "pointer",
              }}
            >
              <ShoppingCart size={20} />
              Continuar comprando
              <ArrowLeft size={18} style={{ transform: "rotate(180deg)" }} />
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
                    {review.comment && <p className="review-comment">{review.comment}</p>}
                    {review.photos?.length ? <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>{review.photos.map((url) => /\.(mp4|webm|mov)(\?|$)/i.test(url) ? <video key={url} src={url} controls playsInline style={{ maxWidth: "100%", width: 180, borderRadius: 8 }} /> : <a key={url} href={url} target="_blank" rel="noreferrer"><img src={url} alt="Foto enviada na avaliação" style={{ width: 100, height: 100, objectFit: "cover", borderRadius: 8 }} /></a>)}</div> : null}
                    <span className="verified-purchase">Compra verificada</span>
                  </article>
                ))}
              </div>
            )}
          </div>

          <div className="detail-panel review-form-panel">
            <h2 className="detail-panel-title">Avalie este produto</h2>
            <p className="review-form-intro">Compartilhe fotos ou vídeo do produto recebido e sua nota. Disponível para clientes com compra paga e entregue.</p>
            <label className="review-label">Fotos do produto recebido</label>
            <input
              type="file"
              accept="image/*,video/mp4,video/webm,video/quicktime"
              multiple
              onChange={(event) => setReviewFiles(Array.from(event.target.files || []))}
              className="review-input"
            />
            <p style={{ color: "#64748b", fontSize: 12, marginTop: 6 }}>Você pode selecionar até 5 arquivos, com no máximo 50 MB cada.</p>
            {reviewFiles.length > 0 && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(82px,1fr))", gap: 8, marginTop: 10 }}>
                {reviewFiles.map((file, index) => (
                  <div key={index} style={{ padding: 8, border: "1px solid #dbe3ef", borderRadius: 8, fontSize: 11, overflowWrap: "anywhere" }}>
                    {file.type.startsWith("video/") ? "🎥 Vídeo" : "📷 Foto"}<br />{file.name}
                  </div>
                ))}
              </div>
            )}
            <label className="review-label review-label-spaced">Sua nota</label>
            <div className="review-star-picker" aria-label="Selecione sua nota de 1 a 5 estrelas">
              {[1, 2, 3, 4, 5].map((value) => (
                <button key={value} type="button" onClick={() => setRating(value)} aria-label={`${value} estrelas`} aria-pressed={value === rating} className={value <= rating ? "review-star-selected" : "review-star-unselected"}>★</button>
              ))}
            </div>
            <button onClick={submitReview} disabled={saving} className="review-submit-button">
              {saving ? "Enviando..." : reviewId ? "Atualizar avaliação" : "ENVIAR"}
            </button>
            {reviewId && <button onClick={deleteReview} disabled={saving} className="review-delete-button">Excluir minha avaliação</button>}
            {message && <p className="review-message" role="status">{message}</p>}
          </div>
          </div>
        </section>
      </div>
    </main>
  );
}
