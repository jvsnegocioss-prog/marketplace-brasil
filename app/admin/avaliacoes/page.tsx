"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

type Review = {
  id: string;
  product_id: string;
  product_name: string;
  order_id: string;
  reviewer_name: string;
  rating: number;
  comment: string;
  photos: string[] | null;
  status: "pending" | "approved" | "hidden";
  created_at: string;
};

type Filter = "all" | "pending" | "approved" | "hidden";

const button = (background: string): React.CSSProperties => ({
  border: 0,
  borderRadius: 8,
  padding: "10px 14px",
  background,
  color: "#fff",
  fontWeight: 700,
  cursor: "pointer",
  marginRight: 8,
  marginTop: 8,
});

const statusLabels: Record<string, string> = {
  pending: "Aguardando aprovação",
  approved: "Publicada",
  hidden: "Oculta",
};

export default function AdminReviewsPage() {
  const router = useRouter();
  const [authorized, setAuthorized] = useState(false);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [filter, setFilter] = useState<Filter>("pending");
  const [message, setMessage] = useState("");

  useEffect(() => {
    async function checkAdmin() {
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError || !userData.user) {
        router.replace("/admin/login");
        return;
      }
      const { data, error } = await supabase.rpc("is_marketplace_admin");
      if (error || data !== true) {
        await supabase.auth.signOut();
        router.replace("/admin/login");
        return;
      }
      setAuthorized(true);
      setLoading(false);
    }
    checkAdmin();
  }, [router]);

  useEffect(() => {
    if (authorized) loadReviews();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authorized, filter]);

  async function getToken() {
    const { data, error } = await supabase.auth.getSession();
    if (error || !data.session?.access_token) {
      router.replace("/admin/login");
      throw new Error("Sua sessão expirou. Entre novamente.");
    }
    return data.session.access_token;
  }

  async function loadReviews() {
    setMessage("");
    try {
      const token = await getToken();
      const response = await fetch(`/api/admin/reviews?status=${filter}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Erro ao carregar avaliações.");
      setReviews(result.reviews || []);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Erro ao carregar avaliações.");
    }
  }

  async function changeStatus(reviewId: string, status: Review["status"]) {
    setSavingId(reviewId);
    setMessage("");
    try {
      const token = await getToken();
      const response = await fetch("/api/admin/reviews", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ reviewId, status }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Não foi possível atualizar.");
      setMessage("Situação da avaliação atualizada.");
      await loadReviews();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Erro ao atualizar avaliação.");
    } finally {
      setSavingId(null);
    }
  }

  if (loading) return <main style={{ padding: 24 }}>Verificando acesso administrativo...</main>;
  if (!authorized) return null;

  return (
    <main style={{ maxWidth: 1000, margin: "0 auto", padding: 20, fontFamily: "Arial, sans-serif" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ marginBottom: 6 }}>Moderação de avaliações</h1>
          <p style={{ color: "#555", marginTop: 0 }}>Aprove, oculte ou revise os comentários dos compradores.</p>
        </div>
        <Link href="/admin" style={{ color: "#174ea6", fontWeight: 700 }}>Voltar ao painel</Link>
      </header>

      <nav style={{ display: "flex", flexWrap: "wrap", gap: 8, margin: "18px 0" }}>
        {([
          ["pending", "Pendentes"],
          ["approved", "Publicadas"],
          ["hidden", "Ocultas"],
          ["all", "Todas"],
        ] as [Filter, string][]).map(([value, label]) => (
          <button key={value} onClick={() => setFilter(value)} style={{ ...button(filter === value ? "#173b70" : "#666"), margin: 0 }}>
            {label}
          </button>
        ))}
        <button onClick={loadReviews} style={{ ...button("#222"), margin: 0 }}>Atualizar</button>
      </nav>

      {message && <p role="status" style={{ padding: 12, background: "#eef3f8", borderRadius: 8 }}>{message}</p>}
      <p>{reviews.length} avaliação(ões) nesta lista.</p>

      {reviews.length === 0 && <p>Nenhuma avaliação encontrada neste filtro.</p>}

      {reviews.map((review) => (
        <article key={review.id} style={{ border: "1px solid #ddd", borderRadius: 12, padding: 16, marginBottom: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <div>
              <h2 style={{ fontSize: 18, margin: "0 0 6px" }}>{review.product_name}</h2>
              <strong>{review.reviewer_name}</strong>
              <div aria-label={`${review.rating} de 5 estrelas`} style={{ color: "#d18a00", marginTop: 5 }}>
                {"★".repeat(review.rating)}{"☆".repeat(5 - review.rating)}
              </div>
            </div>
            <span style={{ alignSelf: "flex-start", padding: "6px 10px", borderRadius: 20, background: "#f0f0f0", fontSize: 13 }}>
              {statusLabels[review.status] || review.status}
            </span>
          </div>

          <p style={{ whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{review.comment}</p>
          <small style={{ color: "#666" }}>Enviada em {new Date(review.created_at).toLocaleString("pt-BR")}</small>
          {review.photos?.length ? (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
              {review.photos.map((media) => /\.(mp4|webm|mov)(\?|$)/i.test(media)
                ? <video key={media} src={media} controls playsInline style={{ width: 180, maxHeight: 140, borderRadius: 8 }} />
                : <a key={media} href={media} target="_blank" rel="noreferrer"><img src={media} alt="Foto enviada pelo cliente" style={{ width: 90, height: 90, objectFit: "cover", borderRadius: 8 }} /></a>)}
            </div>
          ) : null}

          <div style={{ marginTop: 12 }}>
            {review.status !== "approved" && (
              <button disabled={savingId === review.id} onClick={() => changeStatus(review.id, "approved")} style={button("#16803c")}>Aprovar e publicar</button>
            )}
            {review.status !== "hidden" && (
              <button disabled={savingId === review.id} onClick={() => changeStatus(review.id, "hidden")} style={button("#a52a2a")}>Ocultar</button>
            )}
            {review.status !== "pending" && (
              <button disabled={savingId === review.id} onClick={() => changeStatus(review.id, "pending")} style={button("#555")}>Voltar para pendente</button>
            )}
          </div>
        </article>
      ))}
    </main>
  );
}
