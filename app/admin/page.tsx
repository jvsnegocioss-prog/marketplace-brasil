"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
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

type ProductMedia = {
  id: string;
  product_id: string;
  media_type: "image" | "video";
  url: string;
  storage_path: string;
  sort_order: number;
};

type Order = {
  id: string;
  total: number | string;
  status: string;
  created_at: string;
};

const inputStyle: React.CSSProperties = {
  display: "block",
  width: "100%",
  padding: 12,
  marginTop: 6,
  marginBottom: 16,
  border: "1px solid #cccccc",
  borderRadius: 6,
  boxSizing: "border-box",
};

const buttonStyle: React.CSSProperties = {
  padding: "12px 18px",
  margin: "5px 5px 5px 0",
  border: "none",
  borderRadius: 6,
  background: "#222222",
  color: "#ffffff",
  cursor: "pointer",
};

const formStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
  padding: 18,
  border: "1px solid #dddddd",
  borderRadius: 10,
};

const dashboardGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: 12,
  marginTop: 16,
};

const dashboardCardStyle: React.CSSProperties = {
  border: "1px solid #dddddd",
  borderRadius: 10,
  padding: 18,
  background: "#ffffff",
};

async function createVideoPoster(file: File): Promise<Blob> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const video = document.createElement("video");
    video.preload = "metadata"; video.muted = true; video.playsInline = true; video.src = objectUrl;
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error("Não foi possível ler o vídeo para criar a capa."));
    });
    if (!Number.isFinite(video.duration) || video.duration <= 0) throw new Error("O vídeo não possui duração válida para gerar a capa.");
    video.currentTime = Math.min(0.2, video.duration / 2);
    await new Promise<void>((resolve, reject) => {
      video.onseeked = () => resolve();
      video.onerror = () => reject(new Error("Não foi possível capturar um quadro do vídeo."));
    });
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || 640; canvas.height = video.videoHeight || 360;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Não foi possível preparar a capa do vídeo.");
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Falha ao gerar a imagem de capa do vídeo.")), "image/jpeg", 0.82);
    });
  } finally { URL.revokeObjectURL(objectUrl); }
}

