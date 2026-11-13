"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft, RefreshCw, ShoppingBag, Wallet, Clock3, PackageCheck,
  Truck, MapPin, Phone, Mail, CalendarDays, Hash, Search, CheckCircle2,
  CreditCard, ExternalLink
} from "lucide-react";
import { supabase } from "@/lib/supabase";

type Order = {
  id: string;
  order_number: string;
  customer_name: string;
  customer_email: string | null;
  customer_phone: string | null;
  delivery_address: string | null;
  total: number;
  status: string;
  created_at: string;
  delivery_status: string;
  tracking_code: string | null;
  delivery_method: string | null;
  estimated_delivery_at: string | null;
  shipped_at: string | null;
  delivered_at: string | null;
  order_items: {
    product_name: string;
    quantity: number;
    unit_price: number;
    subtotal: number;
  }[];
};

const deliverySteps = [
  { value: "aguardando_separacao", label: "Pedido aceito" },
  { value: "em_preparacao", label: "Em separação" },
  { value: "enviado", label: "Enviado" },
  { value: "entregue", label: "Entregue" },
];

function normalizedStatus(status: string) {
  return (status || "").trim().toLowerCase();
}
function isPaid(status: string) {
  return ["pago", "aprovado", "approved", "concluido", "concluído"].includes(normalizedStatus(status));
}
function isCancelled(status: string) {
  return ["cancelado", "cancelada", "cancelled", "canceled"].includes(normalizedStatus(status));
}
function deliveryLabel(status: string) {
  return deliverySteps.find((step) => step.value === status)?.label || "Pedido aceito";
}
function whatsappLink(order: Order) {
  const digits = (order.customer_phone || "").replace(/\D/g, "");
  const phone = digits.startsWith("55") ? digits : `55${digits}`;
  const message = order.delivery_status === "entregue"
    ? `Olá, ${order.customer_name}! Seu pedido na NovaShopp Store foi marcado como entregue. Obrigado por comprar conosco! Esperamos que aproveite sua compra.`
    : `Olá, ${order.customer_name}! Seu pedido na NovaShopp Store foi enviado para entrega por motoboy. ${order.estimated_delivery_at ? `Previsão de entrega: ${new Date(order.estimated_delivery_at).toLocaleString("pt-BR")}. ` : ""}Acompanhe: https://novashoppstore.vercel.app/acompanhar`;
  return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
}

