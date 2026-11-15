import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let browserClient: SupabaseClient | null = null;

function getBrowserClient(): SupabaseClient {
  if (typeof window === "undefined") {
    throw new Error("O cliente Supabase do navegador só pode ser acessado no navegador.");
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

// Inicializa o cliente somente quando uma tela realmente o utiliza.
// Isso permite que previews sem credenciais de backend sejam compilados sem
// criar um cliente inválido durante a avaliação dos módulos pelo Next.js.
export const supabase = new Proxy({} as SupabaseClient, {
  get(_target, property) {
    const client = getBrowserClient();
    const value = Reflect.get(client, property, client);
    return typeof value === "function" ? value.bind(client) : value;
  },
});