function formatCurrency(value: number) {
  return value.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function normalizeStatus(status: string) {
  return status.trim().toLowerCase();
}

function isPaid(status: string) {
  return ["pago", "aprovado", "approved", "concluido", "concluído"].includes(
    normalizeStatus(status)
  );
}

function isWaiting(status: string) {
  return ["aguardando", "pendente", "pending"].includes(
    normalizeStatus(status)
  );
}

function isCancelled(status: string) {
  return ["cancelado", "cancelada", "cancelled", "canceled"].includes(
    normalizeStatus(status)
  );
}

function DashboardCard({
  title,
  value,
  detail,
}: {
  title: string;
  value: string;
  detail: string;
}) {
  return (
    <article className="admin-stat-card" style={dashboardCardStyle}>
      <p style={{ margin: 0, color: "#555555" }}>{title}</p>
      <h2 style={{ margin: "12px 0", fontSize: 25 }}>{value}</h2>
      <small style={{ color: "#666666" }}>{detail}</small>
    </article>
  );
}

export default function AdminPage() {
  const router = useRouter();

  const [authorized, setAuthorized] = useState(false);
  const [loading, setLoading] = useState(true);
  const [products, setProducts] = useState<Product[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [analyticsRows, setAnalyticsRows] = useState<{ visitor_id: string; path: string; product_id: string | null; product_name: string | null; viewed_at: string }[]>([]);
  const [analyticsMessage, setAnalyticsMessage] = useState("");
  const [message, setMessage] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const touchStartY = useRef<number | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [stock, setStock] = useState("0");
  const [category, setCategory] = useState("");
  const [customCategory, setCustomCategory] = useState("");
  const [image, setImage] = useState<File | null>(null);
  const [mediaFiles, setMediaFiles] = useState<File[]>([]);
  const [existingMedia, setExistingMedia] = useState<ProductMedia[]>([]);
  const [saving, setSaving] = useState(false);
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiNotes, setAiNotes] = useState<string[]>([]);

  useEffect(() => {
    async function checkAdmin() {
      try {
        const { data: userData, error: userError } =
          await supabase.auth.getUser();

        if (userError || !userData.user) {
          router.replace("/admin/login");
          return;
        }

        const { data, error } = await supabase.rpc(
          "is_marketplace_admin"
        );

        if (error || data !== true) {
          await supabase.auth.signOut();
          router.replace("/admin/login");
          return;
        }

        setAuthorized(true);

        await Promise.all([
          loadProducts(),
          loadOrders(),
          loadAnalytics(),
        ]);
      } catch {
        setMessage("Erro ao verificar acesso ao painel.");
      } finally {
        setLoading(false);
      }
    }

    checkAdmin();
  }, [router]);

  async function loadProducts() {
    const { data, error } = await supabase
      .from("products")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      setMessage("Erro ao carregar produtos: " + error.message);
      return;
    }

    setProducts((data || []) as Product[]);
  }

  async function loadAnalytics() {
    const since = new Date();
    since.setDate(since.getDate() - 30);
    const { data, error } = await supabase
      .from("store_page_views")
      .select("visitor_id,path,product_id,product_name,viewed_at")
      .gte("viewed_at", since.toISOString())
      .order("viewed_at", { ascending: false })
      .limit(10000);
    if (error) {
      setAnalyticsMessage("Não foi possível carregar os acessos: " + error.message);
      return;
    }
    setAnalyticsRows(data || []);
    setAnalyticsMessage("");
  }

  async function loadOrders() {
    const { data, error } = await supabase
      .from("orders")
      .select("id,total,status,created_at")
      .order("created_at", { ascending: false });

    if (error) {
      setMessage("Erro ao carregar pedidos: " + error.message);
      return;
    }

    setOrders((data || []) as Order[]);
  }

  const uniqueVisitors = new Set(analyticsRows.map((row) => row.visitor_id)).size;
  const pageViewCount = analyticsRows.length;
  const topPages = Object.entries(analyticsRows.reduce<Record<string, number>>((acc, row) => {
    acc[row.path] = (acc[row.path] || 0) + 1;
    return acc;
  }, {})).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const topProducts = Object.entries(analyticsRows.reduce<Record<string, { name: string; count: number }>>((acc, row) => {
    if (!row.product_id) return acc;
    const current = acc[row.product_id] || { name: row.product_name || "Produto", count: 0 };
    current.count += 1;
    acc[row.product_id] = current;
    return acc;
  }, {})).sort((a, b) => b[1].count - a[1].count).slice(0, 5);

  const paidOrders = orders.filter((order) =>
    isPaid(order.status)
  );

  const waitingOrders = orders.filter((order) =>
    isWaiting(order.status)
  );

  const cancelledOrders = orders.filter((order) =>
    isCancelled(order.status)
  );

  const totalSold = paidOrders.reduce(
    (sum, order) => sum + Number(order.total || 0),
    0
  );

  const now = new Date();

  const todayOrders = paidOrders.filter((order) => {
    const date = new Date(order.created_at);

    return (
      date.getFullYear() === now.getFullYear() &&
      date.getMonth() === now.getMonth() &&
      date.getDate() === now.getDate()
    );
  });

  const monthOrders = paidOrders.filter((order) => {
    const date = new Date(order.created_at);

    return (
      date.getFullYear() === now.getFullYear() &&
      date.getMonth() === now.getMonth()
    );
  });

  const revenueToday = todayOrders.reduce(
    (sum, order) => sum + Number(order.total || 0),
    0
  );

  const revenueMonth = monthOrders.reduce(
    (sum, order) => sum + Number(order.total || 0),
    0
  );

  function clearForm() {
    setEditingId(null);
    setName("");
    setDescription("");
    setPrice("");
    setStock("0");
    setCategory("");
    setCustomCategory("");
    setImage(null);
    setMediaFiles([]);
    setExistingMedia([]);

    const mediaInput = document.getElementById("product-media") as HTMLInputElement | null;
    if (mediaInput) mediaInput.value = "";

    const fileInput = document.getElementById(
      "product-image"
    ) as HTMLInputElement | null;

    if (fileInput) {
      fileInput.value = "";
    }
  }

  function editProduct(product: Product) {
    setEditingId(product.id);
    setName(product.name);
    setDescription(product.description || "");
    setPrice(String(product.price));
    setStock(String(product.stock));
    setCategory(product.category || "");
    setCustomCategory("");
    setImage(null);
    setMediaFiles([]);
    void loadProductMedia(product.id);

    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  }

  async function loadProductMedia(productId: string) {
    const { data, error } = await supabase
      .from("product_media")
      .select("id,product_id,media_type,url,storage_path,sort_order")
      .eq("product_id", productId)
      .order("sort_order", { ascending: true });
    if (error) {
      setMessage("Não foi possível carregar as mídias deste produto: " + error.message);
      return;
    }
    setExistingMedia((data || []) as ProductMedia[]);
  }

  async function removeProductMedia(media: ProductMedia) {
    if (!window.confirm("Remover esta foto ou vídeo do produto?")) return;
    const { error: storageError } = await supabase.storage
      .from("products-media")
      .remove([media.storage_path]);
    if (storageError) {
      setMessage("Erro ao remover arquivo: " + storageError.message);
      return;
    }
    const { error } = await supabase.from("product_media").delete().eq("id", media.id);
    if (error) {
      setMessage("Arquivo removido, mas não foi possível atualizar o cadastro: " + error.message);
      return;
    }
    setExistingMedia((current) => current.filter((item) => item.id !== media.id));
    setMessage("Mídia removida.");
  }

  async function generateProductContent() {
    setAiGenerating(true);
    setAiNotes([]);
    setMessage("");

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) {
        throw new Error("Sua sessão expirou. Entre novamente no painel.");
      }

      let imageBase64 = "";
      let imageMimeType = "";

      if (image) {
        if (!["image/jpeg", "image/png", "image/webp"].includes(image.type)) {
          throw new Error("Para a análise com IA, use uma foto JPG, PNG ou WEBP.");
        }
        if (image.size > 2.5 * 1024 * 1024) {
          throw new Error("A foto deve ter no máximo 2,5 MB para análise.");
        }
        imageBase64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const dataUrl = String(reader.result || "");
            resolve(dataUrl.split(",")[1] || "");
          };
          reader.onerror = () => reject(new Error("Não foi possível ler a foto."));
          reader.readAsDataURL(image);
        });
        imageMimeType = image.type;
      }

      const existingImageUrl = editingId
        ? products.find((product) => product.id === editingId)?.image_url || ""
        : "";

      const response = await fetch("/api/admin/ai-product", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          name,
          description,
          category,
          imageBase64,
          imageMimeType,
          imageUrl: imageBase64 ? "" : existingImageUrl,
        }),
      });

      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || "Não foi possível gerar o conteúdo.");
      }

      if (result.nome_sugerido) setName(result.nome_sugerido);
      if (result.descricao) setDescription(result.descricao);

      const notes = [
        ...(Array.isArray(result.beneficios) ? result.beneficios.map((item: string) => `Benefício: ${item}`) : []),
        ...(Array.isArray(result.dados_a_confirmar) ? result.dados_a_confirmar.map((item: string) => `Confirmar: ${item}`) : []),
        ...(Array.isArray(result.palavras_chave) && result.palavras_chave.length
          ? [`Palavras-chave: ${result.palavras_chave.join(", ")}`]
          : []),
      ];
      setAiNotes(notes);
      setMessage("Conteúdo gerado pela IA. Revise e edite antes de salvar o produto. O preço e o estoque não foram alterados.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Erro ao gerar conteúdo com IA.");
    } finally {
      setAiGenerating(false);
    }
  }

  async function saveProduct(
    e: React.FormEvent<HTMLFormElement>
  ) {
    e.preventDefault();

    setSaving(true);
    setMessage("");

    try {
      let imageUrl: string | null = null;

      if (editingId) {
        imageUrl =
          products.find((p) => p.id === editingId)?.image_url || null;
      }

      if (image) {
        const extension = image.name.split(".").pop() || "jpg";
        const fileName = `${crypto.randomUUID()}.${extension}`;

        const { error: uploadError } = await supabase.storage
          .from("products-images")
          .upload(fileName, image, {
            upsert: false,
          });

        if (uploadError) {
          throw uploadError;
        }

        const { data } = supabase.storage
          .from("products-images")
          .getPublicUrl(fileName);

        imageUrl = data.publicUrl;
      }

      const productData = {
        name,
        description,
        price: Number(price),
        stock: Number(stock),
        category: category === "__custom__" ? customCategory.trim() : category,
        image_url: imageUrl,
        updated_at: new Date().toISOString(),
      };

      let savedProductId = editingId;

      if (editingId) {
        const { error } = await supabase
          .from("products")
          .update(productData)
          .eq("id", editingId);
        if (error) throw error;
        setMessage("Produto atualizado com sucesso!");
      } else {
        const { data: insertedProduct, error } = await supabase
          .from("products")
          .insert({ ...productData, active: true })
          .select("id")
          .single();
        if (error) throw error;
        savedProductId = insertedProduct.id;
        setMessage("Produto cadastrado com sucesso!");
      }

      if (savedProductId && mediaFiles.length) {
        for (let index = 0; index < mediaFiles.length; index++) {
          const file = mediaFiles[index];
          const isImage = file.type.startsWith("image/");
          const isVideo = file.type.startsWith("video/");
          if (!isImage && !isVideo) throw new Error(`Formato não permitido: ${file.name}`);
          if (file.size > 50 * 1024 * 1024) throw new Error(`${file.name}: o limite é 50 MB por arquivo.`);

          const extension = file.name.split(".").pop()?.toLowerCase() || (isImage ? "jpg" : "mp4");
          const storagePath = `${savedProductId}/${crypto.randomUUID()}.${extension}`;
          const { error: uploadError } = await supabase.storage
            .from("products-media")
            .upload(storagePath, file, { upsert: false, contentType: file.type });
          if (uploadError) throw uploadError;

          const { data: publicData } = supabase.storage
            .from("products-media")
            .getPublicUrl(storagePath);

          let posterUrl: string | null = null;
          if (isVideo) {
            const posterBlob = await createVideoPoster(file);
            const posterPath = savedProductId + "/posters/" + crypto.randomUUID() + ".jpg";
            const { error: posterUploadError } = await supabase.storage
              .from("products-media")
              .upload(posterPath, posterBlob, { upsert: false, contentType: "image/jpeg" });
            if (posterUploadError) throw posterUploadError;
            posterUrl = supabase.storage.from("products-media").getPublicUrl(posterPath).data.publicUrl;
          }

          const { error: mediaError } = await supabase.from("product_media").insert({
            product_id: savedProductId,
            media_type: isImage ? "image" : "video",
            url: publicData.publicUrl,
            storage_path: storagePath,
            poster_url: posterUrl,
            sort_order: existingMedia.length + index,
          });
          if (mediaError) throw mediaError;
        }
      }

      clearForm();
      await loadProducts();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Erro ao salvar produto."
      );
    } finally {
      setSaving(false);
    }
  }

  async function deleteProduct(id: string) {
    if (
      !window.confirm("Deseja realmente excluir este produto?")
    ) {
      return;
    }

    const { error } = await supabase
      .from("products")
      .delete()
      .eq("id", id);

    if (error) {
      setMessage("Erro ao excluir: " + error.message);
      return;
    }

    setMessage("Produto excluído com sucesso!");
    await loadProducts();
  }

  async function toggleActive(product: Product) {
    const { error } = await supabase
      .from("products")
      .update({
        active: !product.active,
      })
      .eq("id", product.id);

    if (error) {
      setMessage("Erro ao alterar situação: " + error.message);
      return;
    }

    await loadProducts();
  }

  async function refreshDashboard() {
    if (refreshing) return;
    setRefreshing(true);
    setMessage("");

    try {
      await Promise.all([
        loadProducts(),
        loadOrders(),
        loadAnalytics(),
      ]);
    } finally {
      setRefreshing(false);
    }
  }

  function handleAdminTouchStart(event: React.TouchEvent<HTMLElement>) {
    if (window.scrollY <= 2 && event.touches.length === 1) {
      touchStartY.current = event.touches[0].clientY;
    } else {
      touchStartY.current = null;
    }
  }

  function handleAdminTouchEnd(event: React.TouchEvent<HTMLElement>) {
    if (touchStartY.current === null) return;
    const distance = event.changedTouches[0].clientY - touchStartY.current;
    touchStartY.current = null;
    if (distance > 90 && window.scrollY <= 2) {
      void refreshDashboard();
    }
  }

  async function logout() {
    await supabase.auth.signOut();
    router.replace("/admin/login");
  }

  if (loading) {
    return (
      <main style={{ padding: 30 }}>
        Carregando painel...
      </main>
    );
  }

  if (!authorized) {
    return null;
  }

  return (
    <main
      className="admin-dashboard"
      onTouchStart={handleAdminTouchStart}
      onTouchEnd={handleAdminTouchEnd}
      style={{
        maxWidth: 1100,
        margin: "auto",
        padding: 20,
        fontFamily: "Arial, sans-serif",
      }}
    >
      <header className="admin-header"
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div>
          <h1>Painel administrativo</h1>
          <p>Gerencie os produtos da sua loja.</p>
          <button onClick={() => router.push("/admin/orders")} style={{ ...buttonStyle, background: "#ffc928", color: "#06183d", fontWeight: 800 }}>Pedidos e entregas</button>
          <button onClick={() => router.push("/admin/estoque")} style={{ ...buttonStyle, background: "#173b68", color: "#ffffff", fontWeight: 800 }}>Estoque</button>
          <button onClick={() => router.push("/admin/avaliacoes")} style={buttonStyle}>Gestão de avaliações</button>
          <button onClick={() => router.push("/admin/cupons")} style={buttonStyle}>Cupons de desconto</button>
          <button onClick={() => router.push("/admin/publicidade")} style={{ ...buttonStyle, background: "#ffc928", color: "#06183d", fontWeight: 800 }}>Publicidade e Promoções</button>
        </div>

        <button onClick={logout} style={buttonStyle}>
          Sair
        </button>
      </header>

      {refreshing && (
        <p role="status" style={{ color: "#173b68", fontWeight: 700, textAlign: "center" }}>
          Atualizando painel...
        </p>
      )}

      <hr />

      <h2>Visão geral dos produtos</h2>

      <section style={dashboardGrid}>
        <DashboardCard
          title="Total de produtos"
          value={String(products.length)}
          detail="Produtos cadastrados"
        />
        <DashboardCard
          title="Produtos ativos"
          value={String(products.filter((product) => product.active).length)}
          detail="Visíveis conforme as regras da loja"
        />
        <DashboardCard
          title="Produtos inativos"
          value={String(products.filter((product) => !product.active).length)}
          detail="Desativados no cadastro"
        />
        <DashboardCard
          title="Estoque baixo"
          value={String(products.filter((product) => Number(product.stock) > 0 && Number(product.stock) <= 5).length)}
          detail="Com 1 a 5 unidades disponíveis"
        />
        <DashboardCard
          title="Sem estoque"
          value={String(products.filter((product) => Number(product.stock) <= 0).length)}
          detail="Precisam de reposição"
        />
      </section>

      <h2>Acessos da loja — últimos 30 dias</h2>
      <p style={{ color: "#666", marginTop: 4 }}>Dados registrados pela própria NovaShopp. Visitantes são identificados por navegador, sem nome ou e-mail.</p>
      <section style={dashboardGrid}>
        <DashboardCard title="Visitantes" value={String(uniqueVisitors)} detail="Navegadores únicos registrados" />
        <DashboardCard title="Visualizações" value={String(pageViewCount)} detail="Páginas e produtos visualizados" />
      </section>
      {analyticsMessage && <p role="status" style={{ color: "#9a3412" }}>{analyticsMessage}</p>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16, marginTop: 16 }}>
        <section style={dashboardCardStyle}>
          <h3 style={{ marginTop: 0 }}>Páginas mais acessadas</h3>
          {topPages.length ? topPages.map(([path, count]) => <p key={path} style={{ display: "flex", justifyContent: "space-between", gap: 12 }}><span style={{ overflowWrap: "anywhere" }}>{path}</span><strong>{count}</strong></p>) : <p>Aguardando os primeiros acessos.</p>}
        </section>
        <section style={dashboardCardStyle}>
          <h3 style={{ marginTop: 0 }}>Produtos mais visualizados</h3>
          {topProducts.length ? topProducts.map(([id, item]) => <p key={id} style={{ display: "flex", justifyContent: "space-between", gap: 12 }}><span>{item.name}</span><strong>{item.count}</strong></p>) : <p>Aguardando visualizações de produtos.</p>}
        </section>
      </div>

      <h2>Resumo financeiro</h2>

      <section style={dashboardGrid}>
        <DashboardCard
          title="Total vendido"
          value={formatCurrency(totalSold)}
          detail="Soma dos pedidos pagos"
        />

        <DashboardCard
          title="Pedidos pagos"
          value={String(paidOrders.length)}
          detail="Vendas confirmadas"
        />

        <DashboardCard
          title="Aguardando pagamento"
          value={String(waitingOrders.length)}
          detail="Pedidos pendentes"
        />

        <DashboardCard
          title="Pedidos cancelados"
          value={String(cancelledOrders.length)}
          detail="Pedidos cancelados"
        />

        <DashboardCard
          title="Faturamento de hoje"
          value={formatCurrency(revenueToday)}
          detail={`${todayOrders.length} pedido(s) pago(s) hoje`}
        />

        <DashboardCard
          title="Faturamento do mês"
          value={formatCurrency(revenueMonth)}
          detail={`${monthOrders.length} pedido(s) pago(s) neste mês`}
        />
      </section>

      <button
        onClick={refreshDashboard}
        style={buttonStyle}
      >
        {refreshing ? "Atualizando..." : "Atualizar painel"}
      </button>

      <hr />

      <h2>
        {editingId ? "Editar produto" : "Cadastrar produto"}
      </h2>

      <form className="admin-product-form" onSubmit={saveProduct} style={formStyle}>
        <label>Nome do produto</label>

        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          style={inputStyle}
        />

        <label>Informações e características do produto</label>

        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          style={inputStyle}
          rows={5}
          placeholder="Informe o que você sabe sobre o produto: funções, recursos, material, medidas, compatibilidade, modelo e diferenciais. A IA usará esses dados para criar uma descrição completa."
        />

        <label>Preço (R$)</label>

        <input
          type="number"
          min="0"
          step="0.01"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          required
          style={inputStyle}
        />

        <label>Estoque</label>

        <input
          type="number"
          min="0"
          step="1"
          value={stock}
          onChange={(e) => setStock(e.target.value)}
          required
          style={inputStyle}
        />

        <label>Categoria</label>

        <select
          value={category}
          onChange={(e) => {
            setCategory(e.target.value);
            if (e.target.value !== "__custom__") setCustomCategory("");
          }}
          style={inputStyle}
        >
          <option value="">Selecione uma categoria</option>
          {[...new Set([
            "Eletrônicos",
            "Acessórios",
            "Casa",
            "Moda",
            "Games",
            "Segurança eletrônica",
            ...products.map((item) => item.category?.trim()).filter(Boolean) as string[],
          ])].sort((a, b) => a.localeCompare(b, "pt-BR")).map((item) => (
            <option key={item} value={item}>{item}</option>
          ))}
          <option value="__custom__">＋ Adicionar nova categoria</option>
        </select>

        {category === "__custom__" && (
          <input
            value={customCategory}
            onChange={(e) => setCustomCategory(e.target.value)}
            placeholder="Digite o nome da nova categoria"
            required
            style={inputStyle}
          />
        )}

        <label>Foto principal do produto</label>

        <input
          id="product-image"
          type="file"
          accept="image/*"
          onChange={(e) =>
            setImage(e.target.files?.[0] || null)
          }
          style={inputStyle}
        />

        <label>Fotos adicionais e vídeos</label>
        <input
          id="product-media"
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime"
          multiple
          onChange={(e) => setMediaFiles(Array.from(e.target.files || []))}
          style={inputStyle}
        />
        <small style={{ display: "block", marginTop: -10, marginBottom: 14, color: "#64748b" }}>
          Selecione várias fotos e vídeos de uma vez. Até 50 MB por arquivo.
        </small>

        {mediaFiles.length > 0 && (
          <p style={{ color: "#173b68", fontWeight: 700 }}>
            {mediaFiles.length} arquivo(s) selecionado(s) para adicionar.
          </p>
        )}

        {existingMedia.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(100px,1fr))", gap: 10, marginBottom: 16 }}>
            {existingMedia.map((media) => (
              <div key={media.id} style={{ border: "1px solid #dbe3ef", borderRadius: 10, padding: 6 }}>
                {media.media_type === "image" ? (
                  <img src={media.url} alt="Mídia do produto" style={{ width: "100%", height: 90, objectFit: "contain" }} />
                ) : (
                  <video src={media.url} controls playsInline style={{ width: "100%", height: 90, objectFit: "contain" }} />
                )}
                <button type="button" onClick={() => removeProductMedia(media)} style={{ ...buttonStyle, width: "100%", background: "#9f2525", padding: 7, fontSize: 12 }}>
                  Remover
                </button>
              </div>
            ))}
          </div>
        )}

        <button
          type="button"
          onClick={generateProductContent}
          disabled={aiGenerating || saving}
          style={{
            ...buttonStyle,
            background: "#173b68",
            opacity: aiGenerating ? 0.7 : 1,
            padding: "14px 18px",
            fontWeight: 700,
          }}
        >
          {aiGenerating ? "Analisando produto com IA..." : "✨ Melhorar nome e descrição com IA"}
        </button>

        <small style={{ color: "#555", marginBottom: 12 }}>
          A IA prioriza a descrição do produto, suas características e benefícios confirmados. Informe detalhes neste campo e selecione a foto para ajudar na análise.
          O resultado será colocado nos campos para sua revisão. Preço e estoque permanecem manuais.
        </small>

        {aiNotes.length > 0 && (
          <div style={{ background: "#fff8df", border: "1px solid #f0d98a", borderRadius: 8, padding: 12, marginBottom: 12 }}>
            <strong>Revisão sugerida pela IA</strong>
            <ul style={{ marginBottom: 0, paddingLeft: 20 }}>
              {aiNotes.map((note, index) => <li key={index}>{note}</li>)}
            </ul>
          </div>
        )}

        <button
          type="submit"
          disabled={saving}
          style={buttonStyle}
        >
          {saving
            ? "Salvando..."
            : editingId
              ? "Atualizar produto"
              : "Cadastrar produto"}
        </button>

        {editingId && (
          <button
            type="button"
            onClick={clearForm}
            style={buttonStyle}
          >
            Cancelar edição
          </button>
        )}
      </form>

      {message && (
        <p
          style={{
            padding: 12,
            background: "#eeeeee",
            borderRadius: 8,
          }}
        >
          {message}
        </p>
      )}

      <hr />

      <h2>
        Produtos cadastrados ({products.length})
      </h2>

      {products.length === 0 && (
        <p>Nenhum produto cadastrado ainda.</p>
      )}

      {products.map((product) => (
        <article
          className="admin-product-card"
          key={product.id}
          style={{
            border: "1px solid #dddddd",
            borderRadius: 10,
            padding: 15,
            marginBottom: 12,
          }}
        >
          <div
            style={{
              display: "flex",
              gap: 15,
              flexWrap: "wrap",
            }}
          >
            {product.image_url && (
              <img
                src={product.image_url}
                alt={product.name}
                style={{
                  width: 90,
                  height: 90,
                  objectFit: "contain",
                }}
              />
            )}

            <div style={{ flex: 1 }}>
              <h3>{product.name}</h3>
              <p>
                Preço: {formatCurrency(Number(product.price))}
              </p>
              <p>Estoque: {product.stock}</p>
              <p>
                Categoria: {product.category || "Sem categoria"}
              </p>
              <p>
                Situação: {product.active ? "Ativo" : "Inativo"}
              </p>
            </div>
          </div>

          <div
            style={{
              display: "flex",
              gap: 8,
              flexWrap: "wrap",
            }}
          >
            <button
              onClick={() => editProduct(product)}
              style={buttonStyle}
            >
              Editar
            </button>

            <button
              onClick={() => toggleActive(product)}
              style={buttonStyle}
            >
              {product.active ? "Desativar" : "Ativar"}
            </button>

            <button
              onClick={() => deleteProduct(product.id)}
              style={{
                ...buttonStyle,
                background: "#b42318",
              }}
            >
              Excluir
            </button>
          </div>
        </article>
      ))}
    </main>
  );
}
