"use client";

import { useState } from "react";
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
    aguardando_separacao: "Aguardando separação",
    em_preparacao: "Em preparação",
    enviado: "Pedido enviado",
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
    { title: "Pedido recebido", description: "Seu pedido foi registrado", date: order?.created_at },
    { title: "Em preparação", description: "Estamos preparando seus produtos", date: null },
    { title: "Saiu para entrega", description: "Seu pedido está a caminho", date: order?.shipped_at },
    { title: "Pedido entregue", description: "Entrega concluída com sucesso", date: order?.delivered_at },
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
              <p>Informe os mesmos dados utilizados na compra.</p>
            </div>
          </div>

          <form onSubmit={handleSearch} className="tracking-form">
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
          </form>
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
                <div><small>Data do pedido</small><strong>{formatDate(order.created_at)}</strong></div>
              </div>
              <div className="tracking-extra-card">
                <Truck size={18} />
                <div><small>Data do envio</small><strong>{formatDate(order.shipped_at)}</strong></div>
              </div>
              <div className="tracking-extra-card">
                <PackageCheck size={18} />
                <div><small>Data da entrega</small><strong>{formatDate(order.delivered_at)}</strong></div>
              </div>
            </div>

            <div className="tracking-code-box">
              <div><small>CÓDIGO DE RASTREIO</small><strong>{order.tracking_code || "Ainda não disponível"}</strong></div>
              <Truck size={22} />
            </div>
          </section>
        )}

        <footer className="tracking-footer">
          <p>Precisa de ajuda? Estamos aqui para ajudar você.</p>
          <a href="/">← Voltar para a NOVASHOPP STORE</a>
          <span>© NOVASHOPP STORE · Sua compra acompanhada com cuidado.</span>
        </footer>
      </div>
    </main>
  );
}
