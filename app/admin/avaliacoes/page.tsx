"use client";

import { useEffect, useState } from "react";
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

  if (loading) return <main style={{minHeight:"100vh",background:"#f3f6fb",padding:24,color:"#14243a"}}>Verificando acesso administrativo...</main>;
  if (!authorized) return null;
  const card: React.CSSProperties={background:"#fff",border:"1px solid #e2e8f0",borderRadius:15,padding:18,boxShadow:"0 5px 16px rgba(15,23,42,.045)"};
  const btn: React.CSSProperties={padding:"10px 14px",border:0,borderRadius:8,background:"#173b68",color:"#fff",cursor:"pointer",fontWeight:700};
  const pending=reviews.filter(r=>r.status==="pending").length;
  const published=reviews.filter(r=>r.status==="approved").length;
  const hidden=reviews.filter(r=>r.status==="hidden").length;
  return (
    <main className="admin-reviews" style={{minHeight:"100vh",background:"#f3f6fb",padding:"24px 16px 48px",fontFamily:"Arial,sans-serif",color:"#14243a"}}>
      <div style={{maxWidth:1080,margin:"auto"}}>
        <header className="admin-reviews-header" style={{background:"linear-gradient(125deg,#102b50,#1d4d7c)",color:"#fff",padding:"26px 24px",borderRadius:18,display:"flex",justifyContent:"space-between",alignItems:"center",gap:16,flexWrap:"wrap",boxShadow:"0 12px 28px rgba(16,43,80,.16)"}}>
          <div><p style={{margin:"0 0 8px",color:"#f6cc55",fontSize:12,fontWeight:800,letterSpacing:2}}>NOVASHOPP STORE · ADMINISTRAÇÃO</p><h1 style={{margin:0,fontSize:28}}>Gestão de avaliações</h1><p style={{margin:"8px 0 0",color:"#d8e5f3"}}>Acompanhe, aprove e gerencie as avaliações dos compradores.</p></div>
          <button className="admin-back-button" type="button" onClick={()=>router.push("/admin")} style={{padding:"11px 16px",border:0,borderRadius:8,background:"#ffc928",color:"#173b68",cursor:"pointer",fontWeight:800}}>← Voltar ao painel</button>
        </header>
        <section style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(170px,1fr))",gap:12,margin:"18px 0"}}>
          {[{label:"Nesta lista",value:reviews.length,note:"Resultado do filtro atual"},{label:"Pendentes",value:pending,note:"Aguardando aprovação"},{label:"Publicadas",value:published,note:"Visíveis na loja"},{label:"Ocultas",value:hidden,note:"Não exibidas aos clientes"}].map(x=><article key={x.label} style={card}><p style={{margin:0,color:"#64748b",fontSize:13}}>{x.label}</p><strong style={{display:"block",fontSize:28,margin:"7px 0",color:"#173b68"}}>{x.value}</strong><small style={{color:"#8492a6"}}>{x.note}</small></article>)}
        </section>
        <section style={{...card,marginBottom:16}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,flexWrap:"wrap"}}><div><h2 style={{margin:0,fontSize:20}}>Avaliações recebidas</h2><p style={{margin:"5px 0 0",color:"#64748b",fontSize:13}}>Selecione uma situação para filtrar os comentários.</p></div><button onClick={loadReviews} style={btn}>↻ Atualizar</button></div>
          <nav style={{display:"flex",flexWrap:"wrap",gap:8,marginTop:16}}>{([["pending","Pendentes"],["approved","Publicadas"],["hidden","Ocultas"],["all","Todas"]] as [Filter,string][]).map(([value,label])=><button key={value} onClick={()=>setFilter(value)} style={{...btn,borderRadius:22,background:filter===value?"#173b68":"#e9eef5",color:filter===value?"#fff":"#334155"}}>{label}</button>)}</nav>
        </section>
        {message&&<p role="status" style={{background:"#fff",border:"1px solid #dbe3ef",padding:14,borderRadius:10,overflowWrap:"anywhere"}}>{message}</p>}
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,flexWrap:"wrap",margin:"24px 0 14px"}}><div><h2 style={{margin:0,fontSize:21}}>Lista de avaliações</h2><p style={{margin:"5px 0 0",color:"#64748b",fontSize:13}}>Revise os comentários e atualize a publicação.</p></div><span style={{color:"#64748b",fontSize:13}}>{reviews.length} registro(s)</span></div>
        {reviews.length===0&&<div style={{...card,borderStyle:"dashed",padding:28,textAlign:"center",color:"#64748b"}}>Nenhuma avaliação encontrada neste filtro.</div>}
        <div style={{display:"grid",gap:14}}>{reviews.map(review=><article key={review.id} style={card}>
          <div style={{display:"flex",justifyContent:"space-between",gap:12,flexWrap:"wrap",borderBottom:"1px solid #edf1f5",paddingBottom:14}}>
            <div><p style={{margin:"0 0 5px",color:"#64748b",fontSize:12,fontWeight:800,letterSpacing:1}}>PRODUTO AVALIADO</p><h3 style={{fontSize:19,margin:"0 0 7px",color:"#173b68"}}>{review.product_name}</h3><strong>{review.reviewer_name}</strong><div aria-label={`${review.rating} de 5 estrelas`} style={{color:"#d18a00",marginTop:5,fontSize:19}}>{"★".repeat(review.rating)}{"☆".repeat(5-review.rating)}</div></div>
            <span style={{alignSelf:"flex-start",padding:"7px 11px",borderRadius:20,background:review.status==="approved"?"#e9f7ee":review.status==="hidden"?"#eef2f6":"#fff5d6",color:review.status==="approved"?"#16713b":review.status==="hidden"?"#64748b":"#815c00",fontSize:12,fontWeight:800}}>{statusLabels[review.status]||review.status}</span>
          </div>
          <p style={{whiteSpace:"pre-wrap",lineHeight:1.6,margin:"16px 0 8px",color:"#334155"}}>{review.comment}</p><small style={{color:"#64748b"}}>Enviada em {new Date(review.created_at).toLocaleString("pt-BR")}</small>
          {review.photos?.length?<div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:14}}>{review.photos.map(media=>/\.(mp4|webm|mov)(\?|$)/i.test(media)?<video key={media} src={media} controls playsInline style={{width:180,maxHeight:140,borderRadius:8,background:"#0f172a"}}/>:<a key={media} href={media} target="_blank" rel="noreferrer"><img src={media} alt="Foto enviada pelo cliente" style={{width:100,height:100,objectFit:"cover",borderRadius:9,border:"1px solid #e2e8f0"}}/></a>)}</div>:null}
          <div style={{borderTop:"1px solid #edf1f5",marginTop:16,paddingTop:13,display:"flex",gap:8,flexWrap:"wrap"}}>
            {review.status!=="approved"&&<button disabled={savingId===review.id} onClick={()=>changeStatus(review.id,"approved")} style={{...btn,background:"#16713b"}}>{savingId===review.id?"Salvando...":"Aprovar e publicar"}</button>}
            {review.status!=="hidden"&&<button disabled={savingId===review.id} onClick={()=>changeStatus(review.id,"hidden")} style={{...btn,background:"#b42318"}}>Ocultar</button>}
            {review.status!=="pending"&&<button disabled={savingId===review.id} onClick={()=>changeStatus(review.id,"pending")} style={{...btn,background:"#64748b"}}>Voltar para pendente</button>}
          </div>
        </article>)}</div>
      </div>
    </main>
  );
}
