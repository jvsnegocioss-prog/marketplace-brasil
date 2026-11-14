"use client";

import { useEffect, useState } from "react";
import {
  Search, ShoppingCart, Menu, X, Heart, Star, Trash2,
  Truck, ShieldCheck, CreditCard, Plus, Minus,
  ArrowRight, Smartphone, Watch, Headphones,
  Gamepad2, House, Shirt, Package
} from "lucide-react";
import { supabase } from "@/lib/supabase";

const SALES_ENABLED = process.env.NEXT_PUBLIC_STORE_SALES_ENABLED === "true";

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


type HomeCampaign = {
  id: string; title: string; subtitle: string; description: string;
  media_url: string | null; media_type: "image" | "video";
  button_text: string; button_url: string; placement: "hero" | "middle" | "bottom";
  background_color: string; text_color: string; sort_order: number;
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
  const [campaigns, setCampaigns] = useState<HomeCampaign[]>([]);
  const [heroIndex, setHeroIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("Todos");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [cartReady, setCartReady] = useState(false);
  const [cartUserId, setCartUserId] = useState<string | null>(null);
  const [cartCloudReadyFor, setCartCloudReadyFor] = useState<string | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [favoriteIds, setFavoriteIds] = useState<string[]>([]);
  const [favoritesReady, setFavoritesReady] = useState(false);
  const [favoritesCloudReadyFor, setFavoritesCloudReadyFor] = useState<string | null>(null);
  const [showFavorites, setShowFavorites] = useState(false);
  const [customerAvatarUrl, setCustomerAvatarUrl] = useState("");
  
  // Atualização por gesto de puxar para baixo no celular.
  useEffect(() => {
    let startY = 0;
    let startX = 0;
    const handleTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) return;
      startY = event.touches[0].clientY;
      startX = event.touches[0].clientX;
    };
    const handleTouchEnd = (event: TouchEvent) => {
      if (event.changedTouches.length !== 1) return;
      const endY = event.changedTouches[0].clientY;
      const endX = event.changedTouches[0].clientX;
      const deltaY = endY - startY;
      const deltaX = Math.abs(endX - startX);
      if (
        window.scrollY <= 2 && startY <= 100 && deltaY >= 95 &&
        deltaY > deltaX * 1.4 &&
        !document.querySelector(".cart-overlay, .detail-image-lightbox")
      ) window.location.reload();
      startY = 0;
      startX = 0;
    };
    window.addEventListener("touchstart", handleTouchStart, { passive: true });
    window.addEventListener("touchend", handleTouchEnd, { passive: true });
    return () => {
      window.removeEventListener("touchstart", handleTouchStart);
      window.removeEventListener("touchend", handleTouchEnd);
    };
  }, []);


  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [customerName, setCustomerName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [checkoutMessage, setCheckoutMessage] = useState("");
  const [couponInput, setCouponInput] = useState("");
  const [appliedCoupon, setAppliedCoupon] = useState<{
    code: string; discount: number; total: number;
  } | null>(null);
  const [couponMessage, setCouponMessage] = useState("");
  const [couponLoading, setCouponLoading] = useState(false);

  useEffect(() => {
    try {
      let visitorId = localStorage.getItem("novashopp_visitor_id");
      if (!visitorId) {
        visitorId = crypto.randomUUID();
        localStorage.setItem("novashopp_visitor_id", visitorId);
      }
      void supabase.rpc("record_store_page_view", {
        p_visitor_id: visitorId,
        p_path: window.location.pathname,
        p_product_id: null,
        p_product_name: null,
      });
    } catch (error) {
      console.warn("Não foi possível registrar a visualização.", error);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadCampaigns() {
      const { data, error } = await supabase.from("homepage_campaigns")
        .select("id,title,subtitle,description,media_url,media_type,button_text,button_url,placement,background_color,text_color,sort_order")
        .eq("active", true)
        .or(`start_at.is.null,start_at.lte.${new Date().toISOString()}`)
        .or(`end_at.is.null,end_at.gt.${new Date().toISOString()}`)
        .order("sort_order", { ascending: true });
      if (!cancelled && !error) setCampaigns((data || []) as HomeCampaign[]);
    }
    void loadCampaigns();
    return () => { cancelled = true; };
  }, []);

  const heroCampaigns = campaigns.filter((campaign) => campaign.placement === "hero");

  useEffect(() => {
    setHeroIndex(0);
    if (heroCampaigns.length < 2) return;
    const interval = window.setInterval(() => {
      setHeroIndex((current) => (current + 1) % heroCampaigns.length);
    }, 5000);
    return () => window.clearInterval(interval);
  }, [heroCampaigns.length]);

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

  // Remove do carrinho referências a produtos que não existem mais no catálogo ativo.
  // Aguarda o carregamento para não limpar o carrinho antes de receber os produtos.
  useEffect(() => {
    if (loading || error) return;

    const activeProductIds = new Set(products.map((product) => product.id));
    setCart((current) =>
      current.filter((item) => activeProductIds.has(item.id))
    );
  }, [loading, error, products]);

  useEffect(() => {
    loadProducts();

    // Se o cliente já estiver autenticado, aproveita os dados da conta no checkout.
    supabase.auth.getSession().then(({ data }) => {
      const accountUser = data.session?.user;
      setCartUserId(accountUser?.id || null);
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
      setCartUserId(session?.user?.id || null);
      const metadata = session?.user?.user_metadata;
      setCustomerAvatarUrl(typeof metadata?.avatar_url === "string" ? metadata.avatar_url : "");
    });
    return () => authListener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    try {
      const savedCart = localStorage.getItem("novashopp_cart");
      if (savedCart) {
        const parsed = JSON.parse(savedCart);
        if (Array.isArray(parsed)) {
          setCart(parsed.filter((item): item is CartItem =>
            item && typeof item.id === "string" &&
            Number.isInteger(item.qty) && item.qty > 0
          ));
        }
      }
    } catch (error) {
      console.error("Não foi possível recuperar o carrinho:", error);
    } finally {
      setCartReady(true);
    }
  }, []);

  // Ao entrar na conta, recupera o carrinho salvo na nuvem para este usuário.
  useEffect(() => {
    if (!cartReady) return;
    if (!cartUserId) {
      setCartCloudReadyFor(null);
      return;
    }

    let cancelled = false;

    async function loadAccountCart() {
      const { data, error } = await supabase
        .from("customer_carts")
        .select("items")
        .eq("user_id", cartUserId)
        .maybeSingle();

      if (cancelled) return;
      if (error) {
        console.error("Não foi possível carregar o carrinho da conta:", error);
        return;
      }

      const cloudItems = Array.isArray(data?.items)
        ? data.items.filter((item: any) =>
            item && typeof item.id === "string" &&
            Number.isInteger(item.qty) && item.qty > 0
          ) as CartItem[]
        : [];

      // A nuvem é a fonte principal quando o cliente está autenticado.
      setCart(cloudItems);
      setCartCloudReadyFor(cartUserId);
    }

    void loadAccountCart();

    return () => {
      cancelled = true;
    };
  }, [cartReady, cartUserId]);

  // Cada alteração é sincronizada com a conta autenticada.
  useEffect(() => {
    if (!cartUserId || cartCloudReadyFor !== cartUserId) return;

    const saveAccountCart = async () => {
      const { error } = await supabase
        .from("customer_carts")
        .upsert({
          user_id: cartUserId,
          items: cart,
          updated_at: new Date().toISOString(),
        }, { onConflict: "user_id" });

      if (error) {
        console.error("Não foi possível sincronizar o carrinho:", error);
      }
    };

    void saveAccountCart();
  }, [cart, cartUserId, cartCloudReadyFor]);

  useEffect(() => {
    if (!cartReady) return;
    try {
      localStorage.setItem("novashopp_cart", JSON.stringify(cart));
    } catch (error) {
      console.error("Não foi possível salvar o carrinho:", error);
    }
  }, [cart, cartReady]);

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

  // Ao entrar na conta, recupera os favoritos salvos para este cliente.
  useEffect(() => {
    if (!favoritesReady) return;
    if (!cartUserId) {
      setFavoritesCloudReadyFor(null);
      return;
    }

    let cancelled = false;

    async function loadAccountFavorites() {
      const { data, error } = await supabase
        .from("customer_favorites")
        .select("product_ids")
        .eq("user_id", cartUserId)
        .maybeSingle();

      if (cancelled) return;
      if (error) {
        console.error("Não foi possível carregar os favoritos da conta:", error);
        return;
      }

      if (data && Array.isArray(data.product_ids)) {
        setFavoriteIds(data.product_ids.filter((id: unknown): id is string => typeof id === "string"));
      }
      // Se ainda não existir registro, os favoritos locais serão enviados à conta.
      setFavoritesCloudReadyFor(cartUserId);
    }

    void loadAccountFavorites();

    return () => {
      cancelled = true;
    };
  }, [favoritesReady, cartUserId]);

  // Mantém os favoritos no aparelho e sincroniza com a conta autenticada.
  useEffect(() => {
    if (!favoritesReady) return;
    try {
      localStorage.setItem("novashopp_favorites", JSON.stringify(favoriteIds));
    } catch (error) {
      console.error("Não foi possível salvar favoritos:", error);
    }
  }, [favoriteIds, favoritesReady]);

  useEffect(() => {
    if (!cartUserId || favoritesCloudReadyFor !== cartUserId) return;

    const saveAccountFavorites = async () => {
      const { error } = await supabase
        .from("customer_favorites")
        .upsert({
          user_id: cartUserId,
          product_ids: favoriteIds,
          updated_at: new Date().toISOString(),
        }, { onConflict: "user_id" });

      if (error) {
        console.error("Não foi possível sincronizar os favoritos:", error);
      }
    };

    void saveAccountFavorites();
  }, [favoriteIds, cartUserId, favoritesCloudReadyFor]);

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
    setAppliedCoupon(null);
    setCouponMessage("");
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

  const removeFromCart = (id: string) => {
    setAppliedCoupon(null);
    setCouponMessage("");
    setCart((old) => old.filter((item) => item.id !== id));
  };

  const changeQty = (id: string, amount: number) => {
    const product = products.find((p) => p.id === id);
    if (!product) return;
    setAppliedCoupon(null);
    setCouponMessage("");

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

  const applyCoupon = async () => {
    if (!couponInput.trim() || couponLoading || cart.length === 0) return;
    setCouponLoading(true);
    setCouponMessage("");
    try {
      const response = await fetch("/api/coupons/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: couponInput,
          items: cart.map((item) => ({ id: item.id, qty: item.qty })),
        }),
      });
      const result = await response.json();
      if (!response.ok || !result.valid) {
        setAppliedCoupon(null);
        setCouponMessage(result.error || "Não foi possível aplicar este cupom.");
        return;
      }
      setAppliedCoupon({
        code: result.code,
        discount: Number(result.discount),
        total: Number(result.total),
      });
      setCouponInput(result.code);
      setCouponMessage(result.message || "Cupom aplicado com sucesso!");
    } catch (error) {
      console.error("Erro ao validar cupom:", error);
      setCouponMessage("Não foi possível validar o cupom. Tente novamente.");
    } finally {
      setCouponLoading(false);
    }
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
          couponCode: appliedCoupon?.code || null,
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
  const displayTotal = appliedCoupon ? appliedCoupon.total : total;

  return (
    <main>
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
        {categories.map((item) => {
          const CategoryIcon = item.icon;
          return (
            <button
              key={item.name}
              className={category === item.name ? "nav-active" : ""}
              aria-pressed={category === item.name}
              onClick={() => {
                setCategory(item.name);
                setShowFavorites(false);
                setMenuOpen(false);
              }}
            >
              <span className="navigation-category-icon"><CategoryIcon size={17} strokeWidth={2} /></span>
              <span>{item.name}</span>
            </button>
          );
        })}
      </nav>

      {heroCampaigns.length > 0 ? (
        <section
          className="hero-campaign-carousel"
          aria-label="Campanhas em destaque"
          style={{
            position: "relative",
            maxWidth: 1240,
            width: "calc(100% - 32px)",
            margin: "22px auto",
            overflow: "hidden",
            borderRadius: 24,
            background: heroCampaigns[heroIndex]?.background_color || "#071b43",
            color: heroCampaigns[heroIndex]?.text_color || "#fff",
            boxShadow: "0 18px 48px rgba(7, 27, 67, .18)",
          }}
        >
          <div
            style={{
              display: "flex",
              width: "100%",
              transform: `translateX(-${heroIndex * 100}%)`,
              transition: "transform 700ms cubic-bezier(.22,.8,.25,1)",
            }}
          >
            {heroCampaigns.map((campaign) => (
              <article
                className="hero-campaign-slide"
                key={campaign.id}
                aria-hidden={heroCampaigns[heroIndex]?.id !== campaign.id}
                style={{
                  boxSizing: "border-box",
                  flex: "0 0 100%",
                  minWidth: 0,
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 320px), 1fr))",
                  alignItems: "center",
                  gap: "clamp(22px, 4vw, 48px)",
                  padding: "clamp(26px, 5vw, 64px)",
                  paddingBottom: 82,
                  background: `linear-gradient(125deg, ${campaign.background_color || "#071b43"} 0%, #102e60 100%)`,
                  color: campaign.text_color || "#fff",
                }}
              >
                <div style={{ position: "relative", zIndex: 1, minWidth: 0 }}>
                  <span style={{
                    display: "inline-flex", alignItems: "center", gap: 8,
                    padding: "7px 12px", borderRadius: 999,
                    background: "rgba(255, 201, 40, .16)", color: "#ffc928",
                    fontSize: 11, fontWeight: 900, letterSpacing: 1.2,
                  }}>
                    <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: "50%", background: "#ffc928" }} />
                    DESTAQUE NOVASHOPP
                  </span>
                  <h1 style={{
                    fontSize: "clamp(32px, 5vw, 58px)", lineHeight: 1.04,
                    letterSpacing: "-.035em", fontWeight: 900,
                    margin: "20px 0 12px", maxWidth: 650,
                  }}>{campaign.title}</h1>
                  {campaign.subtitle && <h2 style={{
                    fontSize: "clamp(18px, 2.4vw, 25px)", lineHeight: 1.3,
                    fontWeight: 700, margin: "0 0 12px", opacity: .96,
                  }}>{campaign.subtitle}</h2>}
                  {campaign.description && <p style={{
                    lineHeight: 1.75, fontSize: 15, opacity: .88,
                    maxWidth: 560, margin: 0,
                  }}>{campaign.description}</p>}
                  <button className="hero-campaign-button" type="button" onClick={() => {
                    const target = (campaign.button_url || "").trim();
                    const label = (campaign.button_text || "").toLowerCase();
                    const isCatalogTarget = !target || target === "/" || target === "#produtos" || target === "/#produtos";
                    if (isCatalogTarget || label.includes("explorar")) {
                      document.getElementById("produtos")?.scrollIntoView({ behavior: "smooth", block: "start" });
                      return;
                    }
                    const destination = /^https?:\/\//i.test(target)
                      ? target
                      : target.startsWith("/") ? target : `/${target}`;
                    window.location.assign(destination);
                  }} style={{
                    display: "inline-flex", alignItems: "center", justifyContent: "center",
                    padding: "14px 22px", marginTop: 24, borderRadius: 10,
                    border: 0, cursor: "pointer",
                    background: "#ffc928", color: "#071b43", fontWeight: 900,
                    fontSize: 14,
                    boxShadow: "0 8px 22px rgba(255, 201, 40, .2)",
                  }}>
                    {campaign.button_text || "Conheça a loja"} <ArrowRight size={18} style={{ marginLeft: 10 }} />
                  </button>
                </div>
                <div className="hero-campaign-media" style={{
                  position: "relative", minWidth: 0, minHeight: 240,
                  borderRadius: 18, overflow: "hidden",
                  background: "rgba(255,255,255,.08)",
                  border: "1px solid rgba(255,255,255,.14)",
                  boxShadow: "0 18px 38px rgba(0,0,0,.18)",
                }}>
                  {campaign.media_url ? (campaign.media_type === "video"
                    ? <video src={campaign.media_url} autoPlay muted loop playsInline controls
                        aria-label={campaign.title}
                        style={{ display: "block", width: "100%", height: "100%", minHeight: 240, maxHeight: 420, objectFit: "cover" }} />
                    : <img src={campaign.media_url} alt={campaign.title}
                        style={{ display: "block", width: "100%", height: "100%", minHeight: 240, maxHeight: 420, objectFit: "cover" }} />)
                    : <div style={{
                        display: "grid", placeItems: "center", minHeight: 280,
                        background: "radial-gradient(circle at 50% 45%, rgba(255,201,40,.22), transparent 55%)",
                        color: "#ffc928", textAlign: "center", padding: 24,
                      }}>
                        <div><Package size={76} strokeWidth={1.2} /><strong style={{ display: "block", marginTop: 12, color: "#fff", fontSize: 17 }}>Novidades para descobrir</strong></div>
                      </div>}
                </div>
              </article>
            ))}
          </div>
          {heroCampaigns.length > 1 && (
            <>
              <div style={{
                position: "absolute", left: 0, right: 0, bottom: 18,
                display: "flex", alignItems: "center", justifyContent: "center", gap: 12,
                zIndex: 3,
              }}>
                <button className="campaign-carousel-control" type="button" aria-label="Campanha anterior"
                  onClick={() => setHeroIndex((current) => (current - 1 + heroCampaigns.length) % heroCampaigns.length)}
                  style={{ width: 34, height: 34, borderRadius: 999, border: "1px solid rgba(255,255,255,.55)", background: "rgba(255,255,255,.14)", color: "#fff", cursor: "pointer", fontSize: 20 }}>‹</button>
                {heroCampaigns.map((campaign, index) => (
                  <button className="campaign-carousel-indicator" key={campaign.id} type="button"
                    aria-label={`Mostrar campanha ${index + 1}`}
                    aria-current={heroIndex === index ? "true" : undefined}
                    onClick={() => setHeroIndex(index)}
                    style={{ width: heroIndex === index ? 24 : 9, height: 9, padding: 0, border: 0, borderRadius: 99, background: heroIndex === index ? "#ffc928" : "rgba(255,255,255,.65)", cursor: "pointer", transition: "all 250ms ease" }} />
                ))}
                <button className="campaign-carousel-control" type="button" aria-label="Próxima campanha"
                  onClick={() => setHeroIndex((current) => (current + 1) % heroCampaigns.length)}
                  style={{ width: 34, height: 34, borderRadius: 999, border: "1px solid rgba(255,255,255,.55)", background: "rgba(255,255,255,.14)", color: "#fff", cursor: "pointer", fontSize: 20 }}>›</button>
              </div>
            </>
          )}
        </section>
      ) : (
        <section className="hero">
          <div className="hero-content">
            <span className="hero-label">NOVASHOPP STORE • CONHEÇA NOSSA LOJA</span>
            <h1>Tudo o que você precisa, <em>em um só lugar!</em></h1>
            <p>
              Descubra tecnologia, casa, moda, acessórios e muitas novidades.
              Explore nosso catálogo e conheça a NOVASHOPP STORE.
            </p>
            <button
              className="hero-button"
              onClick={() =>
                document.getElementById("produtos")?.scrollIntoView({
                  behavior: "smooth",
                })
              }
            >
              Explorar produtos
            </button>
          </div>
        </section>
      )}
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
              <article
                className="product-card"
                key={product.id}
                role="link"
                tabIndex={0}
                aria-label={`Abrir produto ${product.name}`}
                onClick={(event) => {
                  const target = event.target as HTMLElement;
                  if (target.closest("button, a")) return;
                  window.location.href = `/produto/${product.id}`;
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    window.location.href = `/produto/${product.id}`;
                  }
                }}
              >
                <div className="product-image">
                  {product.stock <= 0 && (
                    <span className="product-tag">Estoque esgotado</span>
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
                      : "Estoque esgotado"}
                  </small>

                  <button
                    className="add-button"
                    disabled={!SALES_ENABLED || product.stock <= 0}
                    onClick={() => addToCart(product.id)}
                  >
                    <ShoppingCart size={17} />
                    {!SALES_ENABLED
                      ? "Vendas em breve"
                      : product.stock > 0
                        ? "Adicionar ao carrinho"
                        : "Estoque esgotado"}
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
          className="newsletter-button"
          onClick={() =>
            document.getElementById("produtos")?.scrollIntoView({
              behavior: "smooth",
              block: "start",
            })
          }
        >
          Explorar produtos <ArrowRight size={18} />
        </button>
      </section>

      {campaigns.filter((campaign) => campaign.placement === "bottom").map((campaign) => (
        <section key={campaign.id} style={{ maxWidth: 1240, margin: "24px auto", padding: 24, borderRadius: 16, background: campaign.background_color, color: campaign.text_color, textAlign: "center" }}>
          <h2>{campaign.title}</h2><h3>{campaign.subtitle}</h3><p>{campaign.description}</p>
          {campaign.media_url && (campaign.media_type === "video" ? <video src={campaign.media_url} controls playsInline style={{ width: "100%", maxHeight: 320, objectFit: "contain" }} /> : <img src={campaign.media_url} alt={campaign.title} style={{ width: "100%", maxHeight: 320, objectFit: "contain" }} />)}
          <a className="campaign-bottom-button" href={campaign.button_url || "/"} style={{ display: "inline-block", padding: "11px 17px", borderRadius: 8, background: "#ffc928", color: "#071b43", fontWeight: 800, textDecoration: "none" }}>{campaign.button_text || "Confira"}</a>
        </section>
      ))}
      <footer className="footer">
        <div className="footer-logo">
          <span className="logo-icon">N</span>
          <span className="brand-name">NovaShopp<span className="logo-dot">.</span><small>STORE</small></span>
        </div>
        <p>Tudo o que você precisa, em um só lugar!</p>

        {/* LINK DE ACOMPANHAMENTO NO RODAPÉ */}
        <div style={{ margin: "18px 0" }}>
          <a
            className="footer-track-link"
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

                            <div className="cart-item-actions">
                              <strong>
                                {money(Number(product.price) * item.qty)}
                              </strong>
                              <button
                                type="button"
                                className="cart-remove-button"
                                onClick={() => removeFromCart(item.id)}
                                aria-label={`Excluir ${product.name} do carrinho`}
                                title="Excluir do carrinho"
                              >
                                <Trash2 size={17} />
                                <span>Excluir</span>
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    <div style={{ padding: "14px 0", borderBottom: "1px solid #e5e7eb" }}>
                      <label style={{ display: "block", fontSize: 14, fontWeight: 700, marginBottom: 8 }}>
                        Cupom de desconto
                      </label>
                      <div style={{ display: "flex", gap: 8 }}>
                        <input
                          value={couponInput}
                          onChange={(e) => {
                            setCouponInput(e.target.value.toUpperCase());
                            setAppliedCoupon(null);
                            setCouponMessage("");
                          }}
                          placeholder="Digite seu cupom"
                          disabled={couponLoading}
                          style={{ minWidth: 0, flex: 1, padding: 12, border: "1px solid #cbd5e1", borderRadius: 8, textTransform: "uppercase" }}
                        />
                        <button
                          type="button"
                          onClick={() => void applyCoupon()}
                          disabled={couponLoading || !couponInput.trim()}
                          style={{ padding: "10px 14px", border: 0, borderRadius: 8, background: "#102a56", color: "#fff", fontWeight: 700, opacity: couponLoading || !couponInput.trim() ? 0.6 : 1 }}
                        >
                          {couponLoading ? "Verificando..." : "Aplicar"}
                        </button>
                      </div>
                      {couponMessage && (
                        <p role="status" style={{ marginTop: 8, fontSize: 13, color: appliedCoupon ? "#15803d" : "#b42318" }}>
                          {couponMessage}
                        </p>
                      )}
                    </div>

                    <div className="cart-total" style={{ flexDirection: "column", alignItems: "stretch", gap: 7 }}>
                      {appliedCoupon && (
                        <>
                          <div style={{ display: "flex", justifyContent: "space-between", color: "#15803d", fontSize: 14 }}>
                            <span>Desconto ({appliedCoupon.code})</span>
                            <strong>- {money(appliedCoupon.discount)}</strong>
                          </div>
                          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, color: "#64748b" }}>
                            <span>Subtotal</span>
                            <span>{money(total)}</span>
                          </div>
                        </>
                      )}
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <span>Total</span>
                        <strong>{money(displayTotal)}</strong>
                      </div>
                    </div>

                    <button
                      className="checkout-button"
                      disabled={!SALES_ENABLED}
                      onClick={() => {
                        setCheckoutMessage("");
                        setCheckoutOpen(true);
                      }}
                    >
                      {SALES_ENABLED ? "Finalizar compra" : "Vendas temporariamente suspensas"}
                    </button>

                    <p className="cart-note">
                      {SALES_ENABLED ? "Você será encaminhado ao ambiente seguro de pagamento." : "Estamos preparando nossa loja para a inauguração. Em breve você poderá comprar!"}
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

                    <div className="cart-total" style={{ flexDirection: "column", alignItems: "stretch", gap: 7 }}>
                      {appliedCoupon && (
                        <div style={{ display: "flex", justifyContent: "space-between", color: "#15803d", fontSize: 14 }}>
                          <span>Desconto ({appliedCoupon.code})</span>
                          <strong>- {money(appliedCoupon.discount)}</strong>
                        </div>
                      )}
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <span>Total do pedido</span>
                        <strong>{money(displayTotal)}</strong>
                      </div>
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

