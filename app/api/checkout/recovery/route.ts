import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { UUID_RE, hashRecoveryToken, classifyRecoveryState } from "@/lib/checkout-recovery.cjs";

export const runtime = "nodejs";

let supabaseAdmin: ReturnType<typeof createClient<any>> | null = null;

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Configuração do Supabase indisponível.");
  if (!supabaseAdmin) {
    supabaseAdmin = createClient(url, key, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return supabaseAdmin;
}

function json(data: Record<string, unknown>, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "no-store, max-age=0", Pragma: "no-cache" },
  });
}

export async function GET(request: Request) {
  try {
    const admin = getSupabaseAdmin();
    const authorization = request.headers.get("authorization") || "";
    let orderId: string | null = null;

    if (authorization.startsWith("Bearer ")) {
      const accessToken = authorization.slice(7);
      const { data, error } = await admin.auth.getUser(accessToken);
      const userId = data?.user?.id;
      if (error || !userId) return json({ error: "Sessão inválida. Entre novamente." }, 401);

      const key = new URL(request.url).searchParams.get("key") || "";
      if (!UUID_RE.test(key)) return json({ error: "Identificador da tentativa inválido." }, 400);

      const { data: ownedOrder, error: lookupError } = await admin
        .from("orders")
        .select("id")
        .eq("checkout_idempotency_key", key)
        .eq("customer_user_id", userId)
        .maybeSingle();

      if (lookupError) {
        console.error("ERRO AO LOCALIZAR TENTATIVA AUTENTICADA:", lookupError);
        return json({ error: "Não foi possível consultar a tentativa agora." }, 503);
      }
      orderId = ownedOrder?.id || null;
    } else {
      const token = request.headers.get("x-checkout-recovery-token") || "";
      const tokenHash = hashRecoveryToken(token);
      if (!tokenHash) return json({ error: "Token de recuperação inválido." }, 401);

      const { data: tokenRecord, error: tokenError } = await admin
        .from("checkout_recovery_tokens")
        .select("order_id")
        .eq("token_hash", tokenHash)
        .gt("expires_at", new Date().toISOString())
        .maybeSingle();

      if (tokenError) {
        console.error("ERRO AO VALIDAR TOKEN DE RECUPERAÇÃO:", tokenError);
        return json({ error: "Recuperação temporariamente indisponível." }, 503);
      }
      orderId = tokenRecord?.order_id || null;
    }

    if (!orderId) return json({ error: "Nenhuma tentativa encontrada para esta credencial." }, 404);

    const { data: order, error: orderError } = await admin
      .from("orders")
      .select("order_number,total,status,created_at")
      .eq("id", orderId)
      .maybeSingle();

    if (orderError || !order) {
      if (orderError) console.error("ERRO AO LER TENTATIVA DE CHECKOUT:", orderError);
      return json({ error: "Nenhuma tentativa encontrada para esta credencial." }, 404);
    }

    return json({
      attempt: {
        orderNumber: order.order_number,
        total: order.total,
        createdAt: order.created_at,
        state: classifyRecoveryState(order.status),
      },
    });
  } catch (error) {
    console.error("ERRO NA RECUPERAÇÃO DE CHECKOUT:", error);
    return json({ error: "Recuperação temporariamente indisponível." }, 503);
  }
}
