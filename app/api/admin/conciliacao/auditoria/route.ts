import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };
const ACTIONS = new Set([
  "reviewed_pending",
  "evidence_requested",
  "escalated",
  "manual_followup",
  "other",
]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PRIVATE_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,499}$/;

async function requireAdmin(request: Request) {
  const authorization = request.headers.get("authorization") || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!token) {
    return NextResponse.json({ error: "Autenticação necessária." }, { status: 401, headers: NO_STORE });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anon || !service) {
    return NextResponse.json({ error: "Serviço administrativo indisponível." }, { status: 503, headers: NO_STORE });
  }

  const userClient = createClient(url, anon, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: "Bearer " + token } },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser(token);
  if (userError || !userData.user) {
    return NextResponse.json({ error: "Sessão inválida ou expirada." }, { status: 401, headers: NO_STORE });
  }

  const { data: isAdmin, error: adminError } = await userClient.rpc("is_marketplace_admin");
  if (adminError || isAdmin !== true) {
    return NextResponse.json({ error: "Acesso administrativo não autorizado." }, { status: 403, headers: NO_STORE });
  }

  const admin = createClient(url, service, { auth: { autoRefreshToken: false, persistSession: false } });
  return { admin, userId: userData.user.id };
}

export async function GET(request: Request) {
  const notificationId = new URL(request.url).searchParams.get("notificationId") || "";
  if (!notificationId || notificationId.length > 200) {
    return NextResponse.json({ error: "Identificador do evento inválido." }, { status: 400, headers: NO_STORE });
  }

  try {
    const auth = await requireAdmin(request);
    if (auth instanceof NextResponse) return auth;

    const { data, error } = await auth.admin
      .from("mercado_pago_reconciliation_audit")
      .select("id,notification_id,resource_id,admin_user_id,action,decision_note,evidence_reference,created_at")
      .eq("notification_id", notificationId)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      console.error("[admin reconciliation audit] Falha ao consultar histórico:", error.message);
      return NextResponse.json({ error: "Não foi possível carregar o histórico de análises." }, { status: 500, headers: NO_STORE });
    }

    return NextResponse.json({ entries: data || [] }, { headers: NO_STORE });
  } catch (error) {
    console.error("[admin reconciliation audit] Erro inesperado na consulta:", error);
    return NextResponse.json({ error: "Erro interno ao consultar o histórico." }, { status: 500, headers: NO_STORE });
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireAdmin(request);
    if (auth instanceof NextResponse) return auth;

    const contentType = request.headers.get("content-type") || "";
    if (!contentType.toLowerCase().includes("application/json")) {
      return NextResponse.json({ error: "Formato de envio inválido." }, { status: 415, headers: NO_STORE });
    }

    const body = await request.json();
    const notificationId = typeof body?.notificationId === "string" ? body.notificationId.trim() : "";
    const action = typeof body?.action === "string" ? body.action : "";
    const decisionNote = typeof body?.decisionNote === "string" ? body.decisionNote.trim() : "";
    const evidenceReference = typeof body?.evidenceReference === "string" ? body.evidenceReference.trim() : "";
    const submissionKey = typeof body?.submissionKey === "string" ? body.submissionKey : "";

    if (!notificationId || notificationId.length > 200 || !ACTIONS.has(action) ||
        decisionNote.length < 20 || decisionNote.length > 2000 || !UUID.test(submissionKey)) {
      return NextResponse.json({ error: "Informe uma ação válida, justificativa de 20 a 2.000 caracteres e chave de envio válida." }, { status: 400, headers: NO_STORE });
    }

    if (evidenceReference && (!PRIVATE_REFERENCE.test(evidenceReference) || evidenceReference.includes(".."))) {
      return NextResponse.json({ error: "A referência do comprovante deve ser um caminho interno privado, sem URL pública." }, { status: 400, headers: NO_STORE });
    }

    const { data: existing, error: existingError } = await auth.admin
      .from("mercado_pago_reconciliation_audit")
      .select("id,notification_id,admin_user_id")
      .eq("submission_key", submissionKey)
      .maybeSingle();

    if (existingError) throw existingError;
    if (existing) {
      if (existing.notification_id === notificationId && existing.admin_user_id === auth.userId) {
        return NextResponse.json({ success: true, alreadyRecorded: true, id: existing.id }, { headers: NO_STORE });
      }
      return NextResponse.json({ error: "Esta chave de envio já foi utilizada." }, { status: 409, headers: NO_STORE });
    }

    const { data: event, error: eventError } = await auth.admin
      .from("mercado_pago_webhook_events")
      .select("notification_id,resource_id,processing_status")
      .eq("notification_id", notificationId)
      .eq("processing_status", "reconciliation_required")
      .maybeSingle();

    if (eventError) throw eventError;
    if (!event || !event.resource_id) {
      return NextResponse.json({ error: "Evento não encontrado ou não está mais pendente de conciliação." }, { status: 404, headers: NO_STORE });
    }

    const { data: inserted, error: insertError } = await auth.admin
      .from("mercado_pago_reconciliation_audit")
      .insert({
        notification_id: event.notification_id,
        resource_id: event.resource_id,
        admin_user_id: auth.userId,
        action,
        decision_note: decisionNote,
        evidence_reference: evidenceReference || null,
        submission_key: submissionKey,
      })
      .select("id,notification_id,resource_id,admin_user_id,action,decision_note,evidence_reference,created_at")
      .single();

    if (insertError) {
      if (insertError.code === "23505") {
        return NextResponse.json({ error: "Este envio já foi registrado. Atualize o histórico antes de tentar novamente." }, { status: 409, headers: NO_STORE });
      }
      throw insertError;
    }

    return NextResponse.json({ success: true, entry: inserted }, { status: 201, headers: NO_STORE });
  } catch (error) {
    console.error("[admin reconciliation audit] Falha ao registrar análise:", error);
    return NextResponse.json({ error: "Não foi possível confirmar o registro da análise. Verifique o histórico antes de reenviar." }, { status: 500, headers: NO_STORE });
  }
}
