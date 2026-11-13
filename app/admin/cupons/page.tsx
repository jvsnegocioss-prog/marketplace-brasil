"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

type Coupon = {
  id: string; code: string; discount_type: "percent" | "fixed";
  discount_value: number; min_order_amount: number; max_discount: number | null;
  starts_at: string | null; expires_at: string | null; usage_limit: number | null;
  usage_count: number; active: boolean; created_at: string;
};
const inputStyle: React.CSSProperties = { width: "100%", padding: 12, marginTop: 6, marginBottom: 14, border: "1px solid #cbd5e1", borderRadius: 8, boxSizing: "border-box" };
const buttonStyle: React.CSSProperties = { padding: "11px 16px", border: 0, borderRadius: 8, background: "#173b68", color: "#fff", cursor: "pointer", margin: "4px 6px 4px 0" };
const money = (n: number) => Number(n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const localDateTime = (value: string | null) => { if (!value) return ""; const d = new Date(value); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };

export default function CouponsPage() {
  const router = useRouter();
  const [authorized, setAuthorized] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [message, setMessage] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [type, setType] = useState<"percent" | "fixed">("percent");
  const [value, setValue] = useState("");
  const [minimum, setMinimum] = useState("0");
  const [maximum, setMaximum] = useState("");
  const [starts, setStarts] = useState("");
  const [expires, setExpires] = useState("");
  const [limit, setLimit] = useState("");
  const [active, setActive] = useState(true);

  useEffect(() => {
    (async () => {
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError || !userData.user) { router.replace("/admin/login"); return; }
      const { data, error } = await supabase.rpc("is_marketplace_admin");
      if (error || data !== true) { await supabase.auth.signOut(); router.replace("/admin/login"); return; }
      setAuthorized(true); await loadCoupons(); setLoading(false);
    })().catch(() => { setMessage("Não foi possível verificar o acesso administrativo."); setLoading(false); });
  }, [router]);

  async function loadCoupons() {
    const { data, error } = await supabase.from("discount_coupons").select("*").order("created_at", { ascending: false });
    if (error) { setMessage("Erro ao carregar cupons: " + error.message); return; }
    setCoupons((data || []) as Coupon[]);
  }
  function resetForm() {
    setEditingId(null); setCode(""); setType("percent"); setValue(""); setMinimum("0");
    setMaximum(""); setStarts(""); setExpires(""); setLimit(""); setActive(true);
  }
  function editCoupon(c: Coupon) {
    setEditingId(c.id); setCode(c.code); setType(c.discount_type); setValue(String(c.discount_value));
    setMinimum(String(c.min_order_amount ?? 0)); setMaximum(c.max_discount == null ? "" : String(c.max_discount));
    setStarts(localDateTime(c.starts_at)); setExpires(localDateTime(c.expires_at));
    setLimit(c.usage_limit == null ? "" : String(c.usage_limit)); setActive(c.active);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  async function saveCoupon(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setSaving(true); setMessage("");
    const discountValue = Number(value), minValue = Number(minimum || 0);
    const maxValue = maximum.trim() ? Number(maximum) : null;
    const usageLimit = limit.trim() ? Number(limit) : null;
    if (!Number.isFinite(discountValue) || discountValue <= 0 || (type === "percent" && discountValue > 100)) {
      setMessage("Informe um desconto válido. Percentual deve ser de 1 a 100."); setSaving(false); return;
    }
    if (!Number.isFinite(minValue) || minValue < 0 || (maxValue !== null && (!Number.isFinite(maxValue) || maxValue <= 0)) ||
      (usageLimit !== null && (!Number.isInteger(usageLimit) || usageLimit <= 0))) {
      setMessage("Confira o valor mínimo, desconto máximo e limite de usos."); setSaving(false); return;
    }
    if (starts && expires && new Date(expires) <= new Date(starts)) {
      setMessage("A validade final deve ser posterior à data inicial."); setSaving(false); return;
    }
    const payload = {
      code: code.trim().toUpperCase().replace(/\s+/g, ""), discount_type: type,
      discount_value: discountValue, min_order_amount: minValue, max_discount: maxValue,
      starts_at: starts ? new Date(starts).toISOString() : null,
      expires_at: expires ? new Date(expires).toISOString() : null,
      usage_limit: usageLimit, active,
    };
    try {
      const result = editingId
        ? await supabase.from("discount_coupons").update(payload).eq("id", editingId)
        : await supabase.from("discount_coupons").insert(payload);
      if (result.error) throw result.error;
      setMessage(editingId ? "Cupom atualizado com sucesso." : "Cupom cadastrado com sucesso.");
      resetForm(); await loadCoupons();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Não foi possível salvar o cupom.");
    } finally { setSaving(false); }
  }
  async function toggleCoupon(c: Coupon) {
    const { error } = await supabase.from("discount_coupons").update({ active: !c.active }).eq("id", c.id);
    if (error) { setMessage("Erro ao alterar cupom: " + error.message); return; }
    await loadCoupons();
  }
  async function deleteCoupon(c: Coupon) {
    if (!window.confirm("Excluir o cupom " + c.code + "?")) return;
    const { error } = await supabase.from("discount_coupons").delete().eq("id", c.id);
    if (error) { setMessage("Erro ao excluir cupom: " + error.message); return; }
    setMessage("Cupom excluído."); if (editingId === c.id) resetForm(); await loadCoupons();
  }
  if (loading) return <main style={{ padding: 24 }}>Carregando cupons...</main>;
  if (!authorized) return null;

  const activeCoupons = coupons.filter(c => c.active).length;
  const totalUses = coupons.reduce((sum, c) => sum + Number(c.usage_count || 0), 0);

  return (
    <main style={{ minHeight: "100vh", background: "#f3f6fb", padding: "24px 16px 48px", fontFamily: "Arial, sans-serif", color: "#14243a" }}>
      <div style={{ maxWidth: 1080, margin: "auto" }}>
        <header style={{ background: "linear-gradient(125deg,#102b50,#1d4d7c)", color: "#fff", padding: "26px 24px", borderRadius: 18, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap", boxShadow: "0 12px 28px rgba(16,43,80,.16)" }}>
          <div>
            <p style={{ margin: "0 0 8px", color: "#f6cc55", fontSize: 12, fontWeight: 800, letterSpacing: 2 }}>NOVASHOPP STORE · ADMINISTRAÇÃO</p>
            <h1 style={{ margin: 0, fontSize: 28 }}>Central de cupons</h1>
            <p style={{ margin: "8px 0 0", color: "#d8e5f3" }}>Crie ofertas e acompanhe o uso dos descontos.</p>
          </div>
          <button type="button" onClick={() => router.push("/admin")} style={{ padding: "11px 16px", border: 0, borderRadius: 8, background: "#ffc928", color: "#173b68", cursor: "pointer", fontWeight: 800, margin: 0 }}>← Voltar ao painel</button>
        </header>

        <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 12, margin: "18px 0" }}>
          {[
            { label: "Cupons cadastrados", value: String(coupons.length), note: "Total criado" },
            { label: "Cupons ativos", value: String(activeCoupons), note: "Disponíveis para campanha" },
            { label: "Utilizações", value: String(totalUses), note: "Contagem registrada" },
          ].map(item => (
            <article key={item.label} style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, padding: 18, boxShadow: "0 4px 14px rgba(15,23,42,.04)" }}>
              <p style={{ margin: 0, color: "#64748b", fontSize: 13 }}>{item.label}</p>
              <strong style={{ display: "block", fontSize: 28, margin: "7px 0", color: "#173b68" }}>{item.value}</strong>
              <small style={{ color: "#8492a6" }}>{item.note}</small>
            </article>
          ))}
        </section>

        <form onSubmit={saveCoupon} style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 16, padding: 22, boxShadow: "0 6px 20px rgba(15,23,42,.05)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap", marginBottom: 18 }}>
            <div>
              <h2 style={{ margin: 0, fontSize: 21 }}>{editingId ? "Editar cupom" : "Criar novo cupom"}</h2>
              <p style={{ margin: "6px 0 0", color: "#64748b", fontSize: 13 }}>Configure o código, o desconto e as regras da promoção.</p>
            </div>
            {editingId && <span style={{ background: "#fff5d6", color: "#815c00", padding: "7px 11px", borderRadius: 20, fontSize: 12, fontWeight: 700 }}>EDITANDO CUPOM</span>}
          </div>

          <div style={{ background: "#f7f9fc", border: "1px dashed #cbd5e1", borderRadius: 12, padding: 16, marginBottom: 18 }}>
            <label style={{ display: "block", fontSize: 13, fontWeight: 700, color: "#334155" }}>Código promocional</label>
            <input value={code} onChange={e => setCode(e.target.value.toUpperCase())} placeholder="EX: BEMVINDO10" required maxLength={40} style={{ ...inputStyle, marginBottom: 4, fontSize: 20, fontWeight: 800, letterSpacing: 1.5, textTransform: "uppercase", background: "#fff" }} />
            <small style={{ color: "#64748b" }}>Use um código fácil de lembrar. Espaços serão removidos automaticamente.</small>
          </div>

          <h3 style={{ fontSize: 14, color: "#173b68", margin: "0 0 10px" }}>CONFIGURAÇÃO DO DESCONTO</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: "0 14px" }}>
            <div><label style={{ fontSize: 13, fontWeight: 700 }}>Tipo de desconto</label><select value={type} onChange={e => setType(e.target.value as "percent" | "fixed")} style={inputStyle}><option value="percent">Porcentagem (%)</option><option value="fixed">Valor fixo (R$)</option></select></div>
            <div><label style={{ fontSize: 13, fontWeight: 700 }}>Valor do desconto</label><input type="number" min="0.01" max={type === "percent" ? "100" : undefined} step="0.01" value={value} onChange={e => setValue(e.target.value)} placeholder={type === "percent" ? "Ex: 10" : "Ex: 20,00"} required style={inputStyle} /></div>
            <div><label style={{ fontSize: 13, fontWeight: 700 }}>Pedido mínimo (R$)</label><input type="number" min="0" step="0.01" value={minimum} onChange={e => setMinimum(e.target.value)} style={inputStyle} /></div>
            <div><label style={{ fontSize: 13, fontWeight: 700 }}>Desconto máximo (R$) · opcional</label><input type="number" min="0.01" step="0.01" value={maximum} onChange={e => setMaximum(e.target.value)} placeholder="Sem limite" style={inputStyle} /></div>
          </div>

          <h3 style={{ fontSize: 14, color: "#173b68", margin: "8px 0 10px" }}>PERÍODO E LIMITE DE USO</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: "0 14px" }}>
            <div><label style={{ fontSize: 13, fontWeight: 700 }}>Início · opcional</label><input type="datetime-local" value={starts} onChange={e => setStarts(e.target.value)} style={inputStyle} /><button type="button" onClick={() => setStarts("")} disabled={!starts} style={{ ...buttonStyle, background: "#64748b", marginTop: -8, marginBottom: 12, padding: "7px 11px", fontSize: 12 }}>Limpar data</button></div>
            <div><label style={{ fontSize: 13, fontWeight: 700 }}>Validade · opcional</label><input type="datetime-local" value={expires} onChange={e => setExpires(e.target.value)} style={inputStyle} /><button type="button" onClick={() => setExpires("")} disabled={!expires} style={{ ...buttonStyle, background: "#64748b", marginTop: -8, marginBottom: 12, padding: "7px 11px", fontSize: 12 }}>Limpar data</button></div>
            <div><label style={{ fontSize: 13, fontWeight: 700 }}>Limite total de usos · opcional</label><input type="number" min="1" step="1" value={limit} onChange={e => setLimit(e.target.value)} placeholder="Ilimitado" style={inputStyle} /></div>
          </div>

          <label style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderRadius: 10, background: "#f1f7f3", color: "#245b39", fontWeight: 700, margin: "2px 0 18px" }}>
            <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} style={{ width: 18, height: 18 }} /> Cupom ativo
          </label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="submit" disabled={saving} style={{ ...buttonStyle, background: "#173b68", padding: "13px 22px", fontWeight: 700, margin: 0 }}>{saving ? "Salvando..." : editingId ? "Salvar alterações" : "＋ Criar cupom"}</button>
            {editingId && <button type="button" onClick={resetForm} style={{ ...buttonStyle, background: "#64748b", margin: 0 }}>Cancelar edição</button>}
          </div>
        </form>

        {message && <p role="status" style={{ background: "#fff", border: "1px solid #dbe3ef", padding: 14, borderRadius: 10, overflowWrap: "anywhere" }}>{message}</p>}

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", margin: "28px 0 14px" }}>
          <div><h2 style={{ margin: 0, fontSize: 21 }}>Seus cupons</h2><p style={{ margin: "5px 0 0", color: "#64748b", fontSize: 13 }}>Gerencie as promoções cadastradas.</p></div>
          <span style={{ color: "#64748b", fontSize: 13 }}>{coupons.length} registro(s)</span>
        </div>
        {coupons.length === 0 && <div style={{ background: "#fff", border: "1px dashed #cbd5e1", borderRadius: 14, padding: 28, textAlign: "center", color: "#64748b" }}>Nenhum cupom cadastrado. Crie o primeiro acima.</div>}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(270px,1fr))", gap: 14 }}>
          {coupons.map(c => (
            <article key={c.id} style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 15, padding: 17, boxShadow: "0 5px 16px rgba(15,23,42,.045)", position: "relative", overflow: "hidden" }}>
              <div style={{ height: 5, background: c.active ? "#e5b72e" : "#94a3b8", position: "absolute", top: 0, left: 0, right: 0 }} />
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginTop: 4 }}>
                <span style={{ fontSize: 12, color: "#64748b", fontWeight: 700, letterSpacing: 1 }}>CUPOM</span>
                <span style={{ fontSize: 11, fontWeight: 800, color: c.active ? "#16713b" : "#64748b", background: c.active ? "#e9f7ee" : "#eef2f6", borderRadius: 20, padding: "6px 9px" }}>{c.active ? "ATIVO" : "INATIVO"}</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, margin: "10px 0" }}>
                <h3 style={{ margin: 0, fontSize: 20, letterSpacing: 1, overflowWrap: "anywhere" }}>{c.code}</h3>
                <strong style={{ color: "#173b68", fontSize: 21, whiteSpace: "nowrap" }}>{c.discount_type === "percent" ? String(c.discount_value) + "%" : money(Number(c.discount_value))}</strong>
              </div>
              <p style={{ color: "#64748b", fontSize: 13, margin: "5px 0" }}>Pedido mínimo: <strong style={{ color: "#24364b" }}>{money(Number(c.min_order_amount))}</strong></p>
              {c.max_discount != null && <p style={{ color: "#64748b", fontSize: 13, margin: "5px 0" }}>Desconto máximo: <strong style={{ color: "#24364b" }}>{money(Number(c.max_discount))}</strong></p>}
              <p style={{ color: "#64748b", fontSize: 13, margin: "5px 0" }}>Utilizações: <strong style={{ color: "#24364b" }}>{c.usage_count}{c.usage_limit == null ? " · ilimitado" : " / " + c.usage_limit}</strong></p>
              {c.starts_at && <p style={{ color: "#64748b", fontSize: 12, margin: "5px 0" }}>Início: {new Date(c.starts_at).toLocaleString("pt-BR")}</p>}
              {c.expires_at && <p style={{ color: "#64748b", fontSize: 12, margin: "5px 0" }}>Validade: {new Date(c.expires_at).toLocaleString("pt-BR")}</p>}
              <div style={{ borderTop: "1px solid #edf1f5", marginTop: 14, paddingTop: 11, display: "flex", gap: 6, flexWrap: "wrap" }}>
                <button onClick={() => editCoupon(c)} style={{ ...buttonStyle, margin: 0, flex: 1 }}>Editar</button>
                <button onClick={() => toggleCoupon(c)} style={{ ...buttonStyle, margin: 0, flex: 1, background: c.active ? "#64748b" : "#16713b" }}>{c.active ? "Desativar" : "Ativar"}</button>
                <button onClick={() => deleteCoupon(c)} style={{ ...buttonStyle, margin: 0, background: "#b42318" }}>Excluir</button>
              </div>
            </article>
          ))}
        </div>
      </div>
    </main>
  );
}
