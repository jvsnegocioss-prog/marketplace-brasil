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

  return (
    <main style={{ maxWidth: 1000, margin: "auto", padding: 20, fontFamily: "Arial, sans-serif" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div><h1>Cupons de desconto</h1><p>Crie e gerencie promoções da NOVASHOPP STORE.</p></div>
        <button type="button" onClick={() => router.push("/admin")} style={buttonStyle}>Voltar ao painel</button>
      </header>
      <form onSubmit={saveCoupon} style={{ border: "1px solid #dbe3ef", borderRadius: 12, padding: 18, marginTop: 18 }}>
        <h2>{editingId ? "Editar cupom" : "Novo cupom"}</h2>
        <label>Código do cupom</label>
        <input value={code} onChange={e => setCode(e.target.value.toUpperCase())} placeholder="EX: BEMVINDO10" required maxLength={40} style={inputStyle} />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 12 }}>
          <div><label>Tipo de desconto</label><select value={type} onChange={e => setType(e.target.value as "percent" | "fixed")} style={inputStyle}><option value="percent">Porcentagem (%)</option><option value="fixed">Valor fixo (R$)</option></select></div>
          <div><label>Valor do desconto</label><input type="number" min="0.01" max={type === "percent" ? "100" : undefined} step="0.01" value={value} onChange={e => setValue(e.target.value)} required style={inputStyle} /></div>
          <div><label>Pedido mínimo (R$)</label><input type="number" min="0" step="0.01" value={minimum} onChange={e => setMinimum(e.target.value)} style={inputStyle} /></div>
          <div><label>Desconto máximo (R$) — opcional</label><input type="number" min="0.01" step="0.01" value={maximum} onChange={e => setMaximum(e.target.value)} style={inputStyle} /></div>
          <div><label>Início — opcional</label><input type="datetime-local" value={starts} onChange={e => setStarts(e.target.value)} style={inputStyle} /></div>
          <div><label>Validade — opcional</label><input type="datetime-local" value={expires} onChange={e => setExpires(e.target.value)} style={inputStyle} /></div>
          <div><label>Limite total de usos — opcional</label><input type="number" min="1" step="1" value={limit} onChange={e => setLimit(e.target.value)} style={inputStyle} /></div>
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 8, margin: "4px 0 14px" }}><input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} /> Cupom ativo</label>
        <button type="submit" disabled={saving} style={{ ...buttonStyle, opacity: saving ? 0.65 : 1 }}>{saving ? "Salvando..." : editingId ? "Salvar alterações" : "Cadastrar cupom"}</button>
        {editingId && <button type="button" onClick={resetForm} style={{ ...buttonStyle, background: "#64748b" }}>Cancelar edição</button>}
      </form>
      {message && <p role="status" style={{ background: "#f1f5f9", padding: 12, borderRadius: 8, overflowWrap: "anywhere" }}>{message}</p>}
      <h2 style={{ marginTop: 28 }}>Cupons cadastrados ({coupons.length})</h2>
      {coupons.length === 0 && <p>Nenhum cupom cadastrado ainda.</p>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))", gap: 12 }}>
        {coupons.map(c => (
          <article key={c.id} style={{ border: "1px solid #dbe3ef", borderRadius: 12, padding: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
              <h3 style={{ margin: 0 }}>{c.code}</h3>
              <span style={{ fontSize: 12, fontWeight: 700, color: c.active ? "#16713b" : "#a12626" }}>{c.active ? "ATIVO" : "INATIVO"}</span>
            </div>
            <p style={{ fontSize: 20, fontWeight: 700, margin: "12px 0" }}>{c.discount_type === "percent" ? String(c.discount_value) + "% OFF" : money(Number(c.discount_value)) + " OFF"}</p>
            <p style={{ margin: "5px 0" }}>Pedido mínimo: {money(Number(c.min_order_amount))}</p>
            {c.max_discount != null && <p style={{ margin: "5px 0" }}>Desconto máximo: {money(Number(c.max_discount))}</p>}
            <p style={{ margin: "5px 0" }}>Usos: {c.usage_count}{c.usage_limit == null ? " / ilimitado" : " / " + c.usage_limit}</p>
            {c.expires_at && <p style={{ margin: "5px 0" }}>Validade: {new Date(c.expires_at).toLocaleString("pt-BR")}</p>}
            <div style={{ marginTop: 10 }}>
              <button onClick={() => editCoupon(c)} style={buttonStyle}>Editar</button>
              <button onClick={() => toggleCoupon(c)} style={{ ...buttonStyle, background: c.active ? "#64748b" : "#16713b" }}>{c.active ? "Desativar" : "Ativar"}</button>
              <button onClick={() => deleteCoupon(c)} style={{ ...buttonStyle, background: "#b42318" }}>Excluir</button>
            </div>
          </article>
        ))}
      </div>
    </main>
  );
}
