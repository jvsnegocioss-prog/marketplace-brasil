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
  customer_name: string;
  customer_email: string | null;
  customer_phone: string | null;
  delivery_address: string | null;
  total: number;
  status: string;
  created_at: string;
  delivery_status: string;
  tracking_code: string | null;
  shipped_at: string | null;
  delivered_at: string | null;
  order_items: {
    product_name: string;
    quantity: number;
    unit_price: number;
    subtotal: number;
  }[];
};

type Filter = "todos" | "pagos" | "aguardando" | "cancelados";

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
function isWaiting(status: string) {
  return ["aguardando", "pendente", "pending"].includes(normalizedStatus(status));
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
  const message = `Olá, ${order.customer_name}! Seu pedido na NovaShopp Store foi enviado. ${order.tracking_code ? `Código de rastreio: ${order.tracking_code}. ` : ""}Acompanhe: https://novashoppstore.vercel.app/acompanhar`;
  return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
}

export default function OrdersPage() {
  const router = useRouter();
  const [authorized, setAuthorized] = useState(false);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [filter, setFilter] = useState<Filter>("todos");
  const [search, setSearch] = useState("");
  const [trackingDrafts, setTrackingDrafts] = useState<Record<string, string>>({});
  const [savingDelivery, setSavingDelivery] = useState<string | null>(null);

  async function loadOrders() {
    setLoading(true);
    setMessage("");
    const { data, error } = await supabase.from("orders").select(`
      id, customer_name, customer_email, customer_phone, delivery_address,
      total, status, created_at, delivery_status, tracking_code, shipped_at,
      delivered_at, order_items ( product_name, quantity, unit_price, subtotal )
    `).order("created_at", { ascending: false });

    if (error) {
      setMessage("Erro ao carregar pedidos: " + error.message);
      setOrders([]);
    } else {
      const loaded = (data || []) as Order[];
      setOrders(loaded);
      const drafts: Record<string, string> = {};
      loaded.forEach((order) => { drafts[order.id] = order.tracking_code || ""; });
      setTrackingDrafts(drafts);
    }
    setLoading(false);
  }

  async function updateDeliveryStatus(order: Order, newStatus: string) {
    if (!isPaid(order.status)) {
      alert("O controle de entrega só está disponível após a confirmação do pagamento.");
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

  async function saveTrackingCode(order: Order) {
    if (!isPaid(order.status)) {
      alert("O código de rastreio só pode ser salvo após a confirmação do pagamento.");
      return;
    }
    setSavingDelivery(order.id);
    const { error } = await supabase.from("orders")
      .update({ tracking_code: (trackingDrafts[order.id] || "").trim() || null })
      .eq("id", order.id);
    setSavingDelivery(null);
    if (error) {
      alert("Erro ao salvar rastreio: " + error.message);
      return;
    }
    await loadOrders();
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

  const paid = orders.filter((o) => isPaid(o.status));
  const waiting = orders.filter((o) => isWaiting(o.status));
  const cancelled = orders.filter((o) => isCancelled(o.status));
  const revenue = paid.reduce((sum, o) => sum + Number(o.total || 0), 0);
  const visibleOrders = orders.filter((order) => {
    const matchesFilter = filter === "todos" || (filter === "pagos" && isPaid(order.status)) ||
      (filter === "aguardando" && isWaiting(order.status)) || (filter === "cancelados" && isCancelled(order.status));
    const term = search.trim().toLowerCase();
    const matchesSearch = !term || order.customer_name.toLowerCase().includes(term) ||
      order.id.toLowerCase().includes(term) || (order.customer_email || "").toLowerCase().includes(term);
    return matchesFilter && matchesSearch;
  });

  const filters: { value: Filter; label: string; count: number }[] = [
    { value: "todos", label: "Todos", count: orders.length },
    { value: "pagos", label: "Pagos", count: paid.length },
    { value: "aguardando", label: "Aguardando", count: waiting.length },
    { value: "cancelados", label: "Cancelados", count: cancelled.length },
  ];

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#f3f6fb_0%,#f8faff_48%,#f2f5fa_100%)] text-[#17243b]">
      <div className="bg-[#06183d] px-[5%] py-2.5 text-center text-[10px] font-extrabold tracking-[0.16em] text-white sm:flex sm:justify-between sm:text-left"><span>NOVASHOPP STORE <span className="text-[#ffc928]">·</span> COMPRE FÁCIL, RECEBA RÁPIDO</span><span className="hidden text-[#ffc928] sm:inline">PAINEL DE OPERAÇÕES</span></div>
      <header className="header sticky top-0 z-20 !flex-wrap !justify-between !gap-4 !border-b !border-slate-100 !bg-white/95 !px-[5%] !py-4 !shadow-[0_8px_24px_rgba(7,27,67,0.06)] backdrop-blur">
        <Link href="/" className="logo" aria-label="NovaShopp Store">
          <span className="logo-icon">N</span>
          <span className="brand-name">NovaShopp<span className="logo-dot">.</span><small>STORE · ADMIN</small></span>
        </Link>
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <span className="hidden sm:inline-flex items-center rounded-full bg-[#fff8dc] px-3 py-2 text-xs font-bold text-[#806000]">
            Gestão da loja
          </span>
          <button onClick={() => void loadOrders()} disabled={loading} className="inline-flex items-center gap-2 rounded-xl border border-[#e2e8f0] bg-white px-4 py-2.5 text-sm font-bold text-[#06183d] transition hover:border-[#ffc400] hover:bg-[#fff9e5] disabled:opacity-60">
            <RefreshCw size={16} className={loading ? "animate-spin" : ""} /> Atualizar
          </button>
          <Link href="/admin" className="inline-flex items-center gap-2 rounded-xl bg-[#ffc400] px-4 py-2.5 text-sm font-extrabold text-[#06183d] shadow-sm transition hover:bg-[#f2b900]">
            <ArrowLeft size={16} /> Voltar ao painel
          </Link>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-4 py-7 sm:px-6 lg:px-8">
        <div className="mb-7 overflow-hidden rounded-3xl bg-[linear-gradient(120deg,#06183d_0%,#0b2b62_62%,#164781_100%)] px-5 py-7 text-white shadow-[0_18px_42px_rgba(7,27,67,0.16)] sm:px-8 sm:py-9">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="max-w-2xl">
              <p className="mb-2 text-[10px] font-extrabold uppercase tracking-[0.2em] text-[#ffc928]">NOVASHOPP STORE · ADMINISTRAÇÃO</p>
              <h1 className="font-[Outfit,sans-serif] text-2xl font-extrabold tracking-tight sm:text-4xl">Gestão de pedidos</h1>
              <p className="mt-2 text-sm leading-relaxed text-blue-100 sm:text-base">Gerencie pedidos, confirme etapas e acompanhe cada entrega em um só lugar.</p>
            </div>
            <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-4 py-2 text-xs font-bold text-white backdrop-blur">
              <span className="inline-block h-2 w-2 rounded-full bg-[#ffc928] shadow-[0_0_0_4px_rgba(255,201,40,0.15)]" /> Painel de operações ativo
            </div>
          </div>
        </div>

        <section className="mb-7 grid grid-cols-2 gap-3 xl:grid-cols-4">
          {[
            { label: "Total vendido", value: money(revenue), detail: "Pedidos com pagamento confirmado", icon: Wallet, color: "text-emerald-600", bg: "bg-emerald-50" },
            { label: "Pedidos pagos", value: String(paid.length), detail: "Pagamentos confirmados", icon: CheckCircle2, color: "text-[#a47b00]", bg: "bg-[#fff8dc]" },
            { label: "Aguardando pagamento", value: String(waiting.length), detail: "Precisam de confirmação", icon: Clock3, color: "text-amber-600", bg: "bg-amber-50" },
            { label: "Total de pedidos", value: String(orders.length), detail: `${cancelled.length} cancelado(s)`, icon: ShoppingBag, color: "text-[#06183d]", bg: "bg-[#eef3fc]" },
          ].map((card) => {
            const Icon = card.icon;
            return (
              <div key={card.label} className="rounded-2xl border border-[#e5ebf4] bg-white p-4 shadow-[0_8px_26px_rgba(7,27,67,0.055)] transition-shadow hover:shadow-[0_12px_30px_rgba(7,27,67,0.09)] sm:p-5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-slate-500 sm:text-sm">{card.label}</p>
                    <p className="mt-2 break-words text-xl font-extrabold tracking-tight text-[#06183d] sm:text-2xl">{card.value}</p>
                  </div>
                  <span className={`rounded-lg p-2 ${card.bg} ${card.color}`}><Icon size={20} /></span>
                </div>
                <p className="mt-2 text-[11px] text-slate-400 sm:text-xs">{card.detail}</p>
              </div>
            );
          })}
        </section>

        <section className="mb-5 rounded-2xl border border-[#e5ebf4] bg-white p-4 shadow-[0_8px_26px_rgba(7,27,67,0.05)] sm:p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-bold text-[#06183d]">Pedidos da loja</h2>
              <p className="mt-0.5 text-xs text-slate-500">{visibleOrders.length} pedido(s) encontrado(s)</p>
            </div>
            <div className="relative w-full sm:max-w-xs">
              <Search size={17} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar cliente ou pedido" className="w-full rounded-lg border border-[#e2e8f0] bg-[#f8faff] py-3 pl-9 pr-3 text-sm outline-none transition focus:border-[#ffc400] focus:bg-white focus:ring-2 focus:ring-[#fff0b3]" />
            </div>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {filters.map((item) => (
              <button key={item.value} onClick={() => setFilter(item.value)} className={`shrink-0 rounded-full px-4 py-2.5 text-xs font-bold transition sm:text-sm ${filter === item.value ? "bg-[#06183d] text-white shadow-sm" : "border border-[#e8edf4] bg-white text-slate-600 hover:border-[#ffc400] hover:bg-[#fff9e5] hover:text-[#806000]"}`}>
                {item.label} <span className={`ml-1 ${filter === item.value ? "text-[#ffc400]" : "text-slate-400"}`}>{item.count}</span>
              </button>
            ))}
          </div>
        </section>

        {loading && <div className="rounded-2xl border border-[#e8edf4] bg-white p-10 text-center text-sm text-slate-500">Carregando pedidos...</div>}
        {!loading && message && <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-700">{message}</div>}
        {!loading && !message && visibleOrders.length === 0 && (
          <div className="rounded-xl border border-dashed border-slate-300 bg-white px-5 py-14 text-center">
            <PackageCheck className="mx-auto mb-3 text-slate-300" size={38} />
            <h2 className="font-bold text-[#06183d]">Nenhum pedido encontrado</h2>
            <p className="mt-1 text-sm text-slate-500">Tente alterar o filtro ou a busca.</p>
          </div>
        )}

        <div className="space-y-4">
          {!loading && visibleOrders.map((order) => {
            const paidOrder = isPaid(order.status);
            const currentStep = deliverySteps.findIndex((step) => step.value === (order.delivery_status || "aguardando_separacao"));
            return (
              <article key={order.id} className="overflow-hidden rounded-2xl border border-[#e5ebf4] bg-white shadow-[0_10px_32px_rgba(7,27,67,0.07)] transition-shadow hover:shadow-[0_14px_38px_rgba(7,27,67,0.10)]">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-4 sm:px-5">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#fff8dc] text-[#06183d]"><ShoppingBag size={19} /></span>
                    <div className="min-w-0">
                      <h3 className="truncate font-extrabold text-[#06183d]">{order.customer_name}</h3>
                      <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-slate-400">
                        <span className="inline-flex items-center gap-1"><Hash size={11} />{order.id.slice(0, 8).toUpperCase()}</span>
                        <span>•</span>
                        <span className="inline-flex items-center gap-1"><CalendarDays size={11} />{new Date(order.created_at).toLocaleString("pt-BR")}</span>
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`rounded-full px-3 py-1 text-xs font-bold ${paidOrder ? "bg-emerald-50 text-emerald-700" : isCancelled(order.status) ? "bg-red-50 text-red-700" : "bg-[#fff6d8] text-[#806000]"}`}>{paymentLabel(order.status)}</span>
                    <strong className="text-lg font-extrabold text-[#06183d]">{money(order.total)}</strong>
                  </div>
                </div>

                <div className="grid gap-4 px-4 py-4 sm:grid-cols-2 sm:px-5">
                  <div>
                    <p className="mb-2 text-[11px] font-extrabold uppercase tracking-wider text-slate-400">Dados do cliente</p>
                    <div className="space-y-2 text-sm text-slate-600">
                      <p className="flex min-w-0 items-start gap-2"><Mail size={15} className="mt-0.5 shrink-0 text-[#a47b00]" /><span className="break-all">{order.customer_email || "E-mail não informado"}</span></p>
                      <p className="flex items-start gap-2"><Phone size={15} className="mt-0.5 shrink-0 text-[#a47b00]" />{order.customer_phone || "Telefone não informado"}</p>
                      <p className="flex items-start gap-2"><MapPin size={15} className="mt-0.5 shrink-0 text-[#a47b00]" /><span>{order.delivery_address || "Endereço não informado"}</span></p>
                    </div>
                  </div>
                  <div>
                    <p className="mb-2 text-[11px] font-extrabold uppercase tracking-wider text-slate-400">Resumo da compra</p>
                    <div className="space-y-2">
                      {order.order_items?.map((item, index) => (
                        <div key={index} className="flex items-start justify-between gap-3 text-sm">
                          <span className="min-w-0 text-slate-600">{item.product_name} <span className="text-slate-400">× {item.quantity}</span></span>
                          <strong className="shrink-0 text-slate-700">{money(item.subtotal)}</strong>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="border-t border-slate-100 bg-[#f8faff] px-4 py-4 sm:px-5">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-extrabold text-[#06183d]">Etapas do pedido</p>
                      <p className="text-xs text-slate-500">O cliente acompanha a evolução da entrega.</p>
                    </div>
                    <span className="rounded-full bg-[#fff8dc] px-3 py-1 text-xs font-bold text-[#806000]">{deliveryLabel(order.delivery_status || "aguardando_separacao")}</span>
                  </div>

                  {paidOrder ? (
                    <>
                      <div className="mb-4 grid grid-cols-4 gap-1">
                        {deliverySteps.map((step, index) => {
                          const completed = currentStep >= index;
                          return (
                            <div key={step.value} className="min-w-0">
                              <div className={`h-1.5 rounded-full ${completed ? "bg-[#ffc400]" : "bg-slate-200"}`} />
                              <p className={`mt-1.5 text-center text-[9px] font-semibold leading-tight sm:text-[11px] ${completed ? "text-[#06183d]" : "text-slate-400"}`}>{step.label}</p>
                            </div>
                          );
                        })}
                      </div>
                      <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
                        <div>
                          <label className="mb-1.5 block text-xs font-bold text-slate-600">Atualizar etapa</label>
                          <select value={order.delivery_status || "aguardando_separacao"} disabled={savingDelivery === order.id} onChange={(e) => void updateDeliveryStatus(order, e.target.value)} className="w-full rounded-xl border border-[#e2e8f0] bg-white px-3 py-3 text-sm font-semibold text-[#06183d] outline-none focus:border-[#ffc400] focus:ring-2 focus:ring-[#fff0b3]">
                            {deliverySteps.map((step) => <option key={step.value} value={step.value}>{step.label}</option>)}
                          </select>
                        </div>
                        <div className="flex items-end">
                          <span className="text-xs text-slate-400">{savingDelivery === order.id ? "Salvando alteração..." : "Alterações salvas no pedido"}</span>
                        </div>
                      </div>
                      <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]">
                        <div>
                          <label className="mb-1.5 block text-xs font-bold text-slate-600">Código de rastreio</label>
                          <input value={trackingDrafts[order.id] ?? ""} onChange={(e) => setTrackingDrafts((current) => ({ ...current, [order.id]: e.target.value }))} placeholder="Digite o código de rastreio" className="w-full rounded-lg border border-slate-200 bg-white px-3 py-3 text-sm outline-none focus:border-[#ffc400] focus:ring-2 focus:ring-[#fff0b3]" />
                        </div>
                        <button type="button" disabled={savingDelivery === order.id} onClick={() => void saveTrackingCode(order)} className="rounded-xl bg-[#06183d] px-5 py-3 text-sm font-extrabold text-white shadow-sm transition hover:bg-[#123b78] disabled:opacity-50">Salvar rastreio</button>
                      </div>
                      {order.delivery_status === "enviado" && order.customer_phone && (
                        <a href={whatsappLink(order)} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex items-center gap-2 rounded-xl bg-[#12805c] px-4 py-2.5 text-sm font-bold text-white transition hover:bg-[#0d684a]">
                          Avisar cliente pelo WhatsApp <ExternalLink size={14} />
                        </a>
                      )}
                      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 border-t border-slate-200 pt-3 text-[11px] text-slate-400">
                        <span><Truck className="mr-1 inline" size={12} />Enviado: {date(order.shipped_at)}</span>
                        <span><CheckCircle2 className="mr-1 inline" size={12} />Entregue: {date(order.delivered_at)}</span>
                      </div>
                    </>
                  ) : (
                    <p className="flex items-center gap-2 text-sm text-slate-500"><CreditCard size={16} />As etapas de entrega serão liberadas após a confirmação do pagamento.</p>
                  )}
                </div>
              </article>
            );
          })}
        </div>
        <footer className="mt-8 border-t border-slate-200 py-5 text-center text-xs text-slate-400">NovaShopp Store · Gestão de pedidos e entregas</footer>
      </div>
    </main>
  );
}
