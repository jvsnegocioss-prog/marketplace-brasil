"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ImagePlus, Video, Sparkles, Trash2, Eye, EyeOff } from "lucide-react";
import { supabase } from "@/lib/supabase";

type Campaign = {
  id: string;
  title: string;
  subtitle: string;
  description: string;
  media_url: string | null;
  media_type: "image" | "video";
  storage_path: string | null;
  button_text: string;
  button_url: string;
  placement: "hero" | "middle" | "bottom";
  background_color: string;
  text_color: string;
  active: boolean;
  sort_order: number;
  start_at: string | null;
  end_at: string | null;
};

const blankCampaign = (): Partial<Campaign> => ({
  title: "", subtitle: "", description: "", media_url: null, media_type: "image",
  storage_path: null, button_text: "Confira", button_url: "/",
  placement: "hero", background_color: "#071b43", text_color: "#ffffff",
  active: false, sort_order: 0, start_at: null, end_at: null,
});

const field: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", padding: 12, border: "1px solid #d7deea",
  borderRadius: 9, marginTop: 6, marginBottom: 14, font: "inherit",
};

const button: React.CSSProperties = {
  border: 0, borderRadius: 9, padding: "12px 16px", background: "#071b43",
  color: "#fff", fontWeight: 700, cursor: "pointer", marginRight: 8, marginBottom: 8,
};

