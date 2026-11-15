import type { Metadata } from "next";
import { createClient } from "@supabase/supabase-js";

type Props = {
  params: Promise<{ id: string }>;
};

const fallbackMetadata: Metadata = {
  title: "NovaShopp Store",
  description: "Confira nossos produtos na NovaShopp Store.",
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;

  // Inicializa o Supabase somente quando a função de metadata for executada.
  // Durante a coleta de configuração do Next.js, o Preview pode não ter
  // credenciais públicas disponíveis; nesse caso, usa metadata genérica.
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return fallbackMetadata;
  }

  const supabase = createClient(supabaseUrl, supabaseKey);
  const { data: product } = await supabase
    .from("products")
    .select("name,description,image_url")
    .eq("id", id)
    .eq("active", true)
    .maybeSingle();

  const productName = product?.name || "Conheça nossos produtos";
  const title = `${productName} | NovaShopp Store`;
  const description = product?.description
    ? String(product.description).slice(0, 180)
    : `Confira ${productName} na NovaShopp Store. Tudo o que você precisa, em um só lugar!`;
  const image = `/produto/${encodeURIComponent(id)}/opengraph-image`;

  return {
    title,
    description,
    openGraph: {
      type: "website",
      siteName: "NovaShopp Store",
      title,
      description,
      url: `https://novashoppstore.vercel.app/produto/${encodeURIComponent(id)}`,
      images: [{ url: image, width: 1200, height: 630, alt: `${productName} — NovaShopp Store` }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [image],
    },
  };
}

export default function ProductLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
