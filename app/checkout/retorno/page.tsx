"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type CheckoutOrder = {
  orderId: string;
  orderNumber: string | null;
  orderStatus: string;
  paymentState: "approved" | "cancelled" | "pending" | "under_review";
  deliveryStatus: string | null;
  createdAt: string;
};

export default function CheckoutReturnPage() {
  const [order, setOrder] = useState<CheckoutOrder | null>(null);
  const [message, setMessage] = useState("Validando o retorno e consultando a confirmação do pedido...");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    async function checkOrder() {
      const params = new URLSearchParams(window.location.search);
      const orderId = params.get("pedido") || "";
      const signature = params.get("verificacao") || "";
      if (!orderId || !signature) {
        if (active) {
          setError("Não encontramos uma referência segura para consultar este pedido. Acesse sua conta ou fale com nosso atendimento.");
          setLoading(false);
        }
        return;
      }

      let accessToken = "";
      try {
        const { data } = await supabase.auth.getSession();
        accessToken = data.session?.access_token || "";
      } catch {
        // O link assinado também permite consultar compras feitas como visitante.
      }

      for (let attempt = 0; attempt < 5 && active; attempt += 1) {
        try {
          const response = await fetch(`/api/checkout/estado?pedido=${encodeURIComponent(orderId)}&verificacao=${encodeURIComponent(signature)}`, {
            headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
            cache: "no-store",
          });
          const result = await response.json();
          if (!response.ok) throw new Error(result.error || "Não foi possível consultar o pedido.");
          if (!active) return;
          setOrder(result.order as CheckoutOrder);
          setError("");
          if (result.order.paymentState === "approved") {
            setMessage("Pagamento confirmado pela loja. Seu pedido está registrado.");
            setLoading(false);
            return;
          }
          if (result.order.paymentState === "cancelled") {
            setMessage("O pedido consta como cancelado. Se você acredita que houve cobrança, entre em contato com o atendimento antes de tentar novamente.");
            setLoading(false);
            return;
          }
          setMessage("Ainda aguardamos a confirmação do Mercado Pago. Esta página consulta o estado registrado pela loja, não apenas a informação de retorno do navegador.");
        } catch (err) {
          if (!active) return;
          setError(err instanceof Error ? err.message : "Falha ao consultar o pedido.");
          setLoading(false);
          return;
        }

        if (attempt < 4) await new Promise((resolve) => setTimeout(resolve, 2500));
      }

      if (active) setLoading(false);
    }

    checkOrder();
    return () => { active = false; };
  }, []);

  const approved = order?.paymentState === "approved";
  const cancelled = order?.paymentState === "cancelled";

  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24, background: "#f5f7fb" }}>
      <section aria-labelledby="checkout-return-title" style={{ width: "100%", maxWidth: 560, padding: 32, borderRadius: 18, background: "#fff", boxShadow: "0 12px 40px rgba(15, 23, 42, 0.08)", textAlign: "center" }}>
        <div aria-hidden="true" style={{ width: 56, height: 56, margin: "0 auto 18px", display: "grid", placeItems: "center", borderRadius: "50%", background: approved ? "#e6f6ec" : cancelled ? "#fff0f0" : "#e8eefb", color: approved ? "#187443" : cancelled ? "#a52a2a" : "#17366b", fontSize: 28, fontWeight: 800 }}>
          {approved ? "✓" : cancelled ? "!" : "N"}
        </div>
        <p style={{ margin: "0 0 8px", color: "#64748b", fontWeight: 700, letterSpacing: 1 }}>NOVASHOPP STORE</p>
        <h1 id="checkout-return-title" style={{ margin: "0 0 14px", color: "#102a56", fontSize: 26 }}>Retorno do pagamento</h1>
        {order && <p style={{ margin: "0 0 12px", color: "#334155" }}>Pedido <strong>{order.orderNumber || order.orderId}</strong></p>}
        <p role="status" aria-live="polite" style={{ margin: "0 0 12px", color: "#334155", lineHeight: 1.65 }}>{message}</p>
        {loading && <p style={{ color: "#64748b", fontSize: 14 }}>Aguarde enquanto verificamos a atualização...</p>}
        {error && <p role="alert" style={{ color: "#a52a2a", fontSize: 14, lineHeight: 1.6 }}>{error}</p>}
        {order && !approved && !cancelled && !loading && <p style={{ color: "#64748b", fontSize: 14, lineHeight: 1.6 }}>O status atual é: {order.orderStatus}. Você pode consultar novamente em alguns instantes na área do cliente.</p>}
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 12, marginTop: 24 }}>
          <a href="/conta" style={{ display: "inline-block", padding: "12px 18px", borderRadius: 9, background: "#102a56", color: "#fff", fontWeight: 700, textDecoration: "none" }}>Minha conta</a>
          <a href="/acompanhar" style={{ display: "inline-block", padding: "12px 18px", border: "1px solid #cbd5e1", borderRadius: 9, color: "#102a56", fontWeight: 700, textDecoration: "none" }}>Acompanhar pedido</a>
          <a href="/" style={{ display: "inline-block", padding: "12px 18px", border: "1px solid #cbd5e1", borderRadius: 9, color: "#102a56", fontWeight: 700, textDecoration: "none" }}>Voltar à loja</a>
        </div>
      </section>
    </main>
  );
}
