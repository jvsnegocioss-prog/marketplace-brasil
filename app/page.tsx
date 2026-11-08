"use client";

import { useState } from "react";
import {
  Search, ShoppingCart, Menu, X, Heart, Star,
  Truck, ShieldCheck, CreditCard, Plus, Minus,
  ArrowRight, Smartphone, Watch, Headphones,
  Gamepad2, House, Shirt, Package
} from "lucide-react";

const products = [
  { id: 1, name: "Fone Bluetooth Premium", price: 89.90, old: 129.90, category: "Eletrônicos", icon: Headphones, tag: "Mais vendido" },
  { id: 2, name: "Smartwatch Inteligente", price: 159.90, old: 219.90, category: "Eletrônicos", icon: Watch, tag: "Oferta" },
  { id: 3, name: "Mochila Moderna", price: 119.90, old: 149.90, category: "Acessórios", icon: Package, tag: "" },
  { id: 4, name: "Luminária Decorativa LED", price: 69.90, old: 99.90, category: "Casa", icon: House, tag: "Oferta" },
  { id: 5, name: "Óculos de Sol", price: 49.90, old: 79.90, category: "Moda", icon: Shirt, tag: "" },
  { id: 6, name: "Controle Gamer sem Fio", price: 139.90, old: 179.90, category: "Games", icon: Gamepad2, tag: "Destaque" },
  { id: 7, name: "Caixa de Som Bluetooth", price: 99.90, old: 139.90, category: "Eletrônicos", icon: Smartphone, tag: "" },
  { id: 8, name: "Organizador Multiuso", price: 39.90, old: 59.90, category: "Casa", icon: House, tag: "" },
];

const categories = [
  { name: "Todos", icon: Package },
  { name: "Eletrônicos", icon: Smartphone },
  { name: "Acessórios", icon: Watch },
  { name: "Casa", icon: House },
  { name: "Moda", icon: Shirt },
  { name: "Games", icon: Gamepad2 },
];

