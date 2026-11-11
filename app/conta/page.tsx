"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type AccountUser = {
  email?: string;
  user_metadata?: { full_name?: string };
};

type CustomerOrder = {
  id: string;
  total: number;
  status: string;
  delivery_status: string | null;
  tracking_code: string | null;
  created_at: string;
  shipped_at: string | null;
  delivered_at: string | null;
  order_items: {
    product_name: string;
    quantity: number;
    unit_price: number;
    subtotal: number;
  }[];
};

function money(value: number) {
  return Number(value || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function paymentLabel(status: string) {
  const labels: Record<string, string> = {
    aguardando: "Aguardando pagamento",
    pendente: "Aguardando pagamento",
    pending: "Aguardando pagamento",
    pago: "Pagamento aprovado",
    aprovado: "Pagamento aprovado",
    approved: "Pagamento aprovado",
    cancelado: "Cancelado",
    cancelled: "Cancelado",
    canceled: "Cancelado",
  };
  return labels[(status || "").toLowerCase()] || status || "Não informado";
}

function deliveryLabel(status: string | null) {
  const labels: Record<string, string> = {
    aguardando_separacao: "Aguardando separação",
    em_preparacao: "Em preparação",
    enviado: "Enviado",
    entregue: "Entregue",
  };
  return status ? labels[status] || status.replaceAll("_", " ") : "Aguardando atualização";
}

function dateLabel(value: string) {
  return new Date(value).toLocaleString("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

export default function ContaClientePage() {
  const [user, setUser] = useState<AccountUser | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"login" | "register">("login");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [orders, setOrders] = useState<CustomerOrder[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [ordersError, setOrdersError] = useState("");

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setUser(data.session?.user ?? null));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) {
      setOrders([]);
      return;
    }

    let active = true;
    async function loadCustomerOrders() {
      setOrdersLoading(true);
      setOrdersError("");
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData.session?.access_token;
        if (!token) throw new Error("Sua sessão expirou. Entre novamente.");

        const response = await fetch("/api/conta/pedidos", {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Não foi possível carregar os pedidos.");
        if (active) setOrders((result.orders || []) as CustomerOrder[]);
      } catch (err) {
        if (active) setOrdersError(err instanceof Error ? err.message : "Erro ao consultar pedidos.");
      } finally {
        if (active) setOrdersLoading(false);
      }
    }

    loadCustomerOrders();
    return () => { active = false; };
  }, [user]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    setLoading(true);

    try {
      if (mode === "register") {
        const { data, error: authError } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { data: { full_name: name.trim() } },
        });

        if (authError) throw authError;
        if (data.session) {
          setMessage("Cadastro realizado! Sua conta já está ativa.");
        } else {
          setMessage("Cadastro iniciado! Confira seu e-mail para confirmar a conta e depois entre por aqui.");
        }
      } else {
        const { error: authError } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (authError) throw authError;
        setMessage("Login realizado com sucesso.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível concluir. Tente novamente.");
    } finally {
      setLoading(false);
    }
  }

  async function handleLogout() {
    setError("");
    const { error: authError } = await supabase.auth.signOut();
    if (authError) setError("Não foi possível sair da conta. Tente novamente.");
    else {
      setMessage("Você saiu da sua conta.");
      setOrders([]);
    }
  }

  return (
    <main className="customer-account-page">
      <section className="customer-account-card">
        <a className="customer-account-back" href="/">← Voltar para a NOVASHOPP STORE</a>
        <div className="customer-account-brand">N</div>
        <p className="customer-account-eyebrow">ÁREA DO CLIENTE</p>
        {user ? (
          <>
            <h1>Bem-vindo à sua conta!</h1>
            <p className="customer-account-intro">Acesse seus pedidos e acompanhe suas compras na NOVASHOPP STORE.</p>
            <div className="customer-account-profile">
              <span className="customer-account-avatar">👤</span>
              <div>
                <strong>{user.user_metadata?.full_name || "Cliente NOVASHOPP"}</strong>
                <p>{user.email}</p>
              </div>
            </div>

            <div className="customer-orders-heading">
              <div>
                <span className="customer-account-eyebrow">SUAS COMPRAS</span>
                <h2>Histórico de pedidos</h2>
              </div>
              <span className="customer-orders-count">{orders.length}</span>
            </div>

            {ordersLoading && <p className="customer-orders-feedback">Carregando seus pedidos...</p>}
            {!ordersLoading && ordersError && <p className="customer-account-error">{ordersError}</p>}
            {!ordersLoading && !ordersError && orders.length === 0 && (
              <div className="customer-orders-empty">
                <span>🛍️</span>
                <strong>Nenhum pedido vinculado ainda</strong>
                <p>As compras feitas com este mesmo endereço de e-mail aparecerão aqui.</p>
              </div>
            )}

            <div className="customer-orders-list">
              {orders.map((order) => (
                <article className="customer-order-card" key={order.id}>
                  <div className="customer-order-top">
                    <div>
                      <small>PEDIDO</small>
                      <strong className="customer-order-id">{order.id}</strong>
                    </div>
                    <strong className="customer-order-total">{money(order.total)}</strong>
                  </div>
                  <p className="customer-order-date">Realizado em {dateLabel(order.created_at)}</p>
                  <div className="customer-order-statuses">
                    <span><small>Pagamento</small><b>{paymentLabel(order.status)}</b></span>
                    <span><small>Entrega</small><b>{deliveryLabel(order.delivery_status)}</b></span>
                  </div>
                  <div className="customer-order-items">
                    <strong>Produtos</strong>
                    {order.order_items?.map((item, index) => (
                      <div key={index}>
                        <span>{item.product_name} × {item.quantity}</span>
                        <b>{money(item.subtotal)}</b>
                      </div>
                    ))}
                  </div>
                  {order.tracking_code && (
                    <p className="customer-order-tracking">Rastreio: <strong>{order.tracking_code}</strong></p>
                  )}
                  <a className="customer-order-track-link" href="/acompanhar">Acompanhar entrega</a>
                </article>
              ))}
            </div>

            <button className="customer-account-submit" type="button" onClick={handleLogout}>Sair da conta</button>
            {message && <p className="customer-account-success">{message}</p>}
            {error && <p className="customer-account-error">{error}</p>}
          </>
        ) : (
          <>
            <h1>{mode === "login" ? "Entre na sua conta" : "Crie sua conta"}</h1>
            <p className="customer-account-intro">
              {mode === "login" ? "Acesse sua área exclusiva de cliente." : "Cadastre-se para ter sua conta na NOVASHOPP STORE."}
            </p>
            <div className="customer-account-tabs">
              <button type="button" className={mode === "login" ? "active" : ""} onClick={() => { setMode("login"); setError(""); setMessage(""); }}>Entrar</button>
              <button type="button" className={mode === "register" ? "active" : ""} onClick={() => { setMode("register"); setError(""); setMessage(""); }}>Criar conta</button>
            </div>
            <form onSubmit={handleSubmit} className="customer-account-form">
              {mode === "register" && (
                <label>Nome completo
                  <input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" required placeholder="Seu nome" />
                </label>
              )}
              <label>E-mail
                <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required placeholder="voce@email.com" />
              </label>
              <label>Senha
                <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={mode === "login" ? "current-password" : "new-password"} minLength={8} required placeholder="Mínimo de 8 caracteres" />
              </label>
              <button className="customer-account-submit" type="submit" disabled={loading}>
                {loading ? "Aguarde..." : mode === "login" ? "Entrar na minha conta" : "Criar minha conta"}
              </button>
            </form>
            {message && <p className="customer-account-success">{message}</p>}
            {error && <p className="customer-account-error">{error}</p>}
            <p className="customer-account-footnote">Seus dados de acesso são protegidos pelo sistema de autenticação da loja.</p>
          </>
        )}
      </section>
    </main>
  );
}
