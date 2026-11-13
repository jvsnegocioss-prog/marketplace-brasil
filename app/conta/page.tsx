"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type AccountUser = {
  email?: string;
  user_metadata?: {
    full_name?: string;
    phone?: string;
    postal_code?: string;
    state?: string;
    city?: string;
    neighborhood?: string;
    street?: string;
    number?: string;
    complement?: string;
    reference?: string;
    avatar_url?: string;
  };
};

type CustomerOrder = {
  id: string;
  order_number: string;
  total: number;
  coupon_code: string | null;
  discount_amount: number;
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
  const [profileName, setProfileName] = useState("");
  const [profilePhone, setProfilePhone] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [addressState, setAddressState] = useState("");
  const [city, setCity] = useState("");
  const [neighborhood, setNeighborhood] = useState("");
  const [street, setStreet] = useState("");
  const [addressNumber, setAddressNumber] = useState("");
  const [complement, setComplement] = useState("");
  const [reference, setReference] = useState("");
  const [editingProfile, setEditingProfile] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState("");
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
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
    const metadata = user?.user_metadata;
    setProfileName(metadata?.full_name || "");
    setProfilePhone(metadata?.phone || "");
    setPostalCode(metadata?.postal_code || "");
    setAddressState(metadata?.state || "");
    setCity(metadata?.city || "");
    setNeighborhood(metadata?.neighborhood || "");
    setStreet(metadata?.street || "");
    setAddressNumber(metadata?.number || "");
    setComplement(metadata?.complement || "");
    setReference(metadata?.reference || "");
    setAvatarUrl(metadata?.avatar_url || "");
  }, [user]);

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
        const responseText = await response.text();
        let result: { orders?: CustomerOrder[]; error?: string } = {};
        try {
          result = responseText ? JSON.parse(responseText) : {};
        } catch {
          console.error("RESPOSTA INVÁLIDA AO CARREGAR PEDIDOS:", {
            status: response.status,
            contentType: response.headers.get("content-type"),
            preview: responseText.slice(0, 300),
          });
          throw new Error(
            `A consulta de pedidos retornou uma resposta inválida (HTTP ${response.status}). Atualize a página; se persistir, informe este código ao suporte.`
          );
        }
        if (!response.ok) throw new Error(result.error || `Não foi possível carregar os pedidos (HTTP ${response.status}).`);
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

  async function handleSaveProfile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanName = profileName.trim();
    if (cleanName.length < 3) {
      setError("Informe seu nome completo para continuar.");
      return;
    }
    if (!profilePhone.trim() || !postalCode.trim() || !addressState.trim() ||
        !city.trim() || !neighborhood.trim() || !street.trim() || !addressNumber.trim()) {
      setError("Preencha telefone e todos os campos obrigatórios do endereço.");
      return;
    }

    setError("");
    setMessage("");
    setSavingProfile(true);
    try {
      const { data, error: updateError } = await supabase.auth.updateUser({
        data: {
          full_name: cleanName,
          phone: profilePhone.trim(),
          postal_code: postalCode.trim(),
          state: addressState.trim(),
          city: city.trim(),
          neighborhood: neighborhood.trim(),
          street: street.trim(),
          number: addressNumber.trim(),
          complement: complement.trim(),
          reference: reference.trim(),
        },
      });
      if (updateError) throw updateError;
      if (data.user) setUser(data.user);
      setProfileName(cleanName);
      setEditingProfile(false);
      setMessage("Seus dados foram atualizados. Nome, telefone e endereço serão preenchidos nos próximos checkouts.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível atualizar seu nome.");
    } finally {
      setSavingProfile(false);
    }
  }

  async function handleAvatarChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !user) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setError("Escolha uma imagem JPG, PNG ou WEBP.");
      return;
    }
    if (file.size > 3 * 1024 * 1024) {
      setError("A foto deve ter no máximo 3 MB.");
      return;
    }

    setError("");
    setMessage("");
    setUploadingAvatar(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const userId = sessionData.session?.user.id;
      if (!userId) throw new Error("Entre novamente na sua conta.");
      const { error: uploadError } = await supabase.storage
        .from("avatars")
        .upload(`${userId}/avatar`, file, {
          upsert: true,
          contentType: file.type,
          cacheControl: "3600",
        });
      if (uploadError) throw uploadError;

      const { data: publicData } = supabase.storage
        .from("avatars")
        .getPublicUrl(`${userId}/avatar`);
      const { data, error: updateError } = await supabase.auth.updateUser({
        data: { avatar_url: publicData.publicUrl },
      });
      if (updateError) throw updateError;
      if (data.user) setUser(data.user);
      setAvatarUrl(publicData.publicUrl);
      setMessage("Foto de perfil atualizada com sucesso.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível atualizar a foto.");
    } finally {
      setUploadingAvatar(false);
    }
  }

  async function handleRemoveAvatar() {
    if (!user) return;
    setError("");
    setMessage("");
    setUploadingAvatar(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const userId = sessionData.session?.user.id;
      if (!userId) throw new Error("Entre novamente na sua conta.");
      const { error: removeError } = await supabase.storage
        .from("avatars")
        .remove([`${userId}/avatar`]);
      if (removeError) throw removeError;
      const { data, error: updateError } = await supabase.auth.updateUser({
        data: { avatar_url: null },
      });
      if (updateError) throw updateError;
      if (data.user) setUser(data.user);
      setAvatarUrl("");
      setMessage("Foto removida. Seu perfil voltou ao avatar padrão.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível remover a foto.");
    } finally {
      setUploadingAvatar(false);
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
        <a className="detail-back-link" href="/">← Voltar para a NOVASHOPP STORE</a>
        <div className="customer-account-brand">N</div>
        <p className="customer-account-eyebrow">ÁREA DO CLIENTE</p>
        {user ? (
          <>
            <h1>Bem-vindo à sua conta!</h1>
            <p className="customer-account-intro">Acesse seus pedidos e acompanhe suas compras na NOVASHOPP STORE.</p>
            <div className="customer-account-layout">
              <div className="customer-account-details">
            <div className="customer-account-profile">
              {avatarUrl ? (
                <img
                  src={avatarUrl}
                  alt="Foto do perfil"
                  className="customer-account-avatar customer-account-avatar-image"
                />
              ) : (
                <span className="customer-account-avatar">👤</span>
              )}
              <div>
                <strong>{user.user_metadata?.full_name || "Cliente NOVASHOPP"}</strong>
                <p>{user.email}</p>
              </div>
            </div>
            <div className="customer-avatar-actions">
              <label className="customer-avatar-upload">
                {uploadingAvatar ? "Enviando foto..." : avatarUrl ? "Trocar foto" : "Adicionar foto"}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={handleAvatarChange}
                  disabled={uploadingAvatar}
                />
              </label>
              {avatarUrl && (
                <button type="button" className="customer-avatar-remove" onClick={handleRemoveAvatar} disabled={uploadingAvatar}>
                  Remover foto
                </button>
              )}
              <small>JPG, PNG ou WEBP • até 3 MB</small>
            </div>

            {!editingProfile ? (
              <button
                type="button"
                className="customer-account-submit customer-account-edit"
                style={{ marginTop: 12, marginBottom: 18 }}
                onClick={() => {
                  setProfileName(user.user_metadata?.full_name || "");
                  setEditingProfile(true);
                  setError("");
                  setMessage("");
                }}
              >
                Editar meus dados
              </button>
            ) : (
              <form onSubmit={handleSaveProfile} className="customer-account-form" style={{ marginTop: 14, marginBottom: 20 }}>
                <label>Nome completo *
                  <input value={profileName} onChange={(event) => setProfileName(event.target.value)} autoComplete="name" minLength={3} required placeholder="Digite seu nome completo" />
                </label>
                <label>Telefone / WhatsApp *
                  <input value={profilePhone} onChange={(event) => setProfilePhone(event.target.value)} autoComplete="tel" type="tel" required placeholder="(92) 99999-9999" />
                </label>
                <label>CEP *
                  <input value={postalCode} onChange={(event) => setPostalCode(event.target.value)} autoComplete="postal-code" required placeholder="00000-000" />
                </label>
                <label>Estado (UF) *
                  <input value={addressState} onChange={(event) => setAddressState(event.target.value.toUpperCase())} autoComplete="address-level1" maxLength={2} required placeholder="AM" />
                </label>
                <label>Cidade *
                  <input value={city} onChange={(event) => setCity(event.target.value)} autoComplete="address-level2" required placeholder="Sua cidade" />
                </label>
                <label>Bairro *
                  <input value={neighborhood} onChange={(event) => setNeighborhood(event.target.value)} required placeholder="Seu bairro" />
                </label>
                <label>Rua / Avenida *
                  <input value={street} onChange={(event) => setStreet(event.target.value)} autoComplete="street-address" required placeholder="Nome da rua ou avenida" />
                </label>
                <label>Número *
                  <input value={addressNumber} onChange={(event) => setAddressNumber(event.target.value)} required placeholder="Número" />
                </label>
                <label>Complemento
                  <input value={complement} onChange={(event) => setComplement(event.target.value)} placeholder="Apartamento, bloco, casa..." />
                </label>
                <label>Ponto de referência
                  <input value={reference} onChange={(event) => setReference(event.target.value)} placeholder="Próximo a..." />
                </label>
                <p className="customer-account-footnote">Esses dados serão salvos no seu perfil e usados para preencher seus próximos pedidos. Você poderá alterá-los quando precisar.</p>
                <button className="customer-account-submit" type="submit" disabled={savingProfile}>
                  {savingProfile ? "Salvando..." : "Salvar meus dados"}
                </button>
                <button
                  type="button"
                  onClick={() => { setEditingProfile(false); setError(""); }}
                  style={{ width: "100%", padding: 12, borderRadius: 12, border: "1px solid #d7deea", background: "#fff", color: "#24324a", fontWeight: 700 }}
                >
                  Cancelar
                </button>
              </form>
            )}

              </div>
              <div className="customer-account-orders-panel">
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
                      <strong className="customer-order-id">{order.order_number}</strong>
                    </div>
                    <strong className="customer-order-total">{money(order.total)}</strong>
                  </div>
                  <p className="customer-order-date">Realizado em {dateLabel(order.created_at)}</p>
                  {Number(order.discount_amount || 0) > 0 && (
                    <div className="customer-order-coupon" style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 8, padding: "10px 12px", margin: "10px 0", borderRadius: 10, background: "#fff8db", color: "#674b00", fontSize: 13 }}>
                      <span>🎟️ Cupom {order.coupon_code || "aplicado"}</span>
                      <strong>Você economizou {money(order.discount_amount)}</strong>
                    </div>
                  )}
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
                  <a className="customer-order-track-link" href={`/acompanhar?pedido=${encodeURIComponent(order.id)}`}>Ver detalhes e acompanhar</a>
                </article>
              ))}
            </div>
              </div>
            </div>

            <button className="customer-account-submit customer-account-logout" type="button" onClick={handleLogout}>Sair da conta</button>
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
