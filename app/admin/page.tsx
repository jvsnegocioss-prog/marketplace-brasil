"use client";

import { useEffect, useState } from "react";
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

export default function AdminPage() {
  const router = useRouter();

  const [authorized, setAuthorized] = useState(false);
  const [loading, setLoading] = useState(true);
  const [products, setProducts] = useState<Product[]>([]);
  const [message, setMessage] = useState("");

  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [stock, setStock] = useState("0");
  const [category, setCategory] = useState("");
  const [image, setImage] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    async function checkAdmin() {
      const { data: userData } = await supabase.auth.getUser();

      if (!userData.user) {
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
      await loadProducts();
      setLoading(false);
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

  function clearForm() {
    setEditingId(null);
    setName("");
    setDescription("");
    setPrice("");
    setStock("0");
    setCategory("");
    setImage(null);

    const fileInput = document.getElementById(
      "product-image"
    ) as HTMLInputElement | null;

    if (fileInput) fileInput.value = "";
  }

  function editProduct(product: Product) {
    setEditingId(product.id);
    setName(product.name);
    setDescription(product.description || "");
    setPrice(String(product.price));
    setStock(String(product.stock));
    setCategory(product.category || "");
    setImage(null);

    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function saveProduct(e: React.FormEvent<HTMLFormElement>) {
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
        const filePath = `${fileName}`;

        const { error: uploadError } = await supabase.storage
          .from("products-images")
          .upload(filePath, image, { upsert: false });

        if (uploadError) throw uploadError;

        const { data } = supabase.storage
          .from("products-images")
          .getPublicUrl(filePath);

        imageUrl = data.publicUrl;
      }

      const productData = {
        name,
        description,
        price: Number(price),
        stock: Number(stock),
        category,
        image_url: imageUrl,
        updated_at: new Date().toISOString(),
      };

      if (editingId) {
        const { error } = await supabase
          .from("products")
          .update(productData)
          .eq("id", editingId);

        if (error) throw error;

        setMessage("Produto atualizado com sucesso!");
      } else {
        const { error } = await supabase
          .from("products")
          .insert({ ...productData, active: true });

        if (error) throw error;

        setMessage("Produto cadastrado com sucesso!");
      }

      clearForm();
      await loadProducts();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Erro ao salvar produto."
      );
    } finally {
      setSaving(false);
    }
  }

  async function deleteProduct(id: string) {
    if (!window.confirm("Deseja realmente excluir este produto?")) return;

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
      .update({ active: !product.active })
      .eq("id", product.id);

    if (error) {
      setMessage("Erro ao alterar situação: " + error.message);
      return;
    }

    await loadProducts();
  }

  async function logout() {
    await supabase.auth.signOut();
    router.replace("/admin/login");
  }

  if (loading) {
    return <main style={{ padding: 30 }}>Carregando painel...</main>;
  }

  if (!authorized) return null;

  return (
    <main
      style={{
        maxWidth: 1000,
        margin: "auto",
        padding: 20,
        fontFamily: "Arial, sans-serif",
      }}
    >
      <header
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
        </div>

        <button onClick={logout} style={buttonStyle}>
          Sair
        </button>
      </header>

      <hr />

      <h2>{editingId ? "Editar produto" : "Cadastrar produto"}</h2>

      <form onSubmit={saveProduct} style={formStyle}>
        <label>Nome do produto</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          style={inputStyle}
        />

        <label>Descrição</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          style={inputStyle}
          rows={3}
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
        <input
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          style={inputStyle}
        />

        <label>Foto do produto</label>
        <input
          id="product-image"
          type="file"
          accept="image/*"
          onChange={(e) => setImage(e.target.files?.[0] || null)}
          style={inputStyle}
        />

        <button type="submit" disabled={saving} style={buttonStyle}>
          {saving
            ? "Salvando..."
            : editingId
              ? "Atualizar produto"
              : "Cadastrar produto"}
        </button>

        {editingId && (
          <button type="button" onClick={clearForm} style={buttonStyle}>
            Cancelar edição
          </button>
        )}
      </form>

      {message && (
        <p style={{ padding: 12, background: "#eeeeee", borderRadius: 8 }}>
          {message}
        </p>
      )}

      <hr />

      <h2>Produtos cadastrados ({products.length})</h2>

      {products.length === 0 && <p>Nenhum produto cadastrado ainda.</p>}

      {products.map((product) => (
        <article
          key={product.id}
          style={{
            border: "1px solid #dddddd",
            borderRadius: 10,
            padding: 15,
            marginBottom: 12,
          }}
        >
          <div style={{ display: "flex", gap: 15, flexWrap: "wrap" }}>
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
              <p>Preço: R$ {Number(product.price).toFixed(2)}</p>
              <p>Estoque: {product.stock}</p>
              <p>Categoria: {product.category || "Sem categoria"}</p>
              <p>Situação: {product.active ? "Ativo" : "Inativo"}</p>
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button onClick={() => editProduct(product)} style={buttonStyle}>
              Editar
            </button>

            <button onClick={() => toggleActive(product)} style={buttonStyle}>
              {product.active ? "Desativar" : "Ativar"}
            </button>

            <button
              onClick={() => deleteProduct(product.id)}
              style={{ ...buttonStyle, background: "#b42318" }}
            >
              Excluir
            </button>
          </div>
        </article>
      ))}
    </main>
  );
}

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
