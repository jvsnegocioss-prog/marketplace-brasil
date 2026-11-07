"use client";

import { useMemo, useState } from "react";
import { Search, ShoppingCart, UserRound, Smartphone, House, Watch, Gamepad2, Sparkles, Heart, Truck, ShieldCheck, CreditCard, Headphones, Plus, X, Minus } from "lucide-react";

const products = [
  {id:1,name:"Fone Bluetooth sem fio",category:"Eletrônicos",price:89.90,old:129.90,image:"https://images.unsplash.com/photo-1505740420928-5e560c06d30e?auto=format&fit=crop&w=700&q=85",tag:"OFERTA"},
  {id:2,name:"Relógio inteligente esportivo",category:"Eletrônicos",price:149.90,old:199.90,image:"https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&w=700&q=85",tag:"DESTAQUE"},
  {id:3,name:"Mochila urbana para o dia a dia",category:"Acessórios",price:119.90,image:"https://images.unsplash.com/photo-1553062407-98eeb64c6a62?auto=format&fit=crop&w=700&q=85"},
  {id:4,name:"Luminária moderna",category:"Casa",price:79.90,old:99.90,image:"https://images.unsplash.com/photo-1507473885765-e6ed057f782c?auto=format&fit=crop&w=700&q=85"},
  {id:5,name:"Óculos de sol clássico",category:"Moda",price:69.90,image:"https://images.unsplash.com/photo-1511499767150-a48a237f0083?auto=format&fit=crop&w=700&q=85"},
  {id:6,name:"Controle para jogos",category:"Games",price:159.90,old:189.90,image:"https://images.unsplash.com/photo-1606144042614-b2417e99c4e3?auto=format&fit=crop&w=700&q=85"},
  {id:7,name:"Garrafa térmica inox",category:"Casa",price:54.90,image:"https://images.unsplash.com/photo-1602143407151-7111542de6e8?auto=format&fit=crop&w=700&q=85"},
  {id:8,name:"Acessório para celular",category:"Acessórios",price:39.90,old:49.90,image:"https://images.unsplash.com/photo-1586953208448-b95a79798f07?auto=format&fit=crop&w=700&q=85"}
];
const categories = [
  {name:"Todos",icon:Sparkles},{name:"Eletrônicos",icon:Smartphone},{name:"Acessórios",icon:Watch},
  {name:"Casa",icon:House},{name:"Moda",icon:Heart},{name:"Games",icon:Gamepad2}
];
const money = (n:number) => n.toLocaleString("pt-BR",{style:"currency",currency:"BRL"});

