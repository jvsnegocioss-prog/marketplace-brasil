"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

type Region = {
  id: string;
  code: string;
  name: string;
  fee_cents: number;
  free_shipping: boolean;
  active: boolean;
  sort_order: number;
};

type Neighborhood = {
  id: string;
  name: string;
  region_id: string | null;
  fee_override_cents: number | null;
  active: boolean;
  record_type: "official" | "locality";
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
  const [neighborhoodRegionValues, setNeighborhoodRegionValues] = useState<Record<string, string>>({});
  const [filterRegion, setFilterRegion] = useState("all");
  const [search, setSearch] = useState("");

  async function loadData() {
    const [regionResult, neighborhoodResult] = await Promise.all([
      supabase.from("delivery_regions").select("id,code,name,fee_cents,free_shipping,active,sort_order").order("sort_order"),
      supabase.from("delivery_neighborhoods").select("id,name,region_id,fee_override_cents,active,record_type").order("name"),
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
    setNeighborhoodValues(Object.fromEntries(nextNeighborhoods
      .filter((n) => n.fee_override_cents !== null)
      .map((n) => [n.id, (n.fee_override_cents! / 100).toFixed(2)])));
    setNeighborhoodRegionValues(Object.fromEntries(nextNeighborhoods.map((n) => [n.id, n.region_id || ""])));
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
        if (!cancelled) {
          setAuthorized(false);
          setMessage("Não foi possível confirmar seu acesso administrativo. Entre novamente.");
          router.replace("/admin/login");
        }
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
      .eq("id", region.id)
      .eq("fee_cents", region.fee_cents)
      .select("id")
      .maybeSingle();
    setSavingId("");
    if (error) { setMessage("Erro ao salvar região: " + error.message); return; }
    if (!data) {
      setMessage("A taxa desta região foi alterada por outra operação. Atualize os dados antes de salvar novamente.");
      await loadData();
      return;
    }
    setMessage("Taxa regional atualizada.");
    await loadData();
  }

  async function toggleAllRegionsFreeShipping() {
    if (!regions.length) {
      setMessage("Nenhuma região foi carregada.");
      return;
    }
    if (regions.every((region) => region.free_shipping)) {
      setMessage("Todas as regiões já estão com frete grátis. Para alterar, use o controle individual de cada região.");
      return;
    }
    setSavingId("all-regions");
    setMessage("");
    const { error } = await supabase.from("delivery_regions")
      .update({ free_shipping: true, updated_at: new Date().toISOString() })
      .eq("free_shipping", false)
      .select("id");
    setSavingId("");
    if (error) {
      setMessage("Erro ao ativar frete grátis em todas as regiões: " + error.message);
      return;
    }
    setMessage("Frete grátis ativado em " + (data?.length || 0) + " região(ões) que ainda estavam com frete pago. Regiões já alteradas por outra operação foram preservadas.");
    await loadData();
  }

  async function toggleRegionFreeShipping(region: Region) {
    setSavingId("free-" + region.id);
    setMessage("");
    const { data, error } = await supabase.from("delivery_regions")
      .update({ free_shipping: !region.free_shipping, updated_at: new Date().toISOString() })
      .eq("id", region.id)
      .eq("free_shipping", region.free_shipping)
      .select("id")
      .maybeSingle();
    setSavingId("");
    if (error) {
      setMessage("Erro ao alterar frete grátis da região: " + error.message);
      return;
    }
    if (!data) {
      setMessage("A configuração de frete grátis foi alterada por outra operação. Atualize a lista.");
      await loadData();
      return;
    }
    setMessage(region.free_shipping
      ? `Frete grátis desativado somente em ${region.name}. As demais regiões permanecem como estavam.`
      : `Frete grátis ativado somente em ${region.name}.`);
    await loadData();
  }

  async function toggleRegion(region: Region) {
    setSavingId(region.id);
    setMessage("");
    const { data, error } = await supabase.from("delivery_regions")
      .update({ active: !region.active, updated_at: new Date().toISOString() })
      .eq("id", region.id)
      .eq("active", region.active)
      .select("id")
      .maybeSingle();
    setSavingId("");
    if (error) { setMessage("Erro ao atualizar região: " + error.message); return; }
    if (!data) {
      setMessage("A disponibilidade da região foi alterada por outra operação. Atualize a lista.");
      await loadData();
      return;
    }
    setMessage("Disponibilidade da região atualizada.");
    await loadData();
  }

  async function saveNeighborhood(item: Neighborhood) {
    if (!Object.prototype.hasOwnProperty.call(neighborhoodValues, item.id)) {
      setMessage("Este bairro já está usando automaticamente a taxa da região. Altere o campo para cadastrar uma taxa manual.");
      return;
    }
    const raw = (neighborhoodValues[item.id] ?? "").trim();
    let override: number | null = null;
    if (raw) {
      const parsed = Number(raw.replace(",", "."));
      if (!Number.isFinite(parsed) || parsed < 0 || parsed > 10000) {
        setMessage("Informe uma taxa individual válida ou deixe o campo vazio para voltar à taxa regional.");
        return;
      }
      override = Math.round(parsed * 100);
    }
    setSavingId(item.id);
    setMessage("");
    const { error } = await supabase.from("delivery_neighborhoods")
      .update({ fee_override_cents: override, updated_at: new Date().toISOString() })
      .eq("id", item.id)
      .eq("region_id", item.region_id ?? "")
      .select("id")
      .maybeSingle();
    setSavingId("");
    if (error) { setMessage("Erro ao salvar bairro: " + error.message); return; }
    if (!data) {
      setMessage("A configuração deste bairro foi alterada por outra operação. Atualize os dados antes de salvar novamente.");
      await loadData();
      return;
    }
    setMessage(override === null
      ? "Taxa individual removida. O bairro voltou a acompanhar automaticamente a taxa da região."
      : "Taxa manual do bairro salva. Ela será aplicada somente a este bairro.");
    await loadData();
  }

  async function useNeighborhoodRegionFee(item: Neighborhood) {
    setSavingId(item.id);
    setMessage("");
    const { error } = await supabase.from("delivery_neighborhoods")
      .update({ fee_override_cents: null, updated_at: new Date().toISOString() })
      .eq("id", item.id)
      .eq("fee_override_cents", item.fee_override_cents)
      .select("id")
      .maybeSingle();
    setSavingId("");
    if (error) { setMessage("Erro ao restaurar taxa regional: " + error.message); return; }
    if (!data) {
      setMessage("A taxa deste bairro foi alterada por outra operação. Atualize os dados antes de continuar.");
      await loadData();
      return;
    }
    setMessage("Taxa individual removida. O bairro voltou a acompanhar a taxa da região.");
    await loadData();
  }

  async function saveNeighborhoodRegion(item: Neighborhood) {
    const regionId = neighborhoodRegionValues[item.id] || null;
    if (regionId && !regions.some((region) => region.id === regionId)) {
      setMessage("Selecione uma região válida.");
      return;
    }
    setSavingId(item.id);
    setMessage("");
    const { error } = await supabase.from("delivery_neighborhoods")
      .update({ region_id: regionId, updated_at: new Date().toISOString() })
      .eq("id", item.id)
      .eq("region_id", item.region_id ?? "")
      .select("id")
      .maybeSingle();
    setSavingId("");
    if (error) { setMessage("Erro ao salvar região do bairro: " + error.message); return; }
    if (!data) {
      setMessage("A região deste bairro foi alterada por outra operação. Atualize os dados antes de salvar novamente.");
      await loadData();
      return;
    }
    setMessage("Região do bairro atualizada. A ativação continua sendo uma ação separada.");
    await loadData();
  }

  async function toggleNeighborhood(item: Neighborhood) {
    setSavingId(item.id);
    setMessage("");
    const { data, error } = await supabase.from("delivery_neighborhoods")
      .update({ active: !item.active, updated_at: new Date().toISOString() })
      .eq("id", item.id)
      .eq("active", item.active)
      .select("id")
      .maybeSingle();
    setSavingId("");
    if (error) { setMessage("Erro ao atualizar bairro: " + error.message); return; }
    if (!data) {
      setMessage("A disponibilidade do bairro foi alterada por outra operação. Atualize a lista.");
      await loadData();
      return;
    }
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

      <section style={{ border: "1px solid #cbd5e1", borderRadius: 12, padding: 16, margin: "18px 0", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div>
          <strong>Frete grátis para todas as regiões</strong>
          <p style={{ margin: "6px 0 0", color: "#64748b", fontSize: 13 }}>
            {regions.length > 0 && regions.every((region) => region.free_shipping)
              ? "Ativado: todos os bairros atendidos terão entrega grátis, inclusive quando houver taxa personalizada."
              : "Desativado: serão aplicadas as taxas regionais ou personalizadas por bairro."}
          </p>
        </div>
        <button
          style={{ ...buttonStyle, background: "#166534" }}
          disabled={savingId === "all-regions" || regions.length === 0 || regions.every((region) => region.free_shipping)}
          onClick={() => void toggleAllRegionsFreeShipping()}
        >
          {savingId === "all-regions" ? "Atualizando..." : regions.length > 0 && regions.every((region) => region.free_shipping) ? "Frete grátis ativo em todas" : "Ativar frete grátis em todas"}
        </button>
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
            <input
              type="number"
              min="0"
              max="10000"
              step="0.01"
              value={region.free_shipping ? "0.00" : (regionValues[region.id] ?? "")}
              disabled={region.free_shipping}
              onChange={(e) => setRegionValues((old) => ({ ...old, [region.id]: e.target.value }))}
              style={{ ...inputStyle, background: region.free_shipping ? "#f0fdf4" : "#fff", color: region.free_shipping ? "#166534" : "#172033", fontWeight: region.free_shipping ? 700 : 400 }}
            />
            <p style={{ color: "#64748b", fontSize: 12 }}>
              {region.free_shipping
                ? `Frete grátis ativo. Última taxa cadastrada preservada: ${money(region.fee_cents)}`
                : `Taxa cadastrada: ${money(region.fee_cents)}`}
            </p>
            <p style={{ color: region.free_shipping ? "#166534" : "#64748b", fontSize: 13, fontWeight: 700 }}>
              {region.free_shipping ? "FRETE GRÁTIS ATIVADO" : "Frete pago conforme taxa cadastrada"}
            </p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button style={buttonStyle} disabled={savingId === region.id || region.free_shipping} onClick={() => void saveRegion(region)}>{savingId === region.id ? "Salvando..." : "Salvar taxa"}</button>
              <button
                style={{ ...buttonStyle, background: region.free_shipping ? "#9f2d2d" : "#166534" }}
                disabled={savingId === "free-" + region.id}
                onClick={() => void toggleRegionFreeShipping(region)}
              >
                {savingId === "free-" + region.id ? "Atualizando..." : region.free_shipping ? "Desativar frete grátis" : "Ativar frete grátis"}
              </button>
              <button style={{ ...buttonStyle, background: region.active ? "#9f2d2d" : "#166534" }} disabled={savingId === region.id} onClick={() => void toggleRegion(region)}>{region.active ? "Desativar região" : "Ativar região"}</button>
            </div>
          </article>
        ))}
      </div>

      <h2 style={{ marginTop: 30 }}>Taxas individuais por bairro</h2>
      <p style={{ color: "#64748b" }}>O campo mostra automaticamente a taxa da região selecionada. Se você alterar o valor e salvar, será criada uma taxa manual exclusiva para o bairro. Use “Usar taxa regional” para voltar a acompanhar futuras alterações da região.</p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 240px), 1fr))", gap: 10, marginBottom: 14 }}>
        <input placeholder="Buscar bairro..." value={search} onChange={(e) => setSearch(e.target.value)} style={inputStyle} />
        <select value={filterRegion} onChange={(e) => setFilterRegion(e.target.value)} style={inputStyle}>
          <option value="all">Todas as regiões</option>
          {regions.map((region) => <option key={region.id} value={region.id}>{region.name}</option>)}
        </select>
      </div>
      <div style={{ display: "grid", gap: 9 }}>
        {filteredNeighborhoods.map((item) => {
          const selectedRegionId = neighborhoodRegionValues[item.id] ?? item.region_id ?? "";
          const region = regions.find((r) => r.id === selectedRegionId);
          const isManualOverride = item.fee_override_cents !== null;
          const hasRateDraft = Object.prototype.hasOwnProperty.call(neighborhoodValues, item.id);
          const inheritedRate = region ? (region.fee_cents / 100).toFixed(2) : "";
          const displayedRate = hasRateDraft
            ? neighborhoodValues[item.id]
            : isManualOverride
              ? (item.fee_override_cents! / 100).toFixed(2)
              : inheritedRate;
          const effectiveFee = region?.free_shipping
            ? 0
            : (item.fee_override_cents ?? region?.fee_cents ?? 0);
          return (
            <article key={item.id} style={{ border: "1px solid #dbe3ef", borderRadius: 12, padding: 16, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 280px), 1fr))", gap: 14, alignItems: "start", minWidth: 0, background: "#fff" }}>
              <div style={{ gridColumn: "1 / -1", minWidth: 0, paddingBottom: 10, borderBottom: "1px solid #edf2f7" }}>
                <strong style={{ display: "block", fontSize: 16, marginBottom: 4 }}>{item.name}</strong>
                <div style={{ color: "#64748b", fontSize: 12, lineHeight: 1.5 }}>{item.record_type === "official" ? "Bairro oficial" : "Localidade / conjunto"} · {region?.name || "Região não definida"} · <strong style={{ color: "#172033" }}>{money(effectiveFee)}</strong>{region?.free_shipping ? " (frete grátis da região)" : isManualOverride ? " (taxa manual)" : " (taxa da região)"}</div>
              </div>
              <div style={{ display: "grid", gap: 8, minWidth: 0 }}>
                <label style={{ fontSize: 13, color: "#475569", fontWeight: 700 }}>Região de entrega</label>
                <select aria-label={"Região de entrega de " + item.name} value={neighborhoodRegionValues[item.id] ?? ""} onChange={(e) => setNeighborhoodRegionValues((old) => ({ ...old, [item.id]: e.target.value }))} style={{ ...inputStyle, minWidth: 0 }}>
                  <option value="">Não definida</option>
                  {regions.map((option) => <option key={option.id} value={option.id}>{option.name}{option.active ? "" : " (inativa)"}</option>)}
                </select>
                <button style={{ ...buttonStyle, width: "100%", padding: "10px 12px" }} disabled={savingId === item.id || (neighborhoodRegionValues[item.id] ?? "") === (item.region_id ?? "")} onClick={() => void saveNeighborhoodRegion(item)}>{savingId === item.id ? "Salvando..." : "Salvar região"}</button>
              </div>
              <div style={{ display: "grid", gap: 8, minWidth: 0 }}>
                <label style={{ fontSize: 13, color: "#475569", fontWeight: 700 }}>Taxa individual (R$)</label>
                <input
                  aria-label={"Taxa individual de " + item.name}
                  type="number"
                  min="0"
                  max="10000"
                  step="0.01"
                  placeholder={region ? "Taxa da região" : "Defina uma região"}
                  value={displayedRate}
                  onChange={(e) => setNeighborhoodValues((old) => ({ ...old, [item.id]: e.target.value }))}
                  style={{ ...inputStyle, minWidth: 0 }}
                />
                <small style={{ color: "#64748b", fontSize: 12, lineHeight: 1.5 }}>
                  {isManualOverride || hasRateDraft
                    ? "Valor manual: só este bairro será afetado"
                    : region
                      ? "Valor automático: acompanha a taxa cadastrada na região"
                      : "Selecione uma região para carregar a taxa"}
                  {region?.free_shipping ? " · Frete grátis ativo nesta região; esta taxa fica guardada." : ""}
                </small>
                <button
                  style={{ ...buttonStyle, width: "100%", padding: "10px 12px" }}
                  disabled={savingId === item.id || !hasRateDraft}
                  onClick={() => void saveNeighborhood(item)}
                >
                  {savingId === item.id ? "Salvando..." : "Salvar taxa manual"}
                </button>
                <button
                  style={{ ...buttonStyle, background: "#475569", width: "100%", padding: "10px 12px" }}
                  disabled={savingId === item.id || (!isManualOverride && !hasRateDraft)}
                  onClick={() => void useNeighborhoodRegionFee(item)}
                >
                  Usar taxa regional
                </button>
              </div>
              <div style={{ gridColumn: "1 / -1", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap", paddingTop: 10, borderTop: "1px solid #edf2f7" }}>
                <small style={{ color: item.active ? "#166534" : "#991b1b" }}>{item.active ? "Bairro atendido" : "Bairro sem atendimento"}</small>
                <button style={{ ...buttonStyle, padding: "7px 11px", background: item.active ? "#9f2d2d" : "#166534" }} disabled={savingId === item.id || (!item.active && !item.region_id)} onClick={() => void toggleNeighborhood(item)}>{item.active ? "Desativar" : item.region_id ? "Ativar" : "Defina a região para ativar"}</button>
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
