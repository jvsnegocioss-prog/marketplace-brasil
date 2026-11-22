import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  const authorization = request.headers.get("authorization") || "";
  const token = authorization.startsWith("Bearer ")
    ? authorization.slice(7).trim()
    : "";

  if (!token) {
    return NextResponse.json({ error: "Autenticação necessária." }, { status: 401, headers: NO_STORE });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return NextResponse.json({ error: "Serviço administrativo indisponível." }, { status: 503, headers: NO_STORE });
  }

  try {
    const userClient = createClient(supabaseUrl, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    const { data: userData, error: userError } = await userClient.auth.getUser(token);
    if (userError || !userData.user) {
      return NextResponse.json({ error: "Sessão inválida ou expirada." }, { status: 401, headers: NO_STORE });
    }

    const { data: isAdmin, error: adminError } = await userClient.rpc("is_marketplace_admin");
    if (adminError || isAdmin !== true) {
      return NextResponse.json({ error: "Acesso administrativo não autorizado." }, { status: 403, headers: NO_STORE });
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data, error } = await supabaseAdmin
      .from("mercado_pago_webhook_events")
      .select("notification_id,resource_id,request_id,notification_type,processing_status,last_error_code,last_received_at")
      .eq("processing_status", "reconciliation_required")
      .order("last_received_at", { ascending: false })
      .limit(100);

    if (error) {
      console.error("[admin reconciliation] Falha ao listar eventos:", error.message);
      return NextResponse.json({ error: "Não foi possível carregar os eventos de conciliação." }, { status: 500, headers: NO_STORE });
    }

    return NextResponse.json({
      events: (data || []).map((event) => ({
        notificationId: event.notification_id,
        resourceId: event.resource_id,
        requestId: event.request_id,
        notificationType: event.notification_type,
        status: event.processing_status,
        reason: event.last_error_code,
        receivedAt: event.last_received_at,
      })),
      limit: 100,
    }, { headers: NO_STORE });
  } catch (error) {
    console.error("[admin reconciliation] Erro inesperado:", error);
    return NextResponse.json({ error: "Erro interno ao consultar conciliação." }, { status: 500, headers: NO_STORE });
  }
}
