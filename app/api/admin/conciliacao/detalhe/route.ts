import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function cents(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed * 100) : null;
}
export async function GET(request: Request) {
  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const notificationId = new URL(request.url).searchParams.get("notificationId") || "";
  if (!token) return NextResponse.json({ error: "Autenticação necessária." }, { status: 401, headers: NO_STORE });
  if (!notificationId || notificationId.length > 200) return NextResponse.json({ error: "Identificador inválido." }, { status: 400, headers: NO_STORE });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const accessToken = process.env.MERCADO_PAGO_ACCESS_TOKEN;
  if (!url || !anon || !service || !accessToken) return NextResponse.json({ error: "Consulta indisponível: verifique a configuração privada do servidor." }, { status: 503, headers: NO_STORE });
  try {
    const userClient = createClient(url, anon, { auth: { autoRefreshToken: false, persistSession: false }, global: { headers: { Authorization: "Bearer " + token } } });
    const { data: userData, error: userError } = await userClient.auth.getUser(token);
    if (userError || !userData.user) return NextResponse.json({ error: "Sessão inválida ou expirada." }, { status: 401, headers: NO_STORE });
    const { data: isAdmin, error: adminError } = await userClient.rpc("is_marketplace_admin");
    if (adminError || isAdmin !== true) return NextResponse.json({ error: "Acesso administrativo não autorizado." }, { status: 403, headers: NO_STORE });
    const admin = createClient(url, service, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data: event, error: eventError } = await admin.from("mercado_pago_webhook_events").select("notification_id,resource_id,processing_status,last_error_code").eq("notification_id", notificationId).eq("processing_status", "reconciliation_required").maybeSingle();
    if (eventError) throw eventError;
    if (!event || !event.resource_id) return NextResponse.json({ error: "Evento não encontrado ou não está mais pendente." }, { status: 404, headers: NO_STORE });
    const mpResponse = await fetch("https://api.mercadopago.com/v1/orders/" + encodeURIComponent(String(event.resource_id)), { headers: { Authorization: "Bearer " + accessToken }, cache: "no-store" });
    if (!mpResponse.ok) return NextResponse.json({ error: "Mercado Pago não confirmou a consulta desta ordem.", providerStatus: mpResponse.status }, { status: 502, headers: NO_STORE });
    const mpOrder = await mpResponse.json();
    if (String(mpOrder.id) !== String(event.resource_id)) return NextResponse.json({ error: "O identificador retornado pelo Mercado Pago diverge do evento." }, { status: 409, headers: NO_STORE });
    const externalReference = typeof mpOrder.external_reference === "string" ? mpOrder.external_reference : "";
    if (!UUID.test(externalReference)) return NextResponse.json({ event: { reason: event.last_error_code, resourceId: event.resource_id }, mercadoPago: { id: String(mpOrder.id), status: mpOrder.status || "unknown", currency: mpOrder.currency_id || null, totalAmount: mpOrder.total_amount ?? null, paidAmount: mpOrder.total_paid_amount ?? null }, correlation: { matched: false, reason: "A referência externa não contém um UUID válido da loja." } }, { headers: NO_STORE });
    const { data: order, error: orderError } = await admin.from("orders").select("id,order_number,status,total,mercado_pago_order_id").eq("id", externalReference).maybeSingle();
    if (orderError) throw orderError;
    const amountMatch = Boolean(order) && cents(order.total) !== null && cents(order.total) === cents(mpOrder.total_amount);
    const idMatch = Boolean(order) && (!order.mercado_pago_order_id || String(order.mercado_pago_order_id) === String(mpOrder.id));
    const correlationMatched = Boolean(order) && idMatch && amountMatch && mpOrder.currency_id === "BRL";
    return NextResponse.json({ event: { reason: event.last_error_code, resourceId: event.resource_id }, mercadoPago: { id: String(mpOrder.id), status: mpOrder.status || "unknown", currency: mpOrder.currency_id || null, totalAmount: mpOrder.total_amount ?? null, paidAmount: mpOrder.total_paid_amount ?? null }, storeOrder: order ? { id: order.id, orderNumber: order.order_number, status: order.status, total: order.total } : null, correlation: { matched: correlationMatched, orderFound: Boolean(order), externalReferenceMatchesOrder: Boolean(order && order.id === externalReference), mercadoPagoIdMatches: idMatch, currencyMatches: mpOrder.currency_id === "BRL", amountMatches: amountMatch }, notice: "Consulta somente leitura. Nenhum pedido, pagamento, estoque, cupom ou evento foi alterado." }, { headers: NO_STORE });
  } catch (error) {
    console.error("[admin reconciliation detail] Erro:", error);
    return NextResponse.json({ error: "Não foi possível consultar os detalhes para conciliação." }, { status: 500, headers: NO_STORE });
  }
}