export default function Home() {
  const [query,setQuery] = useState("");
  const [category,setCategory] = useState("Todos");
  const [cart,setCart] = useState<Record<number,number>>({});
  const [cartOpen,setCartOpen] = useState(false);
  const [menuOpen,setMenuOpen] = useState(false);
  const filtered = useMemo(()=>products.filter(p=>(category==="Todos"||p.category===category)&&(p.name.toLowerCase().includes(query.toLowerCase())||p.category.toLowerCase().includes(query.toLowerCase()))),[category,query]);
  const count = Object.values(cart).reduce((a,b)=>a+b,0);
  const items = products.filter(p=>cart[p.id]);
  const total = items.reduce((a,p)=>a+p.price*cart[p.id],0);
  const add = (id:number)=>setCart(c=>({...c,[id]:(c[id]||0)+1}));
  const change = (id:number,n:number)=>setCart(c=>{const next={...c,[id]:(c[id]||0)+n};if(next[id]<=0)delete next[id];return next;});

  return <main>
    <div className="topbar">Descubra novidades e produtos para todos os momentos</div>
    <header>
      <div className="header container">
        <button className="menu-btn" onClick={()=>setMenuOpen(!menuOpen)} aria-label="Abrir menu">☰</button>
        <a className="logo" href="#"><span className="logo-icon">M</span><span>market<span className="light">place</span><small>BRASIL</small></span></a>
        <label className="search"><Search size={19}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="O que você está procurando?"/>{query&&<button onClick={()=>setQuery("")} aria-label="Limpar"><X size={16}/></button>}</label>
        <div className="actions"><span className="account"><UserRound size={19}/> <span>Minha conta<small>Entre ou cadastre-se</small></span></span><button className="cart-button" onClick={()=>setCartOpen(true)}><ShoppingCart size={22}/> Carrinho {count>0&&<b>{count}</b>}</button></div>
      </div>
      <nav className={menuOpen?"open":""}><div className="container nav">{categories.slice(1).map(c=><button key={c.name} onClick={()=>{setCategory(c.name);setMenuOpen(false)}}>{c.name}</button>)}<a href="#ofertas">Ofertas do dia ↗</a></div></nav>
    </header>
    <section className="hero container">
      <div className="hero-copy"><span className="eyebrow"><Sparkles size={14}/> UM UNIVERSO DE POSSIBILIDADES</span><h1>O que você procura,<br/><em>está por aqui.</em></h1><p>Tecnologia, acessórios, casa, moda e novidades para facilitar o seu dia. Descubra tudo em um só lugar.</p><a className="primary" href="#produtos">Explorar produtos <span>→</span></a><small className="hero-note">● Novidades chegando sempre</small></div>
      <div className="hero-art"><div className="orbit one"></div><div className="orbit two"></div><div className="art-card back">IDEIAS QUE<br/>CONECTAM ✦</div><div className="art-card front"><ShoppingCart size={34}/><strong>Seu próximo<br/>favorito está aqui.</strong><small>Explore. Encontre. Aproveite.</small></div><span className="float top">✦ Novas descobertas</span><span className="float bottom">Tudo em um só lugar</span></div>
    </section>
    <section className="benefits container">
      <div><Truck/><span><b>Entrega combinada</b><small>Consulte opções no pedido</small></span></div><div><ShieldCheck/><span><b>Compra com cuidado</b><small>Informações claras e suporte</small></span></div><div><CreditCard/><span><b>Pagamento facilitado</b><small>Opções na finalização</small></span></div><div><Headphones/><span><b>Atendimento</b><small>Estamos aqui para ajudar</small></span></div>
    </section>
    <section className="container section"><div className="section-title"><div><span className="eyebrow">EXPLORE A VITRINE</span><h2>Encontre sua categoria</h2></div><small>Um pouco de tudo, do seu jeito.</small></div><div className="categories">{categories.map(c=>{const Icon=c.icon;return <button className={category===c.name?"active":""} key={c.name} onClick={()=>setCategory(c.name)}><span><Icon size={21}/></span><b>{c.name}</b>›</button>})}</div></section>
    <section className="container section products" id="produtos"><div className="section-title" id="ofertas"><div><span className="eyebrow">SELEÇÃO ESPECIAL</span><h2>{category==="Todos"?"Destaques para você":category}</h2></div><small>{filtered.length} produtos encontrados</small></div><div className="grid">{filtered.map(p=><article className="product" key={p.id}><div className="photo">{p.tag&&<label>{p.tag}</label>}<img src={p.image} alt={p.name}/></div><div className="product-info"><small>{p.category}</small><h3>{p.name}</h3><div className="rating">★ <b>4,8</b> <span>• avaliações ilustrativas</span></div>{p.old&&<del>{money(p.old)}</del>}<strong className="price">{money(p.price)}</strong><button className="add" onClick={()=>add(p.id)}><Plus size={16}/> Adicionar ao carrinho</button></div></article>)}{filtered.length===0&&<div className="empty"><h3>Nenhum produto encontrado</h3><p>Tente outro termo ou categoria.</p><button onClick={()=>{setQuery("");setCategory("Todos")}}>Ver todos os produtos</button></div>}</div></section>
    <section className="newsletter container"><div><span className="eyebrow">FIQUE POR DENTRO</span><h2>Novidades e descobertas<br/>em um só lugar.</h2><p>Esta é uma prévia da nossa vitrine. Em breve, novas funcionalidades.</p></div><div className="stamp">✦<b>SEMPRE TEM<br/>NOVIDADE</b></div></section>
    <footer><div className="container footer"><a className="logo footer-logo" href="#"><span className="logo-icon">M</span><span>market<span className="light">place</span><small>BRASIL</small></span></a><p>Uma nova experiência para descobrir produtos e novidades.</p><small>© 2026 Marketplace Brasil. Projeto em desenvolvimento.</small></div></footer>
    {cartOpen&&<div className="backdrop" onClick={()=>setCartOpen(false)}><aside className="drawer" onClick={e=>e.stopPropagation()}><div className="drawer-head"><div><span className="eyebrow">SUA SACOLA</span><h2>Carrinho ({count})</h2></div><button onClick={()=>setCartOpen(false)} aria-label="Fechar"><X/></button></div>{items.length===0?<div className="empty-cart"><ShoppingCart size={38}/><h3>Seu carrinho está vazio</h3><p>Explore a vitrine e adicione seus favoritos.</p><button className="primary" onClick={()=>setCartOpen(false)}>Continuar comprando</button></div>:<><div className="cart-items">{items.map(p=><div className="cart-item" key={p.id}><img src={p.image} alt=""/><div><b>{p.name}</b><strong>{money(p.price)}</strong><div className="qty"><button onClick={()=>change(p.id,-1)}><Minus size={13}/></button>{cart[p.id]}<button onClick={()=>change(p.id,1)}><Plus size={13}/></button></div></div></div>)}</div><div className="total"><span>Subtotal</span><b>{money(total)}</b><small>Frete e pagamento serão definidos em uma próxima etapa.</small><button className="primary" onClick={()=>alert("O checkout será implementado na próxima etapa.")}>Continuar</button></div></>}</aside></div>}
  </main>;
}