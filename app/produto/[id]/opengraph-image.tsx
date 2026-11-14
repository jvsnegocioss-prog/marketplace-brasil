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
    .select("name")
    .eq("id", id)
    .eq("active", true)
    .maybeSingle();

  const productName = data?.name || "Conheça nossos produtos";

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

        <div style={{ display: "flex", flexDirection: "column", gap: 18, maxWidth: 1040 }}>
          <div style={{ color: "#fbd96b", fontSize: 25, fontWeight: 700, letterSpacing: 4 }}>CONFIRA ESTE PRODUTO</div>
          <div
            style={{
              display: "flex",
              fontSize: productName.length > 48 ? 54 : 68,
              lineHeight: 1.12,
              fontWeight: 900,
              overflow: "hidden",
              maxHeight: 170,
              wordBreak: "break-word",
            }}
          >
            {productName}
          </div>
          <div style={{ width: 150, height: 8, borderRadius: 8, background: "#ffc928" }} />
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
