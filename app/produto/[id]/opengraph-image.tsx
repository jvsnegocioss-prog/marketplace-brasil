import { ImageResponse } from "next/og";
import { createClient } from "@supabase/supabase-js";

export const runtime = "edge";
export const alt = "Produto da NovaShopp Store";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

type Props = {
  params: Promise<{ id: string }>;
};

export default async function OpenGraphImage({ params }: Props) {
  const { id } = await params;
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
  const { data } = await supabase
    .from("products")
    .select("name,image_url")
    .eq("id", id)
    .eq("active", true)
    .maybeSingle();

  const productName = data?.name || "Conheça nossos produtos";
  const { data: gallery } = await supabase
    .from("product_media")
    .select("url")
    .eq("product_id", id)
    .eq("media_type", "image")
    .order("sort_order", { ascending: true })
    .limit(1)
    .maybeSingle();

  const imageUrl =
    (typeof data?.image_url === "string" && data.image_url.trim()) ||
    (typeof gallery?.url === "string" && gallery.url.trim()) ||
    null;

  let productImage: string | null = null;
  if (imageUrl) {
    try {
      const imageResponse = await fetch(imageUrl, { headers: { Accept: "image/*" } });
      if (imageResponse.ok) {
        const contentType = imageResponse.headers.get("content-type") || "image/jpeg";
        if (contentType.startsWith("image/")) {
          const bytes = new Uint8Array(await imageResponse.arrayBuffer());
          let binary = "";
          for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
          productImage = "data:" + contentType + ";base64," + btoa(binary);
        }
      }
    } catch (error) {
      console.error("Não foi possível carregar a imagem do produto para o banner:", error);
    }
  }

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "64px 76px",
          background: "linear-gradient(135deg, #071b38 0%, #123b69 58%, #1b527e 100%)",
          color: "#ffffff",
          fontFamily: "Arial, sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div
            style={{
              width: 76,
              height: 76,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: 20,
              background: "#ffc928",
              color: "#102e58",
              fontSize: 54,
              fontWeight: 900,
            }}
          >
            N
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ fontSize: 42, fontWeight: 900, letterSpacing: 1 }}>NOVASHOPP STORE</div>
            <div style={{ color: "#fbd96b", fontSize: 21, letterSpacing: 3 }}>TUDO O QUE VOCÊ PRECISA, EM UM SÓ LUGAR</div>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 42, flex: 1, marginTop: 30, marginBottom: 24 }}>
          <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", gap: 20, flex: 1, minWidth: 0 }}>
            <div style={{ color: "#fbd96b", fontSize: 25, fontWeight: 700, letterSpacing: 4 }}>CONFIRA ESTE PRODUTO</div>
            <div
              style={{
                display: "flex",
                fontSize: productName.length > 48 ? 48 : 62,
                lineHeight: 1.12,
                fontWeight: 900,
                overflow: "hidden",
                maxHeight: 210,
                wordBreak: "break-word",
              }}
            >
              {productName}
            </div>
            <div style={{ width: 150, height: 8, borderRadius: 8, background: "#ffc928" }} />
          </div>
          {productImage ? (
            <div
              style={{
                display: "flex",
                width: 430,
                height: 350,
                flexShrink: 0,
                alignItems: "center",
                justifyContent: "center",
                padding: 18,
                borderRadius: 26,
                background: "#ffffff",
                border: "5px solid #ffc928",
                boxShadow: "0 14px 35px rgba(0,0,0,.22)",
              }}
            >
              <img
                src={productImage}
                alt={productName}
                width={390}
                height={310}
                style={{ width: "390px", height: "310px", objectFit: "contain" }}
              />
            </div>
          ) : (
            <div
              style={{
                display: "flex",
                width: 430,
                height: 350,
                flexShrink: 0,
                alignItems: "center",
                justifyContent: "center",
                borderRadius: 26,
                background: "rgba(255,255,255,.12)",
                border: "2px solid rgba(255,201,40,.65)",
                color: "#fbd96b",
                fontSize: 30,
                fontWeight: 800,
              }}
            >
              NOVASHOPP STORE
            </div>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", color: "#d8e6f6", fontSize: 22 }}>
          <span>novashoppstore.vercel.app</span>
          <span style={{ color: "#ffc928", fontWeight: 800 }}>NOVA SHOPP • OFICIAL</span>
        </div>
      </div>
    ),
    { ...size }
  );
}
