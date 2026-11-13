"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Package, RefreshCw, Search, Save, AlertTriangle, CheckCircle2 } from "lucide-react";
import { supabase } from "@/lib/supabase";

type Product = {
  id: string;
  name: string;
  category: string | null;
  price: number;
  stock: number;
  minimum_stock: number;
  active: boolean;
  image_url: string | null;
};

export default function StockPage() {
  const router = useRouter();
  const [authorized, setAuthorized] = useState(false);
  const [products, setProducts] = useState<Product[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [minimumDrafts, setMinimumDrafts] = useState<Record<string, string>>({});
  const [editingMinimumId, setEditingMinimumId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  const loadProducts = useCallback(async () => {
    const { data, error } = await supabase
      .from("products")
      .select("id,name,category,price,stock,minimum_stock,active,image_url")
      .order("name", { ascending: true });
    if (error) {
      setMessage("Não foi possível carregar o estoque: " + error.message);
      return;
    }
    const loaded = (data || []) as Product[];
    setProducts(loaded);
    const next: Record<string, string> = {};
    const nextMinimum: Record<string, string> = {};
    loaded.forEach((product) => {
      next[product.id] = String(product.stock ?? 0);
      nextMinimum[product.id] = String(product.minimum_stock ?? 5);
    });
    setDrafts(next);
    setMinimumDrafts(nextMinimum);
  }, []);

  useEffect(() => {
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
        setAuthorized(true);
        await loadProducts();
      } catch {
        router.replace("/admin/login");
      } finally {
        setLoading(false);
      }
    }
    void checkAdmin();
  }, [router, loadProducts]);

  const visibleProducts = useMemo(() => {
    const term = search.trim().toLowerCase();
    return products.filter((product) =>
      !term || product.name.toLowerCase().includes(term) ||
      (product.category || "").toLowerCase().includes(term)
    );
  }, [products, search]);

  const totalUnits = products.reduce((sum, product) => sum + Number(product.stock || 0), 0);
  const outOfStock = products.filter((product) => Number(product.stock) <= 0).length;
  const lowStock = products.filter((product) => Number(product.stock) > 0 && Number(product.stock) <= Number(product.minimum_stock ?? 5)).length;

  async function saveStock(product: Product) {
    const raw = drafts[product.id] ?? "";
    const quantity = Number(raw);
    if (!Number.isInteger(quantity) || quantity < 0) {
      setMessage("Informe uma quantidade inteira igual ou maior que zero.");
      return;
    }
    setSaving(product.id);
    setMessage("");
    const { error } = await supabase.from("products").update({
      stock: quantity,
      updated_at: new Date().toISOString(),
    }).eq("id", product.id);
    setSaving(null);
    if (error) {
      setMessage("Erro ao atualizar " + product.name + ": " + error.message);
      return;
    }
    setProducts((current) => current.map((item) =>
      item.id === product.id ? { ...item, stock: quantity } : item
    ));
    setMessage("Estoque de " + product.name + " atualizado com sucesso.");
  }

  async function saveMinimumStock(product: Product) {
    const raw = minimumDrafts[product.id] ?? String(product.minimum_stock ?? 5);
    const minimum = Number(raw);
    if (!Number.isInteger(minimum) || minimum < 0) {
      setMessage("Informe um estoque mínimo inteiro igual ou maior que zero.");
      return;
    }
    setSaving(product.id);
    setMessage("");
    const { error } = await supabase.from("products").update({
      minimum_stock: minimum,
      updated_at: new Date().toISOString(),
    }).eq("id", product.id);
    setSaving(null);
    if (error) {
      setMessage("Erro ao salvar o estoque mínimo de " + product.name + ": " + error.message);
      return;
    }
    setProducts((current) => current.map((item) =>
      item.id === product.id ? { ...item, minimum_stock: minimum } : item
    ));
    setEditingMinimumId(null);
    setMessage("Estoque mínimo de " + product.name + " salvo com sucesso.");
  }

  if (loading) return <main style={{ padding: 28, textAlign: "center" }}>Verificando acesso administrativo...</main>;
  if (!authorized) return null;

  const money = (value: number) => Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  return (
    <main className="admin-stock" style={{ minHeight: "100vh", background: "#f3f6fb", padding: "24px 16px 48px", fontFamily: "Arial, sans-serif", color: "#14243a" }}>
      <div style={{ maxWidth: 1080, margin: "auto" }}>
        <header style={{ background: "linear-gradient(125deg,#071b43,#173b68)", color: "#fff", padding: "25px 22px", borderRadius: 18, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 14, flexWrap: "wrap", boxShadow: "0 12px 28px rgba(16,43,80,.14)" }}>
          <div>
            <p style={{ margin: "0 0 8px", color: "#ffc928", fontSize: 12, fontWeight: 800, letterSpacing: 2 }}>NOVASHOPP STORE · ADMINISTRAÇÃO</p>
            <h1 style={{ margin: 0, fontSize: 28, display: "flex", alignItems: "center", gap: 10 }}><Package size={27} /> Controle de estoque</h1>
            <p style={{ margin: "8px 0 0", color: "#d8e5f3" }}>Consulte e atualize as quantidades disponíveis dos seus produtos.</p>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" onClick={() => void loadProducts()} style={{ padding: "11px 14px", border: 0, borderRadius: 8, background: "#fff", color: "#173b68", cursor: "pointer", fontWeight: 700 }}><RefreshCw size={15} style={{ display: "inline", marginRight: 6, verticalAlign: "middle" }} />Atualizar</button>
            <button type="button" onClick={() => router.push("/admin")} style={{ padding: "11px 14px", border: 0, borderRadius: 8, background: "#ffc928", color: "#173b68", cursor: "pointer", fontWeight: 800 }}><ArrowLeft size={15} style={{ display: "inline", marginRight: 5, verticalAlign: "middle" }} />Voltar ao painel</button>
          </div>
        </header>

        <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 12, margin: "18px 0" }}>
          {[
            { label: "Produtos cadastrados", value: products.length, color: "#173b68" },
            { label: "Unidades em estoque", value: totalUnits, color: "#173b68" },
            { label: "Estoque baixo (até 5)", value: lowStock, color: "#a16207" },
            { label: "Sem estoque", value: outOfStock, color: "#b42318" },
          ].map((item) => <article key={item.label} style={{ background: "#fff", border: "1px solid #e1e7f0", borderRadius: 13, padding: 17 }}>
            <p style={{ margin: 0, color: "#64748b", fontSize: 13 }}>{item.label}</p>
            <strong style={{ display: "block", fontSize: 27, marginTop: 8, color: item.color }}>{item.value}</strong>
          </article>)}
        </section>

        <section style={{ background: "#fff", border: "1px solid #e1e7f0", borderRadius: 14, padding: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
            <div><h2 style={{ margin: 0, fontSize: 20 }}>Produtos em estoque</h2><p style={{ margin: "5px 0 0", color: "#64748b", fontSize: 13 }}>Novos produtos cadastrados aparecem aqui automaticamente.</p></div>
            <div style={{ position: "relative", minWidth: 220, flex: "0 1 310px" }}>
              <Search size={17} style={{ position: "absolute", left: 11, top: 12, color: "#64748b" }} />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar produto ou categoria" style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px 10px 36px", border: "1px solid #cbd5e1", borderRadius: 8 }} />
            </div>
          </div>

          {message && <p role="status" style={{ padding: 11, borderRadius: 8, background: "#eff6ff", color: "#173b68" }}>{message}</p>}
          {visibleProducts.length === 0 ? <p style={{ color: "#64748b", padding: 20, textAlign: "center" }}>{products.length ? "Nenhum produto encontrado." : "Nenhum produto cadastrado. Cadastre um produto no painel para ele aparecer aqui."}</p> : (
            <div style={{ display: "grid", gap: 10 }}>
              {visibleProducts.map((product) => {
                const quantity = Number(product.stock || 0);
                const changed = (drafts[product.id] ?? String(quantity)) !== String(quantity);
                const minimum = Number(product.minimum_stock ?? 5);
                const belowMinimum = quantity < minimum;
                const atMinimum = quantity === minimum;
                const status = quantity <= 0 ? "Sem estoque" : belowMinimum ? "Abaixo do mínimo" : atMinimum ? "No mínimo" : "Acima do mínimo";
                const statusColor = belowMinimum ? "#b42318" : atMinimum ? "#a16207" : "#167044";
                const statusBackground = belowMinimum ? "#fff1f0" : atMinimum ? "#fff8e1" : "#effaf3";
                return <article key={product.id} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: 12, alignItems: "center", padding: 13, border: "1px solid " + (belowMinimum ? "#f2aaa5" : atMinimum ? "#f2d27a" : "#b7dfc5"), borderRadius: 11, background: statusBackground }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                    {product.image_url ? <img src={product.image_url} alt={product.name} style={{ width: 58, height: 58, objectFit: "contain", borderRadius: 8, background: "#f8fafc" }} /> : <div style={{ width: 58, height: 58, borderRadius: 8, background: "#f1f5f9", display: "grid", placeItems: "center", color: "#64748b" }}><Package size={23} /></div>}
                    <div style={{ minWidth: 0 }}>
                      <strong style={{ display: "block", overflowWrap: "anywhere" }}>{product.name}</strong>
                      <small style={{ display: "block", color: "#64748b", marginTop: 3 }}>{product.category || "Sem categoria"} · {money(Number(product.price))}</small>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: statusColor, fontSize: 12, fontWeight: 800, marginTop: 5 }}>{belowMinimum || atMinimum ? <AlertTriangle size={13} /> : <CheckCircle2 size={13} />}{status} · mínimo {minimum}</span>
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "end", gap: 7, flexWrap: "wrap", justifyContent: "end" }}>
                    <label style={{ fontSize: 12, color: "#64748b" }}>Quantidade
                      <input type="number" min="0" step="1" inputMode="numeric" value={drafts[product.id] ?? String(quantity)} onChange={(e) => setDrafts((current) => ({ ...current, [product.id]: e.target.value }))} style={{ display: "block", width: 92, boxSizing: "border-box", marginTop: 4, padding: 9, border: "1px solid #cbd5e1", borderRadius: 7, fontSize: 16 }} />
                    </label>
                    <button type="button" disabled={!changed || saving === product.id} onClick={() => void saveStock(product)} style={{ padding: "10px 12px", border: 0, borderRadius: 7, background: changed ? "#ffc928" : "#e2e8f0", color: "#173b68", cursor: changed ? "pointer" : "default", fontWeight: 800, opacity: saving === product.id ? .6 : 1 }}><Save size={14} style={{ display: "inline", marginRight: 5, verticalAlign: "middle" }} />{saving === product.id ? "Salvando" : "Salvar"}</button>
                    <button type="button" onClick={() => setEditingMinimumId(editingMinimumId === product.id ? null : product.id)} style={{ padding: "10px 12px", border: "1px solid #173b68", borderRadius: 7, background: "#fff", color: "#173b68", cursor: "pointer", fontWeight: 800 }}>Estoque mínimo</button>
                  </div>
                  {editingMinimumId === product.id && <div style={{ gridColumn: "1 / -1", display: "flex", alignItems: "end", gap: 8, flexWrap: "wrap", padding: "10px 0 0", borderTop: "1px solid #dbe3ed" }}>
                    <label style={{ fontSize: 12, color: "#64748b" }}>Definir quantidade mínima
                      <input type="number" min="0" step="1" inputMode="numeric" value={minimumDrafts[product.id] ?? String(minimum)} onChange={(e) => setMinimumDrafts((current) => ({ ...current, [product.id]: e.target.value }))} style={{ display: "block", width: 120, boxSizing: "border-box", marginTop: 4, padding: 9, border: "1px solid #cbd5e1", borderRadius: 7, fontSize: 16 }} />
                    </label>
                    <button type="button" disabled={saving === product.id} onClick={() => void saveMinimumStock(product)} style={{ padding: "10px 12px", border: 0, borderRadius: 7, background: "#ffc928", color: "#173b68", cursor: "pointer", fontWeight: 800 }}><Save size={14} style={{ display: "inline", marginRight: 5, verticalAlign: "middle" }} />Salvar mínimo</button>
                  </div>}
                </article>;
              })}
            </div>
          )}
        </section>
        <p style={{ color: "#64748b", fontSize: 12, textAlign: "center", marginTop: 16 }}>O controle utiliza o mesmo estoque dos produtos da loja. As quantidades atualizadas aqui também são usadas na disponibilidade para compra.</p>
      </div>
    </main>
  );
}
