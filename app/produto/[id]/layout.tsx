import type { Metadata } from "next";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

type Props = {
  params: Promise<{ id: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
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