const money = (value: number) =>
  value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export default function Home() {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("Todos");
  const [cart, setCart] = useState<{ id: number; qty: number }[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const filtered = products.filter((p) =>
    (category === "Todos" || p.category === category) &&
    p.name.toLowerCase().includes(search.toLowerCase())
  );

  const addToCart = (id: number) => {
    setCart((old) => {
      const found = old.find((item) => item.id === id);
      return found
        ? old.map((item) => item.id === id ? { ...item, qty: item.qty + 1 } : item)
        : [...old, { id, qty: 1 }];
    });
    setCartOpen(true);
  };

  const changeQty = (id: number, amount: number) => {
    setCart((old) =>
      old.map((item) => item.id === id ? { ...item, qty: item.qty + amount } : item)
        .filter((item) => item.qty > 0)
    );
  };

  const totalItems = cart.reduce((sum, item) => sum + item.qty, 0);
  const total = cart.reduce((sum, item) => {
    const product = products.find((p) => p.id === item.id);
    return sum + (product ? product.price * item.qty : 0);
  }, 0);

  return (
    <main>
      <div className="topbar">
        <span>Ofertas especiais todos os dias!</span>
        <span>Compre com segurança e praticidade</span>
      </div>

      <header className="header">
        <button className="icon-btn mobile-menu" onClick={() => setMenuOpen(!menuOpen)}>
          <Menu size={25} />
        </button>

        <a href="#" className="logo">
          <span className="logo-icon">M</span>
          <span>Marketplace<span className="logo-dot">.</span></span>
        </a>

        <div className="search-box">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="O que você está procurando?"
          />
          <button aria-label="Pesquisar"><Search size={21} /></button>
        </div>

        <div className="header-actions">
          <button className="icon-btn favorite-btn" aria-label="Favoritos">
            <Heart size={23} />
          </button>
          <button className="cart-button" onClick={() => setCartOpen(true)}>
            <ShoppingCart size={23} />
            <span className="cart-label">Carrinho</span>
            {totalItems > 0 && <span className="cart-count">{totalItems}</span>}
          </button>
        </div>
      </header>

      <nav className={`navigation ${menuOpen ? "nav-open" : ""}`}>
        {categories.map((item) => (
          <button
            key={item.name}
            className={category === item.name ? "nav-active" : ""}
            onClick={() => { setCategory(item.name); setMenuOpen(false); }}
          >
            {item.name}
          </button>
        ))}
      </nav>

      <section className="hero">
        <div className="hero-content">
          <span className="hero-label">SEU NOVO JEITO DE COMPRAR</span>
          <h1>Encontre tudo o que você procura em um só lugar.</h1>
          <p>Tecnologia, acessórios, casa, moda e muito mais. Aproveite nossas ofertas!</p>
          <button className="hero-button" onClick={() => document.getElementById("produtos")?.scrollIntoView({ behavior: "smooth" })}>
            Comprar agora <ArrowRight size={18} />
          </button>
        </div>
        <div className="hero-art">
          <div className="hero-circle">
            <ShoppingCart size={110} strokeWidth={1.2} />
            <span>OFERTAS</span>
          </div>
          <div className="floating-card">Até 40% OFF</div>
        </div>
      </section>

      <section className="benefits">
        <div><Truck /><span><strong>Entrega facilitada</strong><small>Comodidade para você</small></span></div>
        <div><ShieldCheck /><span><strong>Compra segura</strong><small>Mais tranquilidade</small></span></div>
        <div><CreditCard /><span><strong>Pagamento prático</strong><small>Opções para comprar</small></span></div>
        <div><Star /><span><strong>Ofertas especiais</strong><small>Preços que surpreendem</small></span></div>
      </section>

      <section className="categories-section">
        <div className="section-heading">
          <div><span className="eyebrow">EXPLORE A LOJA</span><h2>Compre por categoria</h2></div>
        </div>
        <div className="category-grid">
          {categories.slice(1).map((item) => {
            const Icon = item.icon;
            return (
              <button key={item.name} className="category-card" onClick={() => {
                setCategory(item.name);
                document.getElementById("produtos")?.scrollIntoView({ behavior: "smooth" });
              }}>
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
          <div><span className="eyebrow">SELEÇÃO ESPECIAL</span><h2>Produtos em destaque</h2></div>
          <span className="product-count">{filtered.length} produtos</span>
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

        {filtered.length === 0 ? (
          <p className="empty-message">Nenhum produto encontrado. Tente outra pesquisa.</p>
        ) : (
          <div className="product-grid">
            {filtered.map((product) => {
              const Icon = product.icon;
              return (
                <article className="product-card" key={product.id}>
                  <div className="product-image">
                    {product.tag && <span className="product-tag">{product.tag}</span>}
                    <button className="heart-button" aria-label="Favoritar"><Heart size={19} /></button>
                    <div className="product-art"><Icon size={76} strokeWidth={1.2} /></div>
                  </div>
                  <div className="product-info">
                    <span className="product-category">{product.category}</span>
                    <h3>{product.name}</h3>
                    <div className="rating">★★★★★ <small>(Avaliações)</small></div>
                    <span className="old-price">{money(product.old)}</span>
                    <strong className="price">{money(product.price)}</strong>
                    <small className="installments">Consulte condições de pagamento</small>
                    <button className="add-button" onClick={() => addToCart(product.id)}>
                      <ShoppingCart size={17} /> Adicionar ao carrinho
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="newsletter">
        <div><span className="eyebrow">NOVIDADES E OFERTAS</span><h2>Fique por dentro das novidades!</h2><p>Acompanhe nossa loja e não perca oportunidades.</p></div>
        <button onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>Explorar produtos <ArrowRight size={18} /></button>
      </section>

      <footer className="footer">
        <div className="footer-logo"><span className="logo-icon">M</span> Marketplace<span className="logo-dot">.</span></div>
        <p>Sua loja online de variedades, tecnologia e muito mais.</p>
        <div className="footer-bottom">© 2026 Marketplace. Todos os direitos reservados.</div>
      </footer>

      {cartOpen && (
        <div className="cart-overlay" onClick={() => setCartOpen(false)}>
          <aside className="cart-drawer" onClick={(e) => e.stopPropagation()}>
            <div className="cart-heading">
              <h2>Meu carrinho ({totalItems})</h2>
              <button className="icon-btn" onClick={() => setCartOpen(false)}><X /></button>
            </div>
            {cart.length === 0 ? (
              <div className="empty-cart"><ShoppingCart size={45} /><p>Seu carrinho está vazio.</p><button onClick={() => setCartOpen(false)}>Continuar comprando</button></div>
            ) : (
              <>
                <div className="cart-items">
                  {cart.map((item) => {
                    const product = products.find((p) => p.id === item.id)!;
                    return (
                      <div className="cart-item" key={item.id}>
                        <div className="cart-product-icon"><product.icon size={28} /></div>
                        <div className="cart-product-info"><strong>{product.name}</strong><span>{money(product.price)}</span>
                          <div className="quantity">
                            <button onClick={() => changeQty(item.id, -1)}><Minus size={14} /></button>
                            {item.qty}
                            <button onClick={() => changeQty(item.id, 1)}><Plus size={14} /></button>
                          </div>
                        </div>
                        <strong>{money(product.price * item.qty)}</strong>
                      </div>
                    );
                  })}
                </div>
                <div className="cart-total"><span>Total</span><strong>{money(total)}</strong></div>
                <button className="checkout-button" onClick={() => alert("O checkout será configurado na próxima etapa.")}>Finalizar compra</button>
                <p className="cart-note">Ambiente demonstrativo. Pagamentos serão configurados posteriormente.</p>
              </>
            )}
          </aside>
        </div>
      )}
    </main>
  );
}
