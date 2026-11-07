import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Marketplace Brasil | Sua próxima descoberta",
  description: "Tecnologia, acessórios, casa, moda e muito mais em um só lugar."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="pt-BR"><body>{children}</body></html>;
}