export default function AdminCampaignsPage() {
  const router = useRouter();
  const [authorized, setAuthorized] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [draft, setDraft] = useState<Partial<Campaign>>(blankCampaign());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewAiProposal, setPreviewAiProposal] = useState(false);
  const [previewMediaUrl, setPreviewMediaUrl] = useState<string | null>(null);
  const [mode, setMode] = useState<"manual" | "ai">("manual");
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiObjective, setAiObjective] = useState("");
  const [aiProduct, setAiProduct] = useState("");
  const [aiOffer, setAiOffer] = useState("");
  const [aiAudience, setAiAudience] = useState("");
  const [aiTone, setAiTone] = useState("Persuasivo e profissional");
  const [aiImageFile, setAiImageFile] = useState<File | null>(null);
  const [generating, setGenerating] = useState(false);
  const [aiProposal, setAiProposal] = useState<{
    title: string; subtitle: string; description: string; button_text: string;
    placement: "hero" | "middle" | "bottom"; visual_idea: string;
  } | null>(null);

  useEffect(() => {
    if (!mediaFile) { setPreviewMediaUrl(null); return; }
    const url = URL.createObjectURL(mediaFile);
    setPreviewMediaUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [mediaFile]);

  async function loadCampaigns() {
    const { data, error } = await supabase.from("homepage_campaigns")
      .select("*").order("sort_order", { ascending: true }).order("created_at", { ascending: false });
    if (error) throw error;
    setCampaigns((data || []) as Campaign[]);
  }

  useEffect(() => {
    let active = true;
    async function init() {
      const { data } = await supabase.auth.getUser();
      if (!data.user) { router.replace("/admin/login"); return; }
      const { data: isAdmin, error } = await supabase.rpc("is_marketplace_admin");
      if (error || !isAdmin) { router.replace("/admin/login"); return; }
      if (!active) return;
      setAuthorized(true);
      try { await loadCampaigns(); }
      catch (err) { setMessage(err instanceof Error ? err.message : "Erro ao carregar campanhas."); }
      finally { if (active) setLoading(false); }
    }
    void init();
    return () => { active = false; };
  }, [router]);

  function update<K extends keyof Campaign>(key: K, value: Campaign[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function editCampaign(campaign: Campaign) {
    setDraft({ ...campaign });
    setEditingId(campaign.id);
    setMediaFile(null);
    setMode("manual");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function resetForm() {
    setDraft(blankCampaign());
    setEditingId(null);
    setMediaFile(null);
  }

  async function generateCampaign() {
    if (generating) return;
    setGenerating(true);
    setMessage("");
    setAiProposal(null);
    try {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (sessionError || !token) throw new Error("Sua sessão expirou. Entre novamente no painel.");

      let imageBase64 = "";
      if (aiImageFile) {
        if (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(aiImageFile.type)) throw new Error("Envie uma imagem JPG, PNG, WEBP ou GIF.");
        if (aiImageFile.size > 8 * 1024 * 1024) throw new Error("A imagem deve ter no máximo 8 MB.");
        imageBase64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result || "").split(",")[1] || "");
          reader.onerror = () => reject(new Error("Não foi possível ler a imagem selecionada."));
          reader.readAsDataURL(aiImageFile);
        });
      }

      const response = await fetch("/api/admin/ai-campaign", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          prompt: aiPrompt,
          objective: aiObjective,
          product: aiProduct,
          offer: aiOffer,
          audience: aiAudience,
          tone: aiTone,
          imageBase64,
          imageMimeType: aiImageFile?.type || "",
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Não foi possível gerar a proposta.");
      setAiProposal(result);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Erro ao gerar proposta com IA.");
    } finally {
      setGenerating(false);
    }
  }

  function useAiProposal() {
    if (!aiProposal) return;
    setDraft((current) => ({
      ...current,
      title: aiProposal.title,
      subtitle: aiProposal.subtitle,
      description: aiProposal.description,
      button_text: aiProposal.button_text,
      placement: aiProposal.placement,
      button_url: current.button_url || "/",
      active: false,
    }));
    setEditingId(null);
    setMediaFile(null);
    setMode("manual");
    setMessage("Proposta aplicada ao editor manual como rascunho. Revise, adicione uma foto ou vídeo e salve quando estiver pronto.");
  }

  async function saveCampaign(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setMessage("");
    try {
      let mediaUrl = draft.media_url || null;
      let storagePath = draft.storage_path || null;
      let mediaType = draft.media_type || "image";

      if (mediaFile) {
        const isImage = mediaFile.type.startsWith("image/");
        const isVideo = mediaFile.type.startsWith("video/");
        if (!isImage && !isVideo) throw new Error("Escolha uma imagem ou vídeo válido.");
        if (mediaFile.size > 100 * 1024 * 1024) throw new Error("O arquivo deve ter no máximo 100 MB.");
        const extension = mediaFile.name.split(".").pop()?.toLowerCase() || (isImage ? "jpg" : "mp4");
        const path = `${crypto.randomUUID()}.${extension}`;
        const { error: uploadError } = await supabase.storage.from("campaign-media")
          .upload(path, mediaFile, { upsert: false, contentType: mediaFile.type });
        if (uploadError) throw uploadError;
        mediaUrl = supabase.storage.from("campaign-media").getPublicUrl(path).data.publicUrl;
        storagePath = path;
        mediaType = isImage ? "image" : "video";
      }

      const payload = {
        title: (draft.title || "").trim(),
        subtitle: (draft.subtitle || "").trim(),
        description: (draft.description || "").trim(),
        media_url: mediaUrl,
        media_type: mediaType,
        storage_path: storagePath,
        button_text: (draft.button_text || "Confira").trim(),
        button_url: (draft.button_url || "/").trim(),
        placement: draft.placement || "hero",
        background_color: draft.background_color || "#071b43",
        text_color: draft.text_color || "#ffffff",
        active: Boolean(draft.active),
        sort_order: Number(draft.sort_order || 0),
        start_at: draft.start_at || null,
        end_at: draft.end_at || null,
        updated_at: new Date().toISOString(),
      };

      if (editingId) {
        const { error } = await supabase.from("homepage_campaigns").update(payload).eq("id", editingId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("homepage_campaigns").insert(payload);
        if (error) throw error;
      }
      setMessage("Campanha salva. A publicação respeita o status e o período definidos.");
      resetForm();
      await loadCampaigns();
    } catch (err) {
      const details = err && typeof err === "object" && "message" in err
        ? String((err as { message?: unknown }).message || "")
        : err instanceof Error ? err.message : "";
      const code = err && typeof err === "object" && "code" in err
        ? String((err as { code?: unknown }).code || "")
        : "";
      setMessage(details
        ? `Falha ao salvar campanha: ${details}${code ? ` (código: ${code})` : ""}`
        : "Não foi possível salvar a campanha. Verifique os dados e tente novamente.");
    } finally {
      setSaving(false);
    }
  }

  async function toggleCampaign(campaign: Campaign) {
    const { error } = await supabase.from("homepage_campaigns")
      .update({ active: !campaign.active, updated_at: new Date().toISOString() }).eq("id", campaign.id);
    if (error) { setMessage(error.message); return; }
    await loadCampaigns();
  }

  async function deleteCampaign(campaign: Campaign) {
    if (!window.confirm("Excluir esta campanha definitivamente?")) return;
    const { error } = await supabase.from("homepage_campaigns").delete().eq("id", campaign.id);
    if (error) { setMessage(error.message); return; }
    if (campaign.storage_path) {
      const { error: storageError } = await supabase.storage.from("campaign-media").remove([campaign.storage_path]);
      if (storageError) console.warn("Arquivo mantido no armazenamento:", storageError.message);
    }
    setMessage("Campanha excluída.");
    await loadCampaigns();
  }

  const previewCampaign = previewAiProposal && aiProposal
    ? { ...draft, ...aiProposal, media_url: null, media_type: "image" as const }
    : draft;

  if (loading) return <main style={{ padding: 24 }}>Carregando publicidade...</main>;
  if (!authorized) return null;

  return (
    <main style={{ maxWidth: 1100, margin: "0 auto", padding: 20, color: "#10213e" }}>
      <button type="button" onClick={() => router.push("/admin")} style={{ ...button, background: "#e8edf5", color: "#071b43" }}>
        <ArrowLeft size={16} style={{ verticalAlign: "middle" }} /> Voltar ao painel
      </button>
      <header style={{ margin: "14px 0 22px" }}>
        <p style={{ color: "#b18400", fontWeight: 800, letterSpacing: 1 }}>NOVASHOPP STORE</p>
        <h1 style={{ margin: "4px 0", fontSize: 30 }}>Publicidade e Promoções</h1>
        <p style={{ color: "#64748b" }}>Crie campanhas manualmente. A IA será uma assistente opcional, nunca publica sozinha.</p>
      </header>

      {previewOpen && (
        <div role="dialog" aria-modal="true" aria-label="Prévia da campanha" onClick={() => { setPreviewOpen(false); setPreviewAiProposal(false); }} style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(4,12,28,.78)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div onClick={(event) => event.stopPropagation()} style={{ width: "100%", maxWidth: 850, maxHeight: "90vh", overflowY: "auto", background: "#fff", borderRadius: 18, padding: 18, boxShadow: "0 20px 60px rgba(0,0,0,.3)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 14 }}>
              <div><strong style={{ color: "#071b43" }}>Prévia da campanha</strong><p style={{ margin: "4px 0 0", color: "#64748b", fontSize: 13 }}>Simulação — nada será publicado nesta etapa.</p></div>
              <button type="button" onClick={() => { setPreviewOpen(false); setPreviewAiProposal(false); }} style={{ ...button, margin: 0 }}>Fechar</button>
            </div>
            <div style={{ borderRadius: 14, overflow: "hidden", background: previewCampaign.background_color || "#071b43", color: previewCampaign.text_color || "#ffffff", display: "grid", gridTemplateColumns: (!previewAiProposal && (previewMediaUrl || previewCampaign.media_url)) ? "repeat(auto-fit,minmax(240px,1fr))" : "1fr", minHeight: 230 }}>
              {(!previewAiProposal && (previewMediaUrl || previewCampaign.media_url)) && (
                <div style={{ minHeight: 220, background: "#071b43", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  {(mediaFile ? mediaFile.type.startsWith("video/") : previewCampaign.media_type === "video") ? <video src={previewMediaUrl || previewCampaign.media_url || undefined} controls playsInline style={{ width: "100%", maxHeight: 360, objectFit: "contain" }} /> : <img src={previewMediaUrl || previewCampaign.media_url || undefined} alt="Prévia da campanha" style={{ width: "100%", maxHeight: 360, objectFit: "contain" }} />}
                </div>
              )}
              <div style={{ padding: "clamp(22px,5vw,42px)", display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "flex-start" }}>
                <small style={{ opacity: .8, fontWeight: 800, letterSpacing: 1 }}>NOVASHOPP STORE</small>
                <h2 style={{ fontSize: "clamp(25px,4vw,38px)", lineHeight: 1.1, margin: "12px 0 8px" }}>{previewCampaign.title || "Título da sua campanha"}</h2>
                {previewCampaign.subtitle && <h3 style={{ margin: "0 0 10px", fontSize: 19 }}>{previewCampaign.subtitle}</h3>}
                {previewCampaign.description && <p style={{ whiteSpace: "pre-wrap", lineHeight: 1.55 }}>{previewCampaign.description}</p>}
                <span style={{ display: "inline-block", marginTop: 12, padding: "12px 20px", borderRadius: 8, background: "#ffc928", color: "#071b43", fontWeight: 800 }}>{previewCampaign.button_text || "Confira"}</span>
              </div>
            </div>
            <p style={{ color: "#64748b", fontSize: 13, marginBottom: 0 }}>Posição escolhida: {previewCampaign.placement === "hero" ? "Banner principal (topo)" : previewCampaign.placement === "middle" ? "Entre as seções" : "Próximo ao final"}. A aparência pode variar um pouco conforme o dispositivo.</p>
          </div>
        </div>
      )}

      <section style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 18 }}>
        <button type="button" onClick={() => setMode("manual")} style={{ ...button, background: mode === "manual" ? "#071b43" : "#e8edf5", color: mode === "manual" ? "#fff" : "#071b43" }}>
          <ImagePlus size={16} style={{ verticalAlign: "middle" }} /> Criar manualmente
        </button>
        <button type="button" onClick={() => setMode("ai")} style={{ ...button, background: mode === "ai" ? "#071b43" : "#e8edf5", color: mode === "ai" ? "#fff" : "#071b43" }}>
          <Sparkles size={16} style={{ verticalAlign: "middle" }} /> Assistente de IA
        </button>
      </section>

      {mode === "ai" ? (
        <section style={{ border: "1px solid #f0d98a", background: "#fff9e7", borderRadius: 14, padding: 18, marginBottom: 22 }}>
          <h2 style={{ marginTop: 0 }}>Assistente de criação com IA</h2>
          <p style={{ color: "#64748b" }}>Informe o que deseja divulgar e, se quiser, escreva um prompt próprio para orientar a IA. Ela preparará uma sugestão que você poderá revisar e editar manualmente.</p>
          <label style={{ display: "block", fontWeight: 700 }}>Prompt personalizado para a IA ler (opcional)<textarea rows={6} maxLength={4000} value={aiPrompt} onChange={(e) => setAiPrompt(e.target.value)} placeholder={"Escreva aqui suas instruções, ideias, briefing ou texto de referência. Ex.: crie um banner com foco em tecnologia, destaque a identidade visual azul-marinho e amarelo e use uma linguagem moderna..."} style={{ ...field, resize: "vertical", lineHeight: 1.5 }} /></label>
          <small style={{ display: "block", color: "#64748b", marginTop: -10, marginBottom: 14 }}>{aiPrompt.length}/4000 caracteres. A IA usará este texto como orientação adicional, respeitando as regras da loja.</small>
          <label>Objetivo da campanha<input value={aiObjective} onChange={(e) => setAiObjective(e.target.value)} placeholder="Ex.: divulgar uma promoção de fim de semana" style={field} /></label>
          <label>Produto ou categoria<input value={aiProduct} onChange={(e) => setAiProduct(e.target.value)} placeholder="Ex.: acessórios para celular" style={field} /></label>
          <label>Oferta e condições confirmadas<input value={aiOffer} onChange={(e) => setAiOffer(e.target.value)} placeholder="Ex.: 10% de desconto até domingo (se confirmado)" style={field} /></label>
          <label>Público que deseja alcançar<input value={aiAudience} onChange={(e) => setAiAudience(e.target.value)} placeholder="Ex.: pessoas que procuram tecnologia" style={field} /></label>
          <label>Estilo da comunicação<select value={aiTone} onChange={(e) => setAiTone(e.target.value)} style={field}>
            <option>Persuasivo e profissional</option><option>Moderno e descontraído</option><option>Elegante e sofisticado</option><option>Direto e promocional</option><option>Amigável e próximo</option>
          </select></label>
          <div style={{ border: "1px dashed #c7d2e2", borderRadius: 12, padding: 14, margin: "4px 0 16px", background: "#fff" }}>
            <label style={{ display: "block", fontWeight: 700 }}>Ou envie uma imagem para a IA analisar (opcional)
              <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={(e) => setAiImageFile(e.target.files?.[0] || null)} style={field} />
            </label>
            <small style={{ color: "#64748b" }}>Você pode enviar somente a imagem, sem preencher os campos acima, ou combinar a imagem com os detalhes. Formatos JPG, PNG, WEBP ou GIF, até 8 MB.</small>
            {aiImageFile && <p style={{ marginBottom: 0, fontWeight: 700 }}>Imagem selecionada: {aiImageFile.name} <button type="button" onClick={() => setAiImageFile(null)} style={{ ...button, padding: "6px 10px", marginLeft: 8 }}>Remover</button></p>}
          </div>
          <button type="button" disabled={generating} onClick={generateCampaign} style={{ ...button, background: "#ffc928", color: "#071b43", opacity: generating ? 0.65 : 1 }}>
            <Sparkles size={16} style={{ verticalAlign: "middle" }} /> {generating ? "Criando sugestão..." : "Gerar sugestão com IA"}
          </button>
          {aiProposal && (
            <div style={{ marginTop: 18, padding: 16, border: "1px solid #dce3ed", borderRadius: 12, background: "#fff" }}>
              <p style={{ color: "#b18400", fontWeight: 800, marginTop: 0 }}>PROPOSTA GERADA — NÃO PUBLICADA</p>
              <h3 style={{ marginBottom: 6 }}>{aiProposal.title}</h3>
              <p style={{ fontWeight: 700 }}>{aiProposal.subtitle}</p>
              <p style={{ whiteSpace: "pre-wrap" }}>{aiProposal.description}</p>
              <p><strong>Botão sugerido:</strong> {aiProposal.button_text}</p>
              <p><strong>Posição sugerida:</strong> {aiProposal.placement === "hero" ? "Banner principal" : aiProposal.placement === "middle" ? "Entre as seções" : "Próximo ao final"}</p>
              <p><strong>Ideia visual:</strong> {aiProposal.visual_idea}</p>
              <button type="button" onClick={() => { setPreviewAiProposal(true); setPreviewOpen(true); }} style={{ ...button, background: "#e8edf5", color: "#071b43" }}><Eye size={16} style={{ verticalAlign: "middle" }} /> Visualizar antes de publicar</button>
              <button type="button" onClick={useAiProposal} style={{ ...button, background: "#ffc928", color: "#071b43" }}>Usar proposta no editor manual</button>
            </div>
          )}
          <p style={{ marginBottom: 0, fontWeight: 700 }}>Você pode usar os campos, enviar uma imagem ou combinar os dois. A IA não salva nem publica campanhas sozinha; a proposta só vai para o editor se você escolher usá-la.</p>
        </section>
      ) : (
        <form onSubmit={saveCampaign} style={{ border: "1px solid #dce3ed", borderRadius: 14, padding: 18, background: "#fff", marginBottom: 28 }}>
          <h2 style={{ marginTop: 0 }}>{editingId ? "Editar campanha" : "Nova campanha manual"}</h2>
          <label>Título da propaganda<input required maxLength={100} value={draft.title || ""} onChange={(e) => update("title", e.target.value)} style={field} /></label>
          <label>Chamada ou subtítulo<input value={draft.subtitle || ""} onChange={(e) => update("subtitle", e.target.value)} style={field} /></label>
          <label>Descrição<textarea rows={3} value={draft.description || ""} onChange={(e) => update("description", e.target.value)} style={field} /></label>
          <label>Foto ou vídeo da campanha<input type="file" accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime" onChange={(e) => setMediaFile(e.target.files?.[0] || null)} style={field} /></label>
          <small style={{ display: "block", marginTop: -8, marginBottom: 14, color: "#64748b" }}>Imagem ou vídeo de até 100 MB. Se não enviar mídia, a campanha usa um fundo com texto.</small>
          {mediaFile && <p>Arquivo selecionado: <strong>{mediaFile.name}</strong></p>}
          {!mediaFile && draft.media_url && (
            <div style={{ marginBottom: 16 }}>
              {draft.media_type === "video" ? <video src={draft.media_url} controls playsInline style={{ maxWidth: "100%", maxHeight: 220 }} /> : <img src={draft.media_url} alt="Prévia da campanha" style={{ maxWidth: "100%", maxHeight: 220, objectFit: "contain" }} />}
              <button type="button" onClick={() => { update("media_url", null); update("storage_path", null); }} style={{ ...button, background: "#9f2525" }}>Remover mídia atual</button>
            </div>
          )}
          <label>Texto do botão<input value={draft.button_text || ""} onChange={(e) => update("button_text", e.target.value)} style={field} /></label>
          <label>Link do botão (ex.: / ou /produto/ID)<input value={draft.button_url || "/"} onChange={(e) => update("button_url", e.target.value)} style={field} /></label>
          <label>Local na página inicial<select value={draft.placement || "hero"} onChange={(e) => update("placement", e.target.value as Campaign["placement"])} style={field}><option value="hero">Banner principal (topo)</option><option value="middle">Entre as seções</option><option value="bottom">Próximo ao final</option></select></label>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 12 }}>
            <label>Cor de fundo<input type="color" value={draft.background_color || "#071b43"} onChange={(e) => update("background_color", e.target.value)} style={{ ...field, height: 48, padding: 4 }} /></label>
            <label>Cor do texto<input type="color" value={draft.text_color || "#ffffff"} onChange={(e) => update("text_color", e.target.value)} style={{ ...field, height: 48, padding: 4 }} /></label>
            <label>Ordem de exibição<input type="number" min="0" value={draft.sort_order ?? 0} onChange={(e) => update("sort_order", Number(e.target.value) as Campaign["sort_order"])} style={field} /></label>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 12 }}>
            <label>Início (opcional)<input type="datetime-local" value={draft.start_at ? new Date(draft.start_at).toISOString().slice(0,16) : ""} onChange={(e) => update("start_at", e.target.value ? new Date(e.target.value).toISOString() : null)} style={field} /></label>
            <label>Fim (opcional)<input type="datetime-local" value={draft.end_at ? new Date(draft.end_at).toISOString().slice(0,16) : ""} onChange={(e) => update("end_at", e.target.value ? new Date(e.target.value).toISOString() : null)} style={field} /></label>
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 16 }}><input type="checkbox" checked={Boolean(draft.active)} onChange={(e) => update("active", e.target.checked)} /> Publicar campanha (sujeita às datas)</label>
          <button type="button" onClick={() => setPreviewOpen(true)} style={{ ...button, background: "#e8edf5", color: "#071b43" }}><Eye size={16} style={{ verticalAlign: "middle" }} /> Visualizar antes de publicar</button>
          <button type="submit" disabled={saving} style={{ ...button, background: "#ffc928", color: "#071b43" }}>{saving ? "Salvando..." : editingId ? "Salvar alterações" : "Salvar campanha"}</button>
          {editingId && <button type="button" onClick={resetForm} style={{ ...button, background: "#e8edf5", color: "#071b43" }}>Cancelar edição</button>}
        </form>
      )}

      {message && <p role="status" style={{ padding: 12, borderRadius: 9, background: "#eef3fa" }}>{message}</p>}
      <h2>Campanhas cadastradas ({campaigns.length})</h2>
      {campaigns.length === 0 && <p>Nenhuma campanha cadastrada ainda.</p>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))", gap: 14 }}>
        {campaigns.map((campaign) => (
          <article key={campaign.id} style={{ border: "1px solid #dce3ed", borderRadius: 14, padding: 14, background: "#fff" }}>
            {campaign.media_url && (campaign.media_type === "video" ? <video src={campaign.media_url} controls playsInline style={{ width: "100%", maxHeight: 180, borderRadius: 9, background: "#071b43" }} /> : <img src={campaign.media_url} alt={campaign.title} style={{ width: "100%", maxHeight: 180, objectFit: "cover", borderRadius: 9 }} />)}
            <h3>{campaign.title}</h3>
            <p>{campaign.subtitle}</p>
            <p style={{ color: campaign.active ? "#137547" : "#64748b", fontWeight: 700 }}>{campaign.active ? "Ativa" : "Rascunho / pausada"} · {campaign.placement}</p>
            <button type="button" onClick={() => editCampaign(campaign)} style={button}>Editar</button>
            <button type="button" onClick={() => toggleCampaign(campaign)} style={{ ...button, background: campaign.active ? "#64748b" : "#137547" }}>{campaign.active ? <><EyeOff size={15} style={{ verticalAlign: "middle" }} /> Pausar</> : <><Eye size={15} style={{ verticalAlign: "middle" }} /> Ativar</>}</button>
            <button type="button" onClick={() => deleteCampaign(campaign)} style={{ ...button, background: "#9f2525" }}><Trash2 size={15} style={{ verticalAlign: "middle" }} /> Excluir</button>
          </article>
        ))}
      </div>
    </main>
  );
}
