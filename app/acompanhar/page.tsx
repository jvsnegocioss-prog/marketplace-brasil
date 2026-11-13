"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  PackageSearch,
  Search,
  ShieldCheck,
  Truck,
  CheckCircle2,
  Clock3,
  CalendarDays,
  PackageCheck,
} from "lucide-react";

type TrackingResult = {
  order_id: string;
  payment_status: string;
  delivery_status: string | null;
  tracking_code: string | null;
  delivery_method: string | null;
  estimated_delivery_at: string | null;
  created_at: string;
  shipped_at: string | null;
  delivered_at: string | null;
};

function paymentLabel(status: string) {
  const value = status?.toLowerCase();
  if (["pago", "paid", "approved", "aprovado"].includes(value)) return "Pagamento aprovado";
  if (["cancelado", "cancelled", "rejected"].includes(value)) return "Pagamento cancelado";
  if (["aguardando", "pending", "in_process"].includes(value)) return "Aguardando pagamento";
  return status || "Não informado";
}

function deliveryLabel(status: string | null) {
  const labels: Record<string, string> = {
    aguardando_separacao: "Pedido aceito",
    em_preparacao: "Em separação",
    enviado: "Enviado",
    entregue: "Entregue",
  };
  return status ? labels[status] || status.replaceAll("_", " ") : "Ainda não atualizado";
}

function deliveryStepIndex(status: string | null) {
  const steps: Record<string, number> = {
    aguardando_separacao: 0,
    em_preparacao: 1,
    enviado: 2,
    entregue: 3,
  };
  return status ? (steps[status] ?? 0) : 0;
}

