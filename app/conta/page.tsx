"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type AccountUser = {
  email?: string;
  user_metadata?: { full_name?: string };
};

export default function ContaClientePage() {
  const [user, setUser] = useState<AccountUser | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"login" | "register">("login");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setUser(data.session?.user ?? null));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    setLoading(true);

    try {
      if (mode === "register") {
        const { data, error: authError } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { data: { full_name: name.trim() } },
        });

        if (authError) throw authError;
        if (data.session) {
          setMessage("Cadastro realizado! Sua conta já está ativa.");
        } else {
          setMessage("Cadastro iniciado! Confira seu e-mail para confirmar a conta e depois entre por aqui.");
        }
      } else {
        const { error: authError } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (authError) throw authError;
        setMessage("Login realizado com sucesso.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível concluir. Tente novamente.");
    } finally {
      setLoading(false);
    }
  }

  async function handleLogout() {
    setError("");
    const { error: authError } = await supabase.auth.signOut();
    if (authError) setError("Não foi possível sair da conta. Tente novamente.");
    else setMessage("Você saiu da sua conta.");
  }

  return (
    <main className="customer-account-page">
      <section className="customer-account-card">
        <a className="customer-account-back" href="/">← Voltar para a NOVASHOPP STORE</a>
        <div className="customer-account-brand">N</div>
        <p className="customer-account-eyebrow">ÁREA DO CLIENTE</p>
        {user ? (
          <>
            <h1>Bem-vindo à sua conta!</h1>
            <p className="customer-account-intro">Acesse sua área de cliente da NOVASHOPP STORE.</p>
            <div className="customer-account-profile">
              <span className="customer-account-avatar">👤</span>
              <div>
                <strong>{user.user_metadata?.full_name || "Cliente NOVASHOPP"}</strong>
                <p>{user.email}</p>
              </div>
            </div>
            <div className="customer-account-notice">
              Sua conta está ativa. A consulta de pedidos continuará disponível na página de acompanhamento enquanto preparamos o histórico integrado à conta.
            </div>
            <a className="customer-account-secondary" href="/acompanhar">Acompanhar um pedido</a>
            <button className="customer-account-submit" type="button" onClick={handleLogout}>Sair da conta</button>
            {message && <p className="customer-account-success">{message}</p>}
            {error && <p className="customer-account-error">{error}</p>}
          </>
        ) : (
          <>
            <h1>{mode === "login" ? "Entre na sua conta" : "Crie sua conta"}</h1>
            <p className="customer-account-intro">
              {mode === "login" ? "Acesse sua área exclusiva de cliente." : "Cadastre-se para ter sua conta na NOVASHOPP STORE."}
            </p>
            <div className="customer-account-tabs">
              <button type="button" className={mode === "login" ? "active" : ""} onClick={() => { setMode("login"); setError(""); setMessage(""); }}>Entrar</button>
              <button type="button" className={mode === "register" ? "active" : ""} onClick={() => { setMode("register"); setError(""); setMessage(""); }}>Criar conta</button>
            </div>
            <form onSubmit={handleSubmit} className="customer-account-form">
              {mode === "register" && (
                <label>Nome completo
                  <input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" required placeholder="Seu nome" />
                </label>
              )}
              <label>E-mail
                <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required placeholder="voce@email.com" />
              </label>
              <label>Senha
                <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={mode === "login" ? "current-password" : "new-password"} minLength={8} required placeholder="Mínimo de 8 caracteres" />
              </label>
              <button className="customer-account-submit" type="submit" disabled={loading}>
                {loading ? "Aguarde..." : mode === "login" ? "Entrar na minha conta" : "Criar minha conta"}
              </button>
            </form>
            {message && <p className="customer-account-success">{message}</p>}
            {error && <p className="customer-account-error">{error}</p>}
            <p className="customer-account-footnote">Seus dados de acesso são protegidos pelo sistema de autenticação da loja.</p>
          </>
        )}
      </section>
    </main>
  );
}
