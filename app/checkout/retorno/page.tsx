export const dynamic = "force-dynamic";

export default function CheckoutReturnPage() {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: 24,
        background: "#f5f7fb",
      }}
    >
      <section
        aria-labelledby="checkout-return-title"
        style={{
          width: "100%",
          maxWidth: 560,
          padding: 32,
          borderRadius: 18,
          background: "#fff",
          boxShadow: "0 12px 40px rgba(15, 23, 42, 0.08)",
          textAlign: "center",
        }}
      >
        <div
          aria-hidden="true"
          style={{
            width: 56,
            height: 56,
            margin: "0 auto 18px",
            display: "grid",
            placeItems: "center",
            borderRadius: "50%",
            background: "#e8eefb",
            color: "#17366b",
            fontSize: 28,
            fontWeight: 800,
          }}
        >
          N
        </div>
        <p style={{ margin: "0 0 8px", color: "#64748b", fontWeight: 700, letterSpacing: 1 }}>
          NOVASHOPP STORE
        </p>
        <h1 id="checkout-return-title" style={{ margin: "0 0 14px", color: "#102a56", fontSize: 26 }}>
          Retorno do pagamento
        </h1>
        <p style={{ margin: "0 0 12px", color: "#334155", lineHeight: 1.65 }}>
          Você retornou do ambiente do Mercado Pago. Estamos aguardando a confirmação oficial da transação.
        </p>
        <p style={{ margin: "0 0 24px", color: "#64748b", fontSize: 14, lineHeight: 1.6 }}>
          O resultado exibido nesta página não confirma, por si só, que o pagamento foi aprovado. A confirmação depende da validação segura feita pela loja junto ao Mercado Pago.
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 12 }}>
          <a
            href="/acompanhar"
            style={{
              display: "inline-block",
              padding: "12px 18px",
              borderRadius: 9,
              background: "#102a56",
              color: "#fff",
              fontWeight: 700,
              textDecoration: "none",
            }}
          >
            Acompanhar pedido
          </a>
          <a
            href="/"
            style={{
              display: "inline-block",
              padding: "12px 18px",
              border: "1px solid #cbd5e1",
              borderRadius: 9,
              color: "#102a56",
              fontWeight: 700,
              textDecoration: "none",
            }}
          >
            Voltar à loja
          </a>
        </div>
      </section>
    </main>
  );
}