function formatDate(date: string | null) {
  if (!date) return "Aguardando atualização";
  return new Date(date).toLocaleString("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

export default function AcompanharPedidoPage() {
  const [orderId, setOrderId] = useState("");
  const [phone, setPhone] = useState("");
  const [order, setOrder] = useState<TrackingResult | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const selectedOrderId = params.get("pedido") || "";
    if (!selectedOrderId) return;

    let active = true;
    async function loadLoggedOrder() {
      setOrderId(selectedOrderId);
      setLoading(true);
      setError("");
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData.session?.access_token;
        if (!token) {
          setError("Entre na sua conta para abrir os detalhes deste pedido.");
          return;
        }
        const response = await fetch("/api/conta/pedidos", {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Não foi possível carregar o pedido.");
        const selected = (result.orders || []).find((item: any) => item.id === selectedOrderId);
        if (!selected) throw new Error("Este pedido não foi encontrado no histórico da sua conta.");
        if (active) setOrder({
          order_id: selected.id,
          payment_status: selected.status,
          delivery_status: selected.delivery_status,
          tracking_code: selected.tracking_code,
          delivery_method: selected.delivery_method,
          estimated_delivery_at: selected.estimated_delivery_at,
          created_at: selected.created_at,
          shipped_at: selected.shipped_at,
          delivered_at: selected.delivered_at,
        });
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : "Não foi possível abrir os detalhes do pedido.");
      } finally {
        if (active) setLoading(false);
      }
    }
    loadLoggedOrder();
    return () => { active = false; };
  }, []);

  async function handleSearch(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setOrder(null);

    if (!orderId.trim() || !phone.trim()) {
      setError("Informe o número do pedido e o telefone utilizado na compra.");
      return;
    }

    setLoading(true);
    try {
      const { data, error: rpcError } = await supabase.rpc("track_customer_order", {
        p_order_id: orderId.trim(),
        p_phone: phone.trim(),
      });

      if (rpcError) {
        setError("Não foi possível consultar o pedido. Confira os dados e tente novamente.");
        return;
      }

      const result = Array.isArray(data) ? data[0] : data;
      if (!result) {
        setError("Não encontramos pedido com esses dados. Confira o número e o telefone.");
        return;
      }
      setOrder(result as TrackingResult);
    } catch {
      setError("Ocorreu um erro na consulta. Tente novamente.");
    } finally {
      setLoading(false);
    }
  }

  const currentStep = order ? deliveryStepIndex(order.delivery_status) : 0;
  const steps = [
    { title: "Pedido aceito", description: "Seu pedido foi confirmado pela loja", date: order?.created_at },
    { title: "Em separação", description: "Estamos separando seus produtos", date: null },
    { title: "Enviado", description: "Seu pedido foi despachado", date: order?.shipped_at },
    { title: "Entregue", description: "Entrega concluída com sucesso", date: order?.delivered_at },
  ];

  return (
    <main className="tracking-page">
      <div className="tracking-container">
        <a href="/" className="tracking-brand">
          <span className="tracking-brand-mark">N</span>
          <span>NOVASHOPP <b>STORE</b></span>
        </a>

        <section className="tracking-hero">
          <div className="tracking-hero-copy">
            <span className="tracking-eyebrow">CENTRAL DE PEDIDOS</span>
            <h1>Acompanhe sua compra <span>em cada etapa.</span></h1>
            <p>Tenha informações atualizadas sobre o pagamento e a entrega do seu pedido, em um só lugar.</p>
            <div className="tracking-trust"><ShieldCheck size={16} /> Consulta segura com seus dados de compra</div>
          </div>
          <div className="tracking-hero-art" aria-hidden="true">
            <div className="tracking-art-circle"><PackageSearch size={76} strokeWidth={1.35} /></div>
            <span className="tracking-art-dot dot-one"></span>
            <span className="tracking-art-dot dot-two"></span>
          </div>
        </section>

        <section className="tracking-panel">
          <div className="tracking-panel-heading">
            <div className="tracking-panel-icon"><Search size={20} /></div>
            <div>
              <h2>Localizar meu pedido</h2>
              <p>Informe os mesmos dados utilizados na compra ou abra um pedido diretamente pelo seu histórico quando estiver logado.</p>
            </div>
          </div>

          {!order && <form onSubmit={handleSearch} className="tracking-form">
            <label>
              <span>Número do pedido</span>
              <input
                type="text"
                value={orderId}
                onChange={(e) => setOrderId(e.target.value)}
                placeholder="Cole o número do seu pedido"
                className="tracking-input"
                required
              />
            </label>
            <label>
              <span>Telefone da compra</span>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="(92) 99999-9999"
                className="tracking-input"
                required
              />
            </label>
            {error && <p className="tracking-error">{error}</p>}
            <button type="submit" disabled={loading} className="tracking-submit">
              <Search size={18} /> {loading ? "Consultando pedido..." : "Consultar pedido"}
            </button>
          </form>}
          {loading && <p className="tracking-privacy">Carregando os detalhes do pedido...</p>}
          <p className="tracking-privacy"><ShieldCheck size={14} /> Seus dados são utilizados somente para localizar sua compra.</p>
        </section>

        {order && (
          <section className="tracking-result">
            <div className="tracking-result-top">
              <div>
                <span className="tracking-eyebrow">RESULTADO DA CONSULTA</span>
                <h2>Detalhes do pedido</h2>
                <p className="tracking-order-number">Pedido <strong>{order.order_id}</strong></p>
              </div>
              <span className="tracking-status-pill"><CheckCircle2 size={15} /> Pedido localizado</span>
            </div>

            <div className="tracking-status-grid">
              <article className="tracking-status-card">
                <span className="tracking-status-icon payment"><ShieldCheck size={19} /></span>
                <div><small>Pagamento</small><strong>{paymentLabel(order.payment_status)}</strong></div>
              </article>
              <article className="tracking-status-card">
                <span className="tracking-status-icon delivery"><Truck size={19} /></span>
                <div><small>Entrega</small><strong>{deliveryLabel(order.delivery_status)}</strong></div>
              </article>
            </div>

            <div className="tracking-timeline-block">
              <div className="tracking-section-title"><PackageCheck size={19} /><h3>Etapas do pedido</h3></div>
              <div className="tracking-timeline">
                {steps.map((step, index) => {
                  const complete = index <= currentStep;
                  return (
                    <div className={`tracking-timeline-step ${complete ? "is-complete" : ""} ${index === currentStep ? "is-current" : ""}`} key={step.title}>
                      <div className="tracking-timeline-marker">
                        {complete ? <CheckCircle2 size={19} /> : <span>{index + 1}</span>}
                      </div>
                      <div className="tracking-timeline-copy">
                        <strong>{step.title}</strong>
                        <p>{step.description}</p>
                        {step.date && <small><Clock3 size={12} /> {formatDate(step.date)}</small>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="tracking-extra-grid">
              <div className="tracking-extra-card">
                <CalendarDays size={18} />
                <div><small>Pedido aceito em</small><strong>{formatDate(order.created_at)}</strong></div>
              </div>
              <div className="tracking-extra-card">
                <Truck size={18} />
                <div><small>Enviado em</small><strong>{formatDate(order.shipped_at)}</strong></div>
              </div>
              <div className="tracking-extra-card">
                <PackageCheck size={18} />
                <div><small>Entregue em</small><strong>{formatDate(order.delivered_at)}</strong></div>
              </div>
              <div className="tracking-extra-card">
                <Truck size={18} />
                <div><small>Modalidade de entrega</small><strong>Motoboy / entrega própria</strong></div>
              </div>
              <div className="tracking-extra-card">
                <CalendarDays size={18} />
                <div><small>Previsão de entrega</small><strong>{formatDate(order.estimated_delivery_at)}</strong></div>
              </div>
            </div>

            <div className="tracking-code-box">
              <div><small>ENTREGA DA SUA COMPRA</small><strong>Entrega própria por motoboy</strong><p style={{ margin: "6px 0 0", fontSize: 13, opacity: 0.85 }}>Acompanhe as etapas do pedido nesta página. A previsão será atualizada pela loja quando necessário.</p></div>
              <Truck size={22} />
            </div>
          </section>
        )}

        <footer className="tracking-footer">
          <p>Precisa de ajuda? Estamos aqui para ajudar você.</p>
          <a href="/conta">← Voltar para minha conta</a>
          <span>© NOVASHOPP STORE · Sua compra acompanhada com cuidado.</span>
        </footer>
      </div>
    </main>
  );
}
