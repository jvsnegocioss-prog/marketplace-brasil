import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let browserClient: SupabaseClient | null = null;

function isBrowserEnvironment(): boolean {
  // A Vercel Edge/build runtime pode expor globals compatíveis com o browser.
  // Exigimos um Document real associado à janela para inicializar o SDK.
  if (typeof window === "undefined" || typeof document === "undefined") {
    return false;
  }
  return document.nodeType === 9 && document.defaultView === window;
}

function getBrowserClient(): SupabaseClient {
  if (!isBrowserEnvironment()) {
    throw new Error("O cliente Supabase só pode executar no navegador.");
  }
  if (browserClient) return browserClient;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Configuração pública do Supabase indisponível.");
  }

  browserClient = createClient(supabaseUrl, supabaseKey);
  return browserClient;
}

// Durante a renderização no servidor, disponibiliza uma fachada inerte.
// Ela permite que o Next.js avalie/importa páginas Client Component sem
// inicializar o SDK nem exigir credenciais no build do Preview.
const serverOnlySupabase = new Proxy(function serverOnlySupabaseCall() {}, {
  get(_target, property) {
    if (property === "then") return undefined;
    if (property === Symbol.toStringTag) return "SupabaseClient";
    return serverOnlySupabase;
  },
  apply() {
    throw new Error("O cliente Supabase do navegador não pode ser executado no servidor.");
  },
});

export const supabase = new Proxy({} as SupabaseClient, {
  get(_target, property) {
    if (!isBrowserEnvironment()) {
      if (property === "then") return undefined;
      if (property === Symbol.toStringTag) return "SupabaseClient";
      return serverOnlySupabase;
    }

    const client = getBrowserClient();
    const value = Reflect.get(client, property, client);
    return typeof value === "function" ? value.bind(client) : value;
  },
});
