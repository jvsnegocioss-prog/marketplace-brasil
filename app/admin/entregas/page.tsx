"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

type Region = {
  id: string;
  code: string;
  name: string;
  fee_cents: number;
  active: boolean;
  sort_order: number;
};

type Neighborhood = {
  id: string;
  name: string;
  region_id: string;
  fee_override_cents: number | null;
  active: boolean;
};

const money = (cents: number) => (cents / 100).toLocaleString("pt-BR", {
  style: "currency", currency: "BRL",
});

const inputStyle: React.CSSProperties = {
  width: "100%", padding: 11, border: "1px solid #cbd5e1",
  borderRadius: 8, boxSizing: "border-box", fontSize: 16,
};

const buttonStyle: React.CSSProperties = {
  border: 0, borderRadius: 8, padding: "11px 16px",
  background: "#173b68", color: "#fff", fontWeight: 700,
};

export default function AdminDeliveriesPage() {
  const router = useRouter();
  const [authorized, setAuthorized] = useState(false);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState("");
  const [message, setMessage] = useState("");
  const [regions, setRegions] = useState<Region[]>([]);
  const [neighborhoods, setNeighborhoods] = useState<Neighborhood[]>([]);
  const [regionValues, setRegionValues] = useState<Record<string, string>>({});
  const [neighborhoodValues, setNeighborhoodValues] = useState<Record<string, string>>({});
  const [filterRegion, setFilterRegion] = useState("all");
  const [search, setSearch] = useState("");

  async function loadData() {
    const [regionResult, neighborhoodResult] = await Promise.all([
      supabase.from("delivery_regions").select("id,code,name,fee_cents,active,sort_order").order("sort_order"),
      supabase.from("delivery_neighborhoods").select("id,name,region_id,fee_override_cents,active").order("name"),
    ]);
    if (regionResult.error || neighborhoodResult.error) {
      setMessage("Não foi possível carregar as configurações: " + (regionResult.error?.message || neighborhoodResult.error?.message));
      return;
    }
    const nextRegions = (regionResult.data || []) as Region[];
    const nextNeighborhoods = (neighborhoodResult.data || []) as Neighborhood[];
    setRegions(nextRegions);
    setNeighborhoods(nextNeighborhoods);
    setRegionValues(Object.fromEntries(nextRegions.map((r) => [r.id, (r.fee_cents / 100).toFixed(2)])));
    setNeighborhoodValues(Object.fromEntries(nextNeighborhoods.map((n) => [n.id, n.fee_override_cents === null ? "" : (n.fee_override_cents / 100).toFixed(2)])));
  }

  useEffect(() => {
    let cancelled = false;
    async function checkAdmin() {
      try {
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
        if (cancelled) return;
        setAuthorized(true);
        await loadData();
      } catch {
        if (!cancelled) setMessage("Erro ao verificar acesso administrativo.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void checkAdmin();
    return () => { cancelled = true; };
  }, [router]);

  async function saveRegion(region: Region) {
    const value = regionValues[region.id] ?? "";
    const parsed = Number(value.replace(",", "."));
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 10000) {
      setMessage("Informe uma taxa válida entre R$ 0,00 e R$ 10.000,00.");
      return;
    }
    setSavingId(region.id);
    setMessage("");
    const { error } = await supabase.from("delivery_regions")
      .update({ fee_cents: Math.round(parsed * 100), updated_at: new Date().toISOString() })
      .eq("id", region.id);
    setSavingId("");
    if (error) { setMessage("Erro ao salvar região: " + error.message); return; }
    setMessage("Taxa regional atualizada.");
    await loadData();
  }

  async function toggleRegion(region: Region) {
    setSavingId(region.id);
    setMessage("");
    const { error } = await supabase.from("delivery_regions")
      .update({ active: !region.active, updated_at: new Date().toISOString() })
      .eq("id", region.id);
    setSavingId("");
    if (error) { setMessage("Erro ao atualizar região: " + error.message); return; }
    setMessage("Disponibilidade da região atualizada.");
    await loadData();
  }

  async function saveNeighborhood(item: Neighborhood) {
    const raw = (neighborhoodValues[item.id] ?? "").trim();
    let override: number | null = null;
    if (raw) {
      const parsed = Number(raw.replace(",", "."));
      if (!Number.isFinite(parsed) || parsed < 0 || parsed > 10000) {
        setMessage("Informe uma taxa individual válida ou deixe em branco para usar a taxa regional.");
        return;
      }
      override = Math.round(parsed * 100);
    }
    setSavingId(item.id);
    setMessage("");
    const { error } = await supabase.from("delivery_neighborhoods")
      .update({ fee_override_cents: override, updated_at: new Date().toISOString() })
      .eq("id", item.id);
    setSavingId("");
    if (error) { setMessage("Erro ao salvar bairro: " + error.message); return; }
    setMessage("Taxa individual do bairro atualizada.");
    await loadData();
  }

  async function toggleNeighborhood(item: Neighborhood) {
    setSavingId(item.id);
    setMessage("");
    const { error } = await supabase.from("delivery_neighborhoods")
      .update({ active: !item.active, updated_at: new Date().toISOString() })
      .eq("id", item.id);
    setSavingId("");
    if (error) { setMessage("Erro ao atualizar bairro: " + error.message); return; }
    setMessage("Disponibilidade do bairro atualizada.");
    await loadData();
  }

  const filteredNeighborhoods = useMemo(() => neighborhoods.filter((item) => {
    const matchesRegion = filterRegion === "all" || item.region_id === filterRegion;
    const matchesSearch = item.name.toLocaleLowerCase("pt-BR").includes(search.toLocaleLowerCase("pt-BR"));
    return matchesRegion && matchesSearch;
  }), [neighborhoods, filterRegion, search]);

  if (loading) return <main style={{ padding: 24 }}>Verificando acesso administrativo...</main>;
  if (!authorized) return null;

  return (
    <main style={{ maxWidth: 1000, margin: "0 auto", padding: 20, fontFamily: "Arial, sans-serif", color: "#172033" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ marginBottom: 6 }}>Configuração de entregas</h1>
          <p style={{ marginTop: 0, color: "#64748b" }}>Taxas regionais provisórias e ajustes individuais por bairro.</p>
        </div>
        <button style={buttonStyle} onClick={() => router.push("/admin")}>Voltar ao painel</button>
      </header>

      <section style={{ background: "#f8fafc", border: "1px solid #dbe3ef", borderRadius: 12, padding: 16, margin: "18px 0" }}>
        <strong>Valores provisórios — Manaus</strong>
        <p style={{ marginBottom: 0, color: "#475569" }}>As taxas abaixo ainda não são cobradas dos clientes. O checkout permanece bloqueado. Uma taxa individual de bairro substitui a taxa da região; em branco, vale a taxa regional.</p>
      </section>

      <h2>Taxas por região</h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: 12 }}>
        {regions.map((region) => (
          <article key={region.id} style={{ border: "1px solid #dbe3ef", borderRadius: 12, padding: 14, opacity: region.active ? 1 : 0.65 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <strong>{region.name}</strong>
              <span style={{ fontSize: 12, color: region.active ? "#166534" : "#991b1b" }}>{region.active ? "Ativa" : "Inativa"}</span>
            </div>
            <label style={{ display: "block", margin: "12px 0 5px" }}>Taxa de entrega (R$)</label>
            <input type="number" min="0" max="10000" step="0.01" value={regionValues[region.id] ?? ""} onChange={(e) => setRegionValues((old) => ({ ...old, [region.id]: e.target.value }))} style={inputStyle} />
            <p style={{ color: "#64748b", fontSize: 12 }}>Atual: {money(region.fee_cents)}</p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button style={buttonStyle} disabled={savingId === region.id} onClick={() => void saveRegion(region)}>{savingId === region.id ? "Salvando..." : "Salvar taxa"}</button>
              <button style={{ ...buttonStyle, background: region.active ? "#9f2d2d" : "#166534" }} disabled={savingId === region.id} onClick={() => void toggleRegion(region)}>{region.active ? "Desativar" : "Ativar"}</button>
            </div>
          </article>
        ))}
      </div>

      <h2 style={{ marginTop: 30 }}>Taxas individuais por bairro</h2>
      <p style={{ color: "#64748b" }}>Deixe o campo vazio para herdar o valor da região. A taxa individual tem prioridade sobre a regional.</p>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
        <input placeholder="Buscar bairro..." value={search} onChange={(e) => setSearch(e.target.value)} style={inputStyle} />
        <select value={filterRegion} onChange={(e) => setFilterRegion(e.target.value)} style={inputStyle}>
          <option value="all">Todas as regiões</option>
          {regions.map((region) => <option key={region.id} value={region.id}>{region.name}</option>)}
        </select>
      </div>
      <div style={{ display: "grid", gap: 9 }}>
        {filteredNeighborhoods.map((item) => {
          const region = regions.find((r) => r.id === item.region_id);
          const effectiveFee = item.fee_override_cents ?? region?.fee_cents ?? 0;
          return (
            <article key={item.id} style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: 12, display: "grid", gridTemplateColumns: "minmax(130px,1fr) minmax(130px,180px) auto", gap: 10, alignItems: "center" }}>
              <div><strong>{item.name}</strong><div style={{ color: "#64748b", fontSize: 12 }}>{region?.name || "Região não definida"} · {money(effectiveFee)}{item.fee_override_cents !== null ? " (personalizado)" : " (regional)"}</div></div>
              <input aria-label={"Taxa individual de " + item.name} type="number" min="0" max="10000" step="0.01" placeholder="Usar regional" value={neighborhoodValues[item.id] ?? ""} onChange={(e) => setNeighborhoodValues((old) => ({ ...old, [item.id]: e.target.value }))} style={inputStyle} />
              <button style={buttonStyle} disabled={savingId === item.id} onClick={() => void saveNeighborhood(item)}>{savingId === item.id ? "Salvando..." : "Salvar"}</button>
              <div style={{ gridColumn: "1 / -1", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                <small style={{ color: item.active ? "#166534" : "#991b1b" }}>{item.active ? "Bairro atendido" : "Bairro sem atendimento"}</small>
                <button style={{ ...buttonStyle, padding: "7px 11px", background: item.active ? "#9f2d2d" : "#166534" }} disabled={savingId === item.id} onClick={() => void toggleNeighborhood(item)}>{item.active ? "Desativar bairro" : "Ativar bairro"}</button>
              </div>
            </article>
          );
        })}
        {filteredNeighborhoods.length === 0 && <p>Nenhum bairro encontrado.</p>}
      </div>
      {message && <p role="status" style={{ marginTop: 18, padding: 12, borderRadius: 8, background: "#eff6ff" }}>{message}</p>}
    </main>
  );
}
