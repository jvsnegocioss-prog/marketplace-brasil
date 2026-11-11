import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "NovaShopp Store | Tudo o que você precisa, em um só lugar!",
  description:
    "NovaShopp Store: tecnologia, variedades, ofertas e praticidade em um só lugar. Compre fácil, receba rápido.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
