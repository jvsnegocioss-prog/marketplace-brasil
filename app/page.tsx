"use client";

import { useEffect, useState } from "react";
import {
  Search, ShoppingCart, Menu, X, Heart, Star,
  Truck, ShieldCheck, CreditCard, Plus, Minus,
  ArrowRight, Smartphone, Watch, Headphones,
  Gamepad2, House, Shirt, Package
} from "lucide-react";
import { supabase } from "@/lib/supabase";

type Product = {
  id: string;
  name: string;
  description: string | null;
  price: number;
  stock: number;
  category: string | null;
  image_url: string | null;
  active: boolean;
};

type CartItem = {
  id: string;
  qty: number;
};

const baseCategories = [
  { name: "Todos", icon: Package },
  { name: "Eletrônicos", icon: Smartphone },
  { name: "Acessórios", icon: Watch },
  { name: "Casa", icon: House },
  { name: "Moda", icon: Shirt },
  { name: "Games", icon: Gamepad2 },
  { name: "Segurança eletrônica", icon: ShieldCheck },
];

const money = (value: number) =>
  Number(value).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });

export default function Home() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("Todos");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [favoriteIds, setFavoriteIds] = useState<string[]>([]);
  const [favoritesReady, setFavoritesReady] = useState(false);
  const [showFavorites, setShowFavorites] = useState(false);
  const [customerAvatarUrl, setCustomerAvatarUrl] = useState("");

  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [customerName, setCustomerName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [checkoutMessage, setCheckoutMessage] = useState("");

  async function loadProducts() {
    setLoading(true);
    setError("");

    const { data, error } = await supabase
      .from("products")
      .select("id,name,description,price,stock,category,image_url,active")
      .eq("active", true)
      .order("created_at", { ascending: false });

    if (error) {
      setError("Não foi possível carregar os produtos. " + error.message);
      setProducts([]);
    } else {
      setProducts((data || []) as Product[]);
    }

    setLoading(false);
  }

  useEffect(() => {
    loadProducts();

    // Se o cliente já estiver autenticado, aproveita os dados da conta no checkout.
    supabase.auth.getSession().then(({ data }) => {
      const accountUser = data.session?.user;
      setCustomerAvatarUrl(typeof accountUser?.user_metadata?.avatar_url === "string" ? accountUser.user_metadata.avatar_url : "");
      if (!accountUser) return;

      const accountName =
        typeof accountUser.user_metadata?.full_name === "string"
          ? accountUser.user_metadata.full_name
          : "";

      const metadata = accountUser.user_metadata || {};
      const savedAddress = [
        metadata.street,
        metadata.number,
        metadata.complement,
        metadata.neighborhood,
        [metadata.city, metadata.state].filter(Boolean).join(" - "),
        metadata.postal_code ? "CEP " + metadata.postal_code : "",
        metadata.reference ? "Referência: " + metadata.reference : "",
      ].filter(Boolean).join(", ");

      setCustomerName((current) => current || accountName);
      setCustomerEmail((current) => current || accountUser.email || "");
      setCustomerPhone((current) => current || (typeof metadata.phone === "string" ? metadata.phone : ""));
      setDeliveryAddress((current) => current || savedAddress);
    });

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      const metadata = session?.user?.user_metadata;
      setCustomerAvatarUrl(typeof metadata?.avatar_url === "string" ? metadata.avatar_url : "");
    });
    return () => authListener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("novashopp_favorites");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) setFavoriteIds(parsed.filter((id): id is string => typeof id === "string"));
      }
    } catch (error) {
      console.error("Não foi possível carregar favoritos:", error);
    } finally {
      setFavoritesReady(true);
    }
  }, []);

  useEffect(() => {
    if (favoritesReady) {
      localStorage.setItem("novashopp_favorites", JSON.stringify(favoriteIds));
    }
  }, [favoriteIds, favoritesReady]);

  const categories = [
    ...baseCategories,
    ...Array.from(
      new Set(
        products
          .map((p) => p.category?.trim())
          .filter((c): c is string => Boolean(c))
      )
    )
      .filter((name) => !baseCategories.some((c) => c.name === name))
      .map((name) => ({ name, icon: Package })),
  ];

  const filtered = products.filter((p) =>
    (!showFavorites || favoriteIds.includes(p.id)) &&
    (category === "Todos" || p.category === category) &&
    (p.name.toLowerCase().includes(search.toLowerCase()) ||
      (p.description || "").toLowerCase().includes(search.toLowerCase()))
  );

  const toggleFavorite = (id: string) => {
    setFavoriteIds((old) =>
      old.includes(id) ? old.filter((item) => item !== id) : [...old, id]
    );
  };

  const addToCart = (id: string) => {
    const product = products.find((p) => p.id === id);
    if (!product || product.stock <= 0) return;

    setCart((old) => {
      const found = old.find((item) => item.id === id);

      if (found) {
        if (found.qty >= product.stock) return old;

        return old.map((item) =>
          item.id === id ? { ...item, qty: item.qty + 1 } : item
        );
      }

      return [...old, { id, qty: 1 }];
    });

    setCartOpen(true);
  };

  const changeQty = (id: string, amount: number) => {
    const product = products.find((p) => p.id === id);
    if (!product) return;

    setCart((old) =>
      old
        .map((item) =>
          item.id === id
            ? {
                ...item,
                qty: Math.min(product.stock, item.qty + amount),
              }
            : item
        )
        .filter((item) => item.qty > 0)
    );
  };

  const submitOrder = async () => {
    if (cart.length === 0 || submitting) return;

    setSubmitting(true);
    setCheckoutMessage("");

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;

      const response = await fetch("/api/checkout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify({
          customerName,
          customerEmail,
          customerPhone,
          deliveryAddress,
          items: cart.map((item) => ({
            id: item.id,
            qty: item.qty,
          })),
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        setCheckoutMessage(
          result.error || "Não foi possível iniciar o pagamento."
        );
        return;
      }

      if (
        !result.checkoutUrl ||
        typeof result.checkoutUrl !== "string"
      ) {
        setCheckoutMessage(
          "O pagamento foi solicitado, mas o endereço de pagamento não foi recebido."
        );
        return;
      }

      window.location.href = result.checkoutUrl;
    } catch (error) {
      console.error("Erro ao iniciar checkout:", error);

      setCheckoutMessage(
        "Não foi possível conectar ao pagamento. Verifique sua conexão e tente novamente."
      );
    } finally {
      setSubmitting(false);
    }
  };

  const totalItems = cart.reduce((sum, item) => sum + item.qty, 0);

  const total = cart.reduce((sum, item) => {
    const product = products.find((p) => p.id === item.id);
    return sum + (product ? Number(product.price) * item.qty : 0);
  }, 0);

  return (
    <main>
      <div className="topbar">
        <span>Mais variedade. Mais ofertas. Mais para você!</span>
        <span>Compre fácil, receba rápido!</span>
      </div>

      <header className="header">
        <button
          className="icon-btn mobile-menu"
          onClick={() => setMenuOpen(!menuOpen)}
        >
          <Menu size={25} />
        </button>

        <a href="#" className="logo">
          <span className="logo-icon">N</span>
          <span className="brand-name">NovaShopp<span className="logo-dot">.</span><small>STORE</small></span>
        </a>

        <div className="search-box">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="O que você está procurando?"
          />
          <button aria-label="Pesquisar">
            <Search size={21} />
          </button>
        </div>

        <div className="header-actions">
          <a className="customer-account-link" href="/conta" aria-label="Minha conta">
            {customerAvatarUrl ? (
              <img className="customer-account-link-avatar" src={customerAvatarUrl} alt="" />
            ) : (
              <span className="customer-account-link-placeholder" aria-hidden="true">👤</span>
            )}
            <span>Minha conta</span>
          </a>
          <button
            className={`icon-btn favorite-btn ${showFavorites ? "favorite-active" : ""}`}
            aria-label={showFavorites ? "Mostrar todos os produtos" : "Ver favoritos"}
            aria-pressed={showFavorites}
            onClick={() => {
              setShowFavorites((old) => !old);
              document.getElementById("produtos")?.scrollIntoView({ behavior: "smooth" });
            }}
          >
            <Heart size={23} fill={showFavorites ? "currentColor" : "none"} />
            {favoriteIds.length > 0 && <span className="favorite-count">{favoriteIds.length}</span>}
          </button>

          <button
            className="cart-button"
            onClick={() => setCartOpen(true)}
          >
            <ShoppingCart size={23} />
            <span className="cart-label">Carrinho</span>
            {totalItems > 0 && (
              <span className="cart-count">{totalItems}</span>
            )}
          </button>
        </div>
      </header>

      <nav className={`navigation ${menuOpen ? "nav-open" : ""}`}>
        {categories.map((item) => (
          <button
            key={item.name}
            className={category === item.name ? "nav-active" : ""}
            onClick={() => {
              setCategory(item.name);
              setMenuOpen(false);
            }}
          >
            {item.name}
          </button>
        ))}
      </nav>

      <section className="hero">
        <div className="hero-content">
          <span className="hero-label">NOVASHOPP STORE • COMPRE FÁCIL, RECEBA RÁPIDO</span>
          <h1>Tudo o que você precisa, <em>em um só lugar!</em></h1>
          <p>
            Mais variedade, mais ofertas e praticidade para suas compras.
            Encontre tecnologia, casa, moda e muito mais.
          </p>
          <button
            className="hero-button"
            onClick={() =>
              document.getElementById("produtos")?.scrollIntoView({
                behavior: "smooth",
              })
            }
          >
            Comprar agora <ArrowRight size={18} />
          </button>
        </div>

        <div className="hero-art">
          <div className="hero-circle">
            <ShoppingCart size={110} strokeWidth={1.2} />
            <span>OFERTAS</span>
          </div>
          <div className="floating-card">Confira nossos produtos</div>
        </div>
      </section>

      <section className="benefits">
        <div>
          <Truck />
          <span>
            <strong>Entrega facilitada</strong>
            <small>Comodidade para você</small>
          </span>
        </div>
        <div>
          <ShieldCheck />
          <span>
            <strong>Compra segura</strong>
            <small>Mais tranquilidade</small>
          </span>
        </div>
        <div>
          <CreditCard />
          <span>
            <strong>Pagamento prático</strong>
            <small>Opções para comprar</small>
          </span>
        </div>
        <div>
          <Star />
          <span>
            <strong>Ofertas especiais</strong>
            <small>Preços especiais</small>
          </span>
        </div>
      </section>

      {/* ACOMPANHAMENTO DE PEDIDOS */}
      <section
        style={{
          maxWidth: 1100,
          margin: "30px auto",
          padding: "24px 20px",
          background: "#f1f5f9",
          borderRadius: 14,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 20,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div
            style={{
              background: "#dbeafe",
              color: "#1d4ed8",
              padding: 13,
              borderRadius: 12,
            }}
          >
            <Package size={30} />
          </div>

          <div>
            <h2 style={{ fontSize: 20, fontWeight: 700, color: "#111827" }}>
              Acompanhe seu pedido
            </h2>
            <p style={{ fontSize: 14, color: "#4b5563", marginTop: 4 }}>
              Consulte o pagamento e veja o andamento da sua entrega.
            </p>
          </div>
        </div>

        <a
          href="/acompanhar"
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 9,
            padding: "13px 20px",
            background: "#2563eb",
            color: "#ffffff",
            borderRadius: 9,
            fontWeight: 700,
            textDecoration: "none",
          }}
        >
          Acompanhar meu pedido
          <ArrowRight size={18} />
        </a>
      </section>

      <section className="categories-section">
        <div className="section-heading">
          <div>
            <span className="eyebrow">EXPLORE A LOJA</span>
            <h2>Compre por categoria</h2>
          </div>
        </div>

        <div className="category-grid">
          {categories.slice(1).map((item) => {
            const Icon = item.icon;

            return (
              <button
                key={item.name}
                className="category-card"
                onClick={() => {
                  setCategory(item.name);
                  document.getElementById("produtos")?.scrollIntoView({
                    behavior: "smooth",
                  });
                }}
              >
                <Icon size={29} />
                <strong>{item.name}</strong>
                <ArrowRight size={16} />
              </button>
            );
          })}
        </div>
      </section>

      <section className="products-section" id="produtos">
        <div className="section-heading">
          <div>
            <span className="eyebrow">SELEÇÃO ESPECIAL</span>
            <h2>Produtos em destaque</h2>
          </div>
          <span className="product-count">
            {filtered.length} produtos
          </span>
        </div>

        <div className="filter-row">
          {categories.map((item) => (
            <button
              key={item.name}
              className={category === item.name ? "filter-active" : ""}
              onClick={() => setCategory(item.name)}
            >
              {item.name}
            </button>
          ))}
        </div>

        {loading ? (
          <p className="empty-message">Carregando produtos da loja...</p>
        ) : error ? (
          <div className="empty-message">
            <p>{error}</p>
            <button onClick={loadProducts}>Tentar novamente</button>
          </div>
        ) : filtered.length === 0 ? (
          <p className="empty-message">
            {showFavorites
              ? "Você ainda não salvou produtos favoritos. Toque no coração de um produto para adicioná-lo."
              : "Nenhum produto encontrado. Tente outra pesquisa ou categoria."}
          </p>
        ) : (
          <div className="product-grid">
            {filtered.map((product) => (
              <article className="product-card" key={product.id}>
                <div className="product-image">
                  {product.stock <= 0 && (
                    <span className="product-tag">Esgotado</span>
                  )}

                  <button
                    className={`heart-button ${favoriteIds.includes(product.id) ? "is-favorite" : ""}`}
                    aria-label={favoriteIds.includes(product.id) ? "Remover dos favoritos" : "Adicionar aos favoritos"}
                    aria-pressed={favoriteIds.includes(product.id)}
                    onClick={() => toggleFavorite(product.id)}
                  >
                    <Heart size={19} fill={favoriteIds.includes(product.id) ? "currentColor" : "none"} />
                  </button>

                  {product.image_url ? (
                    <a
                      href={`/produto/${product.id}`}
                      aria-label={`Ver detalhes e avaliações de ${product.name}`}
                      style={{ display: "block", width: "100%", height: "100%" }}
                    >
                      <img
                        src={product.image_url}
                        alt={product.name}
                        className="product-photo"
                      />
                    </a>
                  ) : (
                    <div className="product-art">
                      <Package size={76} strokeWidth={1.2} />
                    </div>
                  )}
                </div>

                <div className="product-info">
                  <span className="product-category">
                    {product.category || "Geral"}
                  </span>

                  <h3>{product.name}</h3>

                  {product.description && (
                    <p className="product-description">
                      {product.description}
                    </p>
                  )}

                  <a
                    href={`/produto/${product.id}`}
                    className="mb-3 inline-block text-sm font-semibold text-blue-700 hover:underline"
                  >
                    Ver detalhes e avaliações
                  </a>

                  <strong className="price">
                    {money(product.price)}
                  </strong>

                  <small className="installments">
                    {product.stock > 0
                      ? `${product.stock} unidade(s) disponíveis`
                      : "Produto indisponível"}
                  </small>

                  <button
                    className="add-button"
                    disabled={product.stock <= 0}
                    onClick={() => addToCart(product.id)}
                  >
                    <ShoppingCart size={17} />
                    {product.stock > 0
                      ? "Adicionar ao carrinho"
                      : "Esgotado"}
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="newsletter">
        <div>
          <span className="eyebrow">NOVIDADES E OFERTAS</span>
          <h2>Fique por dentro das novidades!</h2>
          <p>Acompanhe nossa loja e não perca oportunidades.</p>
        </div>

        <button
          onClick={() =>
            window.scrollTo({ top: 0, behavior: "smooth" })
          }
        >
          Explorar produtos <ArrowRight size={18} />
        </button>
      </section>

      <footer className="footer">
        <div className="footer-logo">
          <span className="logo-icon">N</span>
          <span className="brand-name">NovaShopp<span className="logo-dot">.</span><small>STORE</small></span>
        </div>
        <p>Tudo o que você precisa, em um só lugar!</p>

        {/* LINK DE ACOMPANHAMENTO NO RODAPÉ */}
        <div style={{ margin: "18px 0" }}>
          <a
            href="/acompanhar"
            style={{
              color: "#ffffff",
              textDecoration: "underline",
              fontWeight: 600,
            }}
          >
            Acompanhar meu pedido
          </a>
        </div>

        <div className="footer-bottom">
          © 2026 NovaShopp Store. Todos os direitos reservados.
        </div>
      </footer>

      {cartOpen && (
        <div
          className="cart-overlay"
          onClick={() => {
            setCartOpen(false);
            setCheckoutOpen(false);
          }}
        >
          <aside
            className="cart-drawer"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="cart-heading">
              <h2>
                {checkoutOpen
                  ? "Finalizar pedido"
                  : `Meu carrinho (${totalItems})`}
              </h2>
              <button
                className="icon-btn"
                onClick={() => {
                  setCartOpen(false);
                  setCheckoutOpen(false);
                }}
              >
                <X />
              </button>
            </div>

            {cart.length === 0 ? (
              <div className="empty-cart">
                <ShoppingCart size={45} />
                <p>Seu carrinho está vazio.</p>
                <button onClick={() => setCartOpen(false)}>
                  Continuar comprando
                </button>
              </div>
            ) : (
              <>
                {!checkoutOpen ? (
                  <>
                    <div className="cart-items">
                      {cart.map((item) => {
                        const product = products.find(
                          (p) => p.id === item.id
                        );

                        if (!product) return null;

                        return (
                          <div className="cart-item" key={item.id}>
                            <div className="cart-product-icon">
                              {product.image_url ? (
                                <img
                                  src={product.image_url}
                                  alt={product.name}
                                  style={{
                                    width: "100%",
                                    height: "100%",
                                    objectFit: "contain",
                                  }}
                                />
                              ) : (
                                <Package size={28} />
                              )}
                            </div>

                            <div className="cart-product-info">
                              <strong>{product.name}</strong>
                              <span>{money(product.price)}</span>

                              <div className="quantity">
                                <button
                                  onClick={() => changeQty(item.id, -1)}
                                >
                                  <Minus size={14} />
                                </button>
                                {item.qty}
                                <button
                                  disabled={item.qty >= product.stock}
                                  onClick={() => changeQty(item.id, 1)}
                                >
                                  <Plus size={14} />
                                </button>
                              </div>
                            </div>

                            <strong>
                              {money(Number(product.price) * item.qty)}
                            </strong>
                          </div>
                        );
                      })}
                    </div>

                    <div className="cart-total">
                      <span>Total</span>
                      <strong>{money(total)}</strong>
                    </div>

                    <button
                      className="checkout-button"
                      onClick={() => {
                        setCheckoutMessage("");
                        setCheckoutOpen(true);
                      }}
                    >
                      Finalizar compra
                    </button>

                    <p className="cart-note">
                      Você será encaminhado ao ambiente seguro de pagamento.
                    </p>
                  </>
                ) : (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void submitOrder();
                    }}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 12,
                      paddingTop: 16,
                    }}
                  >
                    <p style={{ fontSize: 14, color: "#666" }}>
                      Informe seus dados para continuar com o pagamento.
                      {customerEmail && (
                        <span style={{ display: "block", marginTop: 5, color: "#176044", fontWeight: 600 }}>
                          { "Conta identificada: " + customerEmail }
                        </span>
                      )}
                    </p>

                    <label style={{ fontSize: 14, fontWeight: 600 }}>
                      Nome completo *
                      <input
                        required
                        value={customerName}
                        onChange={(e) => setCustomerName(e.target.value)}
                        placeholder="Seu nome completo"
                        style={{
                          display: "block",
                          width: "100%",
                          padding: 12,
                          marginTop: 6,
                          border: "1px solid #ccc",
                          borderRadius: 8,
                          fontSize: 15,
                        }}
                      />
                    </label>

                    <label style={{ fontSize: 14, fontWeight: 600 }}>
                      E-mail
                      <input
                        type="email"
                        value={customerEmail}
                        onChange={(e) => setCustomerEmail(e.target.value)}
                        placeholder="seuemail@exemplo.com"
                        style={{
                          display: "block",
                          width: "100%",
                          padding: 12,
                          marginTop: 6,
                          border: "1px solid #ccc",
                          borderRadius: 8,
                          fontSize: 15,
                        }}
                      />
                    </label>

                    <label style={{ fontSize: 14, fontWeight: 600 }}>
                      Telefone / WhatsApp *
                      <input
                        required
                        type="tel"
                        value={customerPhone}
                        onChange={(e) => setCustomerPhone(e.target.value)}
                        placeholder="(92) 99999-9999"
                        style={{
                          display: "block",
                          width: "100%",
                          padding: 12,
                          marginTop: 6,
                          border: "1px solid #ccc",
                          borderRadius: 8,
                          fontSize: 15,
                        }}
                      />
                    </label>

                    <label style={{ fontSize: 14, fontWeight: 600 }}>
                      Endereço completo de entrega *
                      <textarea
                        required
                        value={deliveryAddress}
                        onChange={(e) => setDeliveryAddress(e.target.value)}
                        placeholder="Rua, número, bairro, cidade e ponto de referência"
                        rows={3}
                        style={{
                          display: "block",
                          width: "100%",
                          padding: 12,
                          marginTop: 6,
                          border: "1px solid #ccc",
                          borderRadius: 8,
                          fontSize: 15,
                          resize: "vertical",
                        }}
                      />
                    </label>

                    <div className="cart-total">
                      <span>Total do pedido</span>
                      <strong>{money(total)}</strong>
                    </div>

                    {checkoutMessage && (
                      <p
                        role="alert"
                        style={{
                          color: "#b42318",
                          fontSize: 13,
                          overflowWrap: "anywhere",
                        }}
                      >
                        {checkoutMessage}
                      </p>
                    )}

                    <button
                      type="submit"
                      className="checkout-button"
                      disabled={submitting}
                    >
                      {submitting
                        ? "Conectando ao pagamento..."
                        : "Ir para pagamento"}
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setCheckoutOpen(false);
                        setCheckoutMessage("");
                      }}
                      disabled={submitting}
                      style={{
                        padding: 12,
                        border: "1px solid #ccc",
                        borderRadius: 8,
                        background: "#fff",
                        cursor: "pointer",
                      }}
                    >
                      Voltar ao carrinho
                    </button>

                    <p className="cart-note">
                      O pagamento será realizado no ambiente do Mercado Pago.
                    </p>
                  </form>
                )}
              </>
            )}
          </aside>
        </div>
      )}
    </main>
  );
}
