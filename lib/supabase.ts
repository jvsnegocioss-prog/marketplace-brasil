import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let browserClient: SupabaseClient | null = null;

function getBrowserClient(): SupabaseClient {
  if (typeof window === "undefined") {
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
// tentar inicializar o SDK nem exigir credenciais no build do Preview.
// Qualquer tentativa real de executar uma chamada Supabase no servidor falha
// explicitamente; no navegador, todas as chamadas usam o cliente real.
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
    if (typeof window === "undefined") {
      if (property === "then") return undefined;
      if (property === Symbol.toStringTag) return "SupabaseClient";
      return serverOnlySupabase;
    }

    const client = getBrowserClient();
    const value = Reflect.get(client, property, client);
    return typeof value === "function" ? value.bind(client) : value;
  },
});