export default function OrdersPage() {
  const router = useRouter();
  const [authorized, setAuthorized] = useState(false);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [estimateDrafts, setEstimateDrafts] = useState<Record<string, string>>({});
  const [savingDelivery, setSavingDelivery] = useState<string | null>(null);

  async function loadOrders() {
    setLoading(true);
    setMessage("");
    const { data, error } = await supabase.from("orders").select(`
      id, order_number, customer_name, customer_email, customer_phone, delivery_address,
      total, status, created_at, delivery_status, tracking_code, delivery_method,
      estimated_delivery_at, shipped_at, delivered_at,
      order_items ( product_name, quantity, unit_price, subtotal )
    `).order("created_at", { ascending: false });

    if (error) {
      setMessage("Erro ao carregar pedidos: " + error.message);
      setOrders([]);
    } else {
      const loaded = ((data || []) as Order[]).filter((order) => isPaid(order.status));
      setOrders(loaded);
      const estimateDrafts: Record<string, string> = {};
      loaded.forEach((order) => {
        estimateDrafts[order.id] = order.estimated_delivery_at
          ? new Date(new Date(order.estimated_delivery_at).getTime() - new Date(order.estimated_delivery_at).getTimezoneOffset() * 60000).toISOString().slice(0, 16)
          : "";
      });
      setEstimateDrafts(estimateDrafts);
    }
    setLoading(false);
  }

  async function updateDeliveryStatus(order: Order, newStatus: string) {
    if (!isPaid(order.status)) {
      alert("O controle de entrega só está disponível após a confirmação do pagamento.");
      return;
    }
    const currentIndex = deliverySteps.findIndex((step) => step.value === (order.delivery_status || "aguardando_separacao"));
    const nextIndex = deliverySteps.findIndex((step) => step.value === newStatus);
    if (nextIndex < 0 || nextIndex < currentIndex) {
      alert("Não é possível voltar para uma etapa anterior. O pedido só pode avançar.");
      return;
    }
    if (newStatus === "entregue" && order.delivery_status !== "enviado" && order.delivery_status !== "entregue") {
      alert("Registre o pedido como enviado antes de marcar como entregue.");
      return;
    }
    const updates: Record<string, string> = { delivery_status: newStatus };
    if (newStatus === "enviado" && !order.shipped_at) updates.shipped_at = new Date().toISOString();
    if (newStatus === "entregue" && !order.delivered_at) updates.delivered_at = new Date().toISOString();

    setSavingDelivery(order.id);
    const { error } = await supabase.from("orders").update(updates).eq("id", order.id);
    setSavingDelivery(null);
    if (error) {
      alert("Erro ao atualizar entrega: " + error.message);
      return;
    }
    await loadOrders();
  }

  async function saveEstimatedDelivery(order: Order) {
    if (!isPaid(order.status)) {
      alert("A previsão só pode ser definida após a confirmação do pagamento.");
      return;
    }
    const value = estimateDrafts[order.id] || "";
    const estimated = value ? new Date(value) : null;
    if (estimated && Number.isNaN(estimated.getTime())) {
      alert("Informe uma data e horário válidos.");
      return;
    }
    if (estimated && estimated.getTime() < Date.now()) {
      alert("A previsão de entrega não pode estar no passado.");
      return;
    }
    setSavingDelivery(order.id);
    const { error } = await supabase.from("orders")
      .update({ estimated_delivery_at: estimated ? estimated.toISOString() : null, delivery_method: "motoboy" })
      .eq("id", order.id);
    setSavingDelivery(null);
    if (error) {
      alert("Erro ao salvar a previsão: " + error.message);
      return;
    }
    await loadOrders();
    alert("Previsão de entrega salva com sucesso.");
  }

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
        await loadOrders();
      } catch {
        router.replace("/admin/login");
      } finally {
        setLoading(false);
      }
    }

    void checkAdmin();
  }, [router]);

  if (loading) {
    return (
      <main className="min-h-screen bg-[#f5f7fb] p-8 text-center text-sm text-slate-500">
        Verificando acesso administrativo...
      </main>
    );
  }

  if (!authorized) return null;

  const money = (value: number) => Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const date = (value: string | null) => value ? new Date(value).toLocaleString("pt-BR") : "Ainda não registrado";
  const paymentLabel = (status: string) => {
    const labels: Record<string, string> = {
      aguardando: "Aguardando pagamento", pendente: "Aguardando pagamento", pending: "Aguardando pagamento",
      pago: "Pago", aprovado: "Aprovado", approved: "Aprovado", concluido: "Concluído", "concluído": "Concluído",
      cancelado: "Cancelado", cancelada: "Cancelado", canceled: "Cancelado", cancelled: "Cancelado"
    };
    return labels[normalizedStatus(status)] || status;
  };

  const revenue = orders.reduce((sum, order) => sum + Number(order.total || 0), 0);
  const visibleOrders = orders.filter((order) => {
    const term = search.trim().toLowerCase();
    return !term || order.customer_name.toLowerCase().includes(term) ||
      order.id.toLowerCase().includes(term) || order.order_number.toLowerCase().includes(term) || (order.customer_email || "").toLowerCase().includes(term);
  });

  return (
    <main style={{ minHeight: "100vh", background: "#f3f6fb", padding: "24px 16px 48px", fontFamily: "Arial, sans-serif", color: "#14243a" }}>
      <div style={{ maxWidth: 1080, margin: "auto" }}>
        <header style={{ background: "linear-gradient(125deg,#102b50,#1d4d7c)", color: "#fff", padding: "26px 24px", borderRadius: 18, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap", boxShadow: "0 12px 28px rgba(16,43,80,.16)" }}>
          <div>
            <p style={{ margin: "0 0 8px", color: "#f6cc55", fontSize: 12, fontWeight: 800, letterSpacing: 2 }}>NOVASHOPP STORE · ADMINISTRAÇÃO</p>
            <h1 style={{ margin: 0, fontSize: 28 }}>Gestão de pedidos</h1>
            <p style={{ margin: "8px 0 0", color: "#d8e5f3" }}>Gerencie pedidos, pagamentos e entregas em um só lugar.</p>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" onClick={() => void loadOrders()} disabled={loading} style={{ padding: "11px 16px", border: 0, borderRadius: 8, background: "#fff", color: "#173b68", cursor: "pointer", fontWeight: 700, opacity: loading ? .6 : 1 }}>
              <RefreshCw size={15} style={{ display: "inline", marginRight: 6, verticalAlign: "middle" }} />Atualizar
            </button>
            <button type="button" onClick={() => router.push("/admin")} style={{ padding: "11px 16px", border: 0, borderRadius: 8, background: "#ffc928", color: "#173b68", cursor: "pointer", fontWeight: 800 }}>
              ← Voltar ao painel
            </button>
          </div>
        </header>

        <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 12, margin: "18px 0" }}>
          {[
            { label: "Total vendido", value: money(revenue), note: "Somente pagamentos confirmados" },
            { label: "Pedidos pagos", value: String(orders.length), note: "Pedidos aprovados" },
          ].map(item => (
            <article key={item.label} style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, padding: 18, boxShadow: "0 4px 14px rgba(15,23,42,.04)" }}>
              <p style={{ margin: 0, color: "#64748b", fontSize: 13 }}>{item.label}</p>
              <strong style={{ display: "block", fontSize: 25, margin: "7px 0", color: "#173b68", overflowWrap: "anywhere" }}>{item.value}</strong>
              <small style={{ color: "#8492a6" }}>{item.note}</small>
            </article>
          ))}
        </section>

        <section style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 16, padding: 20, boxShadow: "0 6px 20px rgba(15,23,42,.05)", marginBottom: 18 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
            <div>
              <h2 style={{ margin: 0, fontSize: 21, color: "#14243a" }}>Pedidos da loja</h2>
              <p style={{ margin: "6px 0 0", color: "#64748b", fontSize: 13 }}>{visibleOrders.length} pedido(s) encontrado(s)</p>
            </div>
            <div style={{ width: "100%", maxWidth: 320 }}>
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar cliente ou pedido" style={{ width: "100%", padding: 12, border: "1px solid #cbd5e1", borderRadius: 8, boxSizing: "border-box", background: "#fff" }} />
            </div>
          </div>

        </section>

        {message && <p role="status" style={{ background: "#fff", border: "1px solid #f2c7c7", color: "#a12626", padding: 14, borderRadius: 10, overflowWrap: "anywhere" }}>{message}</p>}
        {loading && <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, padding: 28, textAlign: "center", color: "#64748b" }}>Carregando pedidos...</div>}
        {!loading && !message && visibleOrders.length === 0 && (
          <div style={{ background: "#fff", border: "1px dashed #cbd5e1", borderRadius: 14, padding: 28, textAlign: "center", color: "#64748b" }}>
            <PackageCheck size={34} style={{ margin: "0 auto 10px", color: "#94a3b8" }} />
            <strong style={{ display: "block", color: "#173b68" }}>Nenhum pedido encontrado</strong>
            <span style={{ fontSize: 13 }}>Tente alterar o filtro ou a busca.</span>
          </div>
        )}

        <div style={{ display: "grid", gap: 14 }}>
          {!loading && visibleOrders.map(order => {
            const paidOrder = isPaid(order.status);
            const currentStep = deliverySteps.findIndex(step => step.value === (order.delivery_status || "aguardando_separacao"));
            return (
              <article key={order.id} style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 15, padding: 18, boxShadow: "0 5px 16px rgba(15,23,42,.045)", overflow: "hidden" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", borderBottom: "1px solid #edf1f5", paddingBottom: 13 }}>
                  <div style={{ minWidth: 0 }}>
                    <span style={{ display: "block", color: "#64748b", fontSize: 11, fontWeight: 800, letterSpacing: 1 }}>PEDIDO #{order.order_number}</span>
                    <h3 style={{ margin: "5px 0 3px", color: "#173b68", fontSize: 18, overflowWrap: "anywhere" }}>{order.customer_name}</h3>
                    <span style={{ color: "#8492a6", fontSize: 12 }}>{new Date(order.created_at).toLocaleString("pt-BR")}</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
                    <span style={{ borderRadius: 20, padding: "6px 10px", fontSize: 11, fontWeight: 800, color: paidOrder ? "#16713b" : isCancelled(order.status) ? "#a12626" : "#815c00", background: paidOrder ? "#e9f7ee" : isCancelled(order.status) ? "#fff0f0" : "#fff5d6" }}>{paymentLabel(order.status)}</span>
                    <strong style={{ color: "#173b68", fontSize: 19 }}>{money(order.total)}</strong>
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: 18, padding: "16px 0" }}>
                  <div>
                    <p style={{ margin: "0 0 9px", color: "#173b68", fontSize: 12, fontWeight: 800 }}>DADOS DO CLIENTE</p>
                    <div style={{ display: "grid", gap: 8, color: "#526176", fontSize: 13 }}>
                      <p style={{ margin: 0, overflowWrap: "anywhere" }}><Mail size={14} style={{ display: "inline", marginRight: 7, verticalAlign: "middle", color: "#a47b00" }} />{order.customer_email || "E-mail não informado"}</p>
                      <p style={{ margin: 0, overflowWrap: "anywhere" }}><Phone size={14} style={{ display: "inline", marginRight: 7, verticalAlign: "middle", color: "#a47b00" }} />{order.customer_phone || "Telefone não informado"}</p>
                      <p style={{ margin: 0 }}><MapPin size={14} style={{ display: "inline", marginRight: 7, verticalAlign: "middle", color: "#a47b00" }} />{order.delivery_address || "Endereço não informado"}</p>
                    </div>
                  </div>
                  <div>
                    <p style={{ margin: "0 0 9px", color: "#173b68", fontSize: 12, fontWeight: 800 }}>RESUMO DA COMPRA</p>
                    <div style={{ display: "grid", gap: 8 }}>
                      {order.order_items?.map((item, index) => (
                        <div key={index} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 13 }}>
                          <span style={{ color: "#526176", minWidth: 0, overflowWrap: "anywhere" }}>{item.product_name} × {item.quantity}</span>
                          <strong style={{ color: "#24364b", whiteSpace: "nowrap" }}>{money(item.subtotal)}</strong>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div style={{ background: "#f7f9fc", border: "1px solid #edf1f5", borderRadius: 12, padding: 15 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
                    <div>
                      <strong style={{ display: "block", color: "#173b68", fontSize: 14 }}>Etapas do pedido</strong>
                      <span style={{ color: "#64748b", fontSize: 12 }}>O cliente acompanha a evolução da entrega.</span>
                    </div>
                    <span style={{ background: "#fff5d6", color: "#815c00", borderRadius: 20, padding: "6px 10px", fontSize: 11, fontWeight: 800 }}>{deliveryLabel(order.delivery_status || "aguardando_separacao")}</span>
                  </div>

                  {paidOrder ? (
                    <>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 6, marginBottom: 14 }}>
                        {deliverySteps.map((step, index) => {
                          const completed = currentStep >= index;
                          return <div key={step.value} style={{ minWidth: 0 }}>
                            <div style={{ height: 6, borderRadius: 8, background: completed ? "#e5b72e" : "#dbe2ea" }} />
                            <p style={{ margin: "6px 0 0", textAlign: "center", fontSize: 10, lineHeight: 1.25, color: completed ? "#173b68" : "#8492a6", fontWeight: 700 }}>{step.label}</p>
                          </div>;
                        })}
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(210px,1fr))", gap: 12 }}>
                        <div>
                          <label style={{ display: "block", color: "#526176", fontSize: 12, fontWeight: 700, marginBottom: 6 }}>Atualizar etapa</label>
                          <select value={order.delivery_status || "aguardando_separacao"} disabled={savingDelivery === order.id} onChange={e => void updateDeliveryStatus(order, e.target.value)} style={{ width: "100%", padding: 12, border: "1px solid #cbd5e1", borderRadius: 8, background: "#fff", boxSizing: "border-box" }}>
                            {deliverySteps.map((step, index) => <option key={step.value} value={step.value} disabled={index < currentStep}>{step.label}</option>)}
                          </select>
                        </div>
                        <div>
                          <label style={{ display: "block", color: "#526176", fontSize: 12, fontWeight: 700, marginBottom: 6 }}>Previsão de entrega (motoboy)</label>
                          <input type="datetime-local" value={estimateDrafts[order.id] ?? ""} onChange={e => setEstimateDrafts(current => ({ ...current, [order.id]: e.target.value }))} style={{ width: "100%", padding: 12, border: "1px solid #cbd5e1", borderRadius: 8, boxSizing: "border-box", background: "#fff" }} />
                        </div>
                      </div>
                      <p style={{ margin: "10px 0 0", color: "#526176", fontSize: 12 }}><Truck size={14} style={{ display: "inline", marginRight: 5, verticalAlign: "middle" }} />Modalidade de entrega: <strong>Motoboy / entrega própria</strong></p>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 11 }}>
                        <button type="button" disabled={savingDelivery === order.id} onClick={() => void saveEstimatedDelivery(order)} style={{ padding: "10px 15px", border: 0, borderRadius: 8, background: "#173b68", color: "#fff", cursor: "pointer", fontWeight: 700, opacity: savingDelivery === order.id ? .6 : 1 }}>{savingDelivery === order.id ? "Salvando..." : "Salvar previsão"}</button>
                        {(order.delivery_status === "enviado" || order.delivery_status === "entregue") && order.customer_phone && (
                          <a href={whatsappLink(order)} target="_blank" rel="noopener noreferrer" style={{ display: "inline-flex", alignItems: "center", padding: "10px 15px", borderRadius: 8, background: "#16713b", color: "#fff", textDecoration: "none", fontSize: 13, fontWeight: 700 }}>
                            {order.delivery_status === "entregue" ? "Avisar entrega concluída pelo WhatsApp" : "Avisar envio pelo WhatsApp"} <ExternalLink size={13} style={{ marginLeft: 7 }} />
                          </a>
                        )}
                        {savingDelivery === order.id && <span style={{ alignSelf: "center", color: "#64748b", fontSize: 12 }}>Salvando alteração...</span>}
                      </div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 16, borderTop: "1px solid #e2e8f0", marginTop: 13, paddingTop: 11, color: "#8492a6", fontSize: 11 }}>
                        <span><Truck size={13} style={{ display: "inline", verticalAlign: "middle", marginRight: 4 }} />Enviado: {date(order.shipped_at)}</span>
                        <span><CheckCircle2 size={13} style={{ display: "inline", verticalAlign: "middle", marginRight: 4 }} />Entregue: {date(order.delivered_at)}</span>
                      </div>
                    </>
                  ) : (
                    <p style={{ margin: 0, color: "#64748b", fontSize: 13 }}><CreditCard size={15} style={{ display: "inline", marginRight: 6, verticalAlign: "middle" }} />As etapas de entrega serão liberadas após a confirmação do pagamento.</p>
                  )}
                </div>
              </article>
            );
          })}
        </div>
        <footer style={{ marginTop: 28, borderTop: "1px solid #e2e8f0", paddingTop: 16, textAlign: "center", color: "#8492a6", fontSize: 12 }}>NovaShopp Store · Gestão de pedidos e entregas</footer>
      </div>
    </main>
  );
}
