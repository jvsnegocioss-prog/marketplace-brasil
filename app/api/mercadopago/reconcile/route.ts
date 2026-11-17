import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import {
  getOrderPaymentDisposition,
  readOrderSearchPage,
  selectUniqueOrderAcrossSearchPages,
  isSafeOrderLinkCandidate,
} from "@/lib/mercadopago-security.cjs";

export const runtime = "nodejs";

let adminClient: ReturnType<typeof createClient<any>> | null = null;
const MAX_ORDERS = 25;
const PAGE_SIZE = 50;
const MAX_PAGES = 10;
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase admin is not configured.");
  if (!adminClient) adminClient = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return adminClient;
}

function fail(message: string, status: number) {
  return NextResponse.json({ error: message }, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

async function findExternalOrder(token: string, orderId: string, createdAt: Date, now: Date) {
  if (createdAt.getTime() < now.getTime() - MAX_AGE_MS) return { status: "outside_search_window" as const };
  const begin = new Date(Math.max(now.getTime() - MAX_AGE_MS, createdAt.getTime() - 5 * 60 * 1000));
  const pages: Record<string, unknown>[] = [];
  let offset = 0;
  let complete = false;

  for (let index = 0; index < MAX_PAGES; index += 1) {
    const url = new URL("https://api.mercadopago.com/v1/orders");
    url.searchParams.set("begin_date", begin.toISOString());
    url.searchParams.set("end_date", now.toISOString());
    url.searchParams.set("external_reference", orderId);
    url.searchParams.set("limit", String(PAGE_SIZE));
    url.searchParams.set("offset", String(offset));

    let response: Response;
    try {
      response = await fetch(url, {
        headers: { Authorization: "Bearer " + token },
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      return { status: "provider_error" as const };
    }
    if (!response.ok) return { status: "provider_error" as const };

    let body: unknown;
    try { body = await response.json(); } catch {
      return { status: "invalid_response" as const };
    }
    const page = readOrderSearchPage(body);
    if (page.status !== "valid" || !body || typeof body !== "object" || Array.isArray(body)) {
      return { status: "invalid_response" as const };
    }
    pages.push(body as Record<string, unknown>);
    if (page.nextOffset === null) {
      complete = true;
      break;
    }
    offset = page.nextOffset;
  }

  if (!complete) return { status: "invalid_response" as const };
  const selected = selectUniqueOrderAcrossSearchPages(pages, orderId);
  if (selected.status === "not_found") return { status: "not_found" as const };
  if (selected.status !== "matched") return { status: selected.status as "ambiguous" | "invalid_response" };
  return { status: "matched" as const, order: selected.order as Record<string, unknown> };
}

async function fetchExternalOrder(token: string, id: string) {
  try {
    const response = await fetch("https://api.mercadopago.com/v1/orders/" + encodeURIComponent(id), {
      headers: { Authorization: "Bearer " + token },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    return body && typeof body === "object" && !Array.isArray(body)
      ? body as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

async function claimEvent(db: ReturnType<typeof createClient<any>>, orderId: string, mpId: string) {
  const notificationId = "reconcile:" + orderId + ":" + mpId;
  const { data: registered, error: registerError } = await db.rpc("register_mercado_pago_webhook_delivery", {
    p_notification_id: notificationId,
    p_resource_id: mpId,
    p_request_id: "reconcile:" + randomUUID(),
    p_notification_type: "order",
    p_action: "reconciled",
  }).maybeSingle();
  if (registerError || !registered) return null;

  const token = randomUUID();
  const { data: claim, error: claimError } = await db.rpc("claim_mercado_pago_webhook_event", {
    p_notification_id: notificationId,
    p_processing_token: token,
  }).maybeSingle();
  const claimResult = claim as { claimed?: boolean } | null;
  return claimError || !claimResult?.claimed ? null : { notificationId, token };
}

async function finalize(
  db: ReturnType<typeof createClient<any>>,
  claim: { notificationId: string; token: string },
  orderId: string,
  action: "none" | "set_status" | "cancel_unpaid",
  status?: string,
  failed = false
) {
  const { data, error } = await db.rpc("finalize_mercado_pago_webhook_event", {
    p_notification_id: claim.notificationId,
    p_processing_token: claim.token,
    p_final_status: failed ? "failed" : "processed",
    p_error_code: failed ? "reconciliation_transition_not_applied" : null,
    p_order_id: action === "none" ? null : orderId,
    p_order_action: action,
    p_order_status: status ?? null,
    p_allowed_current_statuses: action === "set_status" ? ["aguardando"] : null,
  }).maybeSingle();
  if (error) throw new Error("Could not finalize reconciliation event.");
  return data as { finalized: boolean; order_updated: boolean; order_cancelled: boolean } | null;
}

export async function POST(request: Request) {
  const secret = process.env.MERCADO_PAGO_RECONCILIATION_SECRET;
  if (!secret) return fail("Reconciliation is not configured.", 503);
  if (request.headers.get("authorization") !== "Bearer " + secret) return fail("Unauthorized.", 401);
  const token = process.env.MERCADO_PAGO_ACCESS_TOKEN;
  if (!token) return fail("Payment provider is not configured.", 503);

  try {
    const db = admin();
    const now = new Date();
    const cutoff = new Date(now.getTime() - 2 * 60 * 1000).toISOString();
    const { data: orders, error } = await db.from("orders")
      .select("id,total,status,created_at,mercado_pago_order_id")
      .ilike("status", "aguardando")
      .lt("created_at", cutoff)
      .order("created_at", { ascending: true })
      .limit(MAX_ORDERS);

    if (error) throw new Error("Could not load pending orders.");

    const result = { scanned: orders?.length ?? 0, reconciled: 0, waiting: 0, ambiguous: 0, skipped: 0, failed: 0 };

    for (const order of orders ?? []) {
      const id = String(order.id ?? "");
      const createdAt = new Date(String(order.created_at ?? ""));
      if (!id || !Number.isFinite(createdAt.getTime())) {
        result.skipped += 1;
        continue;
      }

      let mpId = order.mercado_pago_order_id ? String(order.mercado_pago_order_id) : "";
      if (!mpId) {
        const found = await findExternalOrder(token, id, createdAt, now);
        if (found.status === "not_found" || found.status === "outside_search_window") {
          // An empty search is not evidence that Mercado Pago did not create the order.
          result.waiting += 1;
          continue;
        }
        if (found.status === "ambiguous") {
          result.ambiguous += 1;
          continue;
        }
        if (found.status !== "matched") {
          result.failed += 1;
          continue;
        }
        const candidateId = found.order.id;
        if ((typeof candidateId !== "string" && typeof candidateId !== "number") || String(candidateId).trim() === "") {
          result.failed += 1;
          continue;
        }
        mpId = String(candidateId);
        if (!isSafeOrderLinkCandidate(order.mercado_pago_order_id, mpId)) {
          result.ambiguous += 1;
          continue;
        }
      }

      const mpOrder = await fetchExternalOrder(token, mpId);
      if (!mpOrder || String(mpOrder.id ?? "") !== mpId || String(mpOrder.external_reference ?? "") !== id) {
        result.failed += 1;
        continue;
      }

      if (!order.mercado_pago_order_id) {
        const { data: linked, error: linkError } = await db.from("orders")
          .update({ mercado_pago_order_id: mpId })
          .eq("id", id)
          .ilike("status", "aguardando")
          .is("mercado_pago_order_id", null)
          .select("id,mercado_pago_order_id")
          .maybeSingle();
        if (linkError) {
          result.failed += 1;
          continue;
        }
        if (!linked) {
          const { data: latest, error: readError } = await db.from("orders")
            .select("status,mercado_pago_order_id").eq("id", id).maybeSingle();
          if (readError || latest?.mercado_pago_order_id !== mpId ||
              String(latest?.status ?? "").trim().toLowerCase() !== "aguardando") {
            result.skipped += 1;
            continue;
          }
        }
      }

      const claim = await claimEvent(db, id, mpId);
      if (!claim) {
        result.skipped += 1;
        continue;
      }

      const disposition = getOrderPaymentDisposition(order.total, mpOrder);
      let applied = null;
      if (disposition === "paid") applied = await finalize(db, claim, id, "set_status", "Pago");
      else if (disposition === "not_paid") applied = await finalize(db, claim, id, "cancel_unpaid");
      else if (disposition === "chargeback") applied = await finalize(db, claim, id, "set_status", "Em contestação");
      else if (disposition === "review" || disposition === "chargeback_resolved") {
        applied = await finalize(db, claim, id, "set_status", "Revisão necessária");
      } else if (disposition === "refunded" || disposition === "partial_refund") {
        applied = await finalize(db, claim, id, "set_status",
          disposition === "refunded" ? "Reembolsado" : "Reembolso parcial");
      } else {
        applied = await finalize(db, claim, id, "none", undefined, true);
      }

      if (applied?.finalized) {
        result.reconciled += 1;
      } else {
        const { data: latest, error: readError } = await db.from("orders")
          .select("status").eq("id", id).maybeSingle();
        if (!readError && latest && String(latest.status).trim().toLowerCase() !== "aguardando") {
          const released = await finalize(db, claim, id, "none", undefined, true);
          if (released?.finalized) result.skipped += 1;
          else result.failed += 1;
        } else {
          const released = await finalize(db, claim, id, "none", undefined, true);
          if (released?.finalized) result.failed += 1;
          else result.failed += 1;
        }
      }
    }

    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[MP reconciliation] Failed:", error);
    return fail("Reconciliation failed.", 500);
  }
}
