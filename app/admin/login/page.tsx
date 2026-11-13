"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

export default function AdminLogin() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleLogin(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (error) {
      setError("E-mail ou senha incorretos. Confira seus dados e tente novamente.");
      setLoading(false);
      return;
    }

    router.push("/admin");
  }

  return (
    <main className="customer-account-page admin-login-page">
      <section className="customer-account-card admin-login-card">
        <Link className="customer-account-back" href="/">
          ← Voltar para a NOVASHOPP STORE
        </Link>

        <div className="customer-account-brand" aria-label="NOVASHOPP STORE">N</div>
        <p className="customer-account-eyebrow">ACESSO RESTRITO</p>
        <h1>Painel administrativo</h1>
        <p className="customer-account-intro">
          Entre com seu e-mail e senha de administrador para gerenciar sua loja.
        </p>

        <form onSubmit={handleLogin} className="customer-account-form">
          <label>
            E-mail
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
              placeholder="seu@email.com"
              required
            />
          </label>

          <label>
            Senha
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              placeholder="Digite sua senha"
              required
            />
          </label>

          <button
            type="submit"
            className="customer-account-submit"
            disabled={loading}
          >
            {loading ? "Entrando..." : "Entrar no painel"}
          </button>
        </form>

        {error && <p role="alert" className="customer-account-error">{error}</p>}

        <p className="customer-account-footnote">
          Área exclusiva para usuários autorizados da NOVASHOPP STORE.
        </p>
      </section>
    </main>
  );
}
