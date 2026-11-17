import { NextResponse } from "next/server";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import {
  getOrderPaymentDisposition,
  readOrderSearchPage,
  selectUniqueOrderAcrossSearchPages,
  isSafeOrderLinkCandidate,
} from "@/lib/mercadopago-security.cjs";
import { getReconciliationTransition } from "@/lib/reconciliation-transition.cjs";

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
    // Orders API uses page/page_size for requests. The response paging
    // object still reports offset/limit, which readOrderSearchPage validates.
    url.searchParams.set("page", String(Math.floor(offset / PAGE_SIZE) + 1));
    url.searchParams.set("page_size", String(PAGE_SIZE));

    let response: Response;
    try {
      response = await fetch(url, {
        method: "GET",
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
      method: "GET",
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
  failed = false,
  allowedCurrentStatuses?: string[]
) {
  const { data, error } = await db.rpc("finalize_mercado_pago_webhook_event", {
    p_notification_id: claim.notificationId,
    p_processing_token: claim.token,
    p_final_status: failed ? "failed" : "processed",
    p_error_code: failed ? "reconciliation_transition_not_applied" : null,
    p_order_id: action === "none" ? null : orderId,
    p_order_action: action,
    p_order_status: status ?? null,
    p_allowed_current_statuses: action === "set_status" ? (allowedCurrentStatuses ?? ["aguardando"]) : null,
  }).maybeSingle();
  if (error) throw new Error("Could not finalize reconciliation event.");
  return data as { finalized: boolean; order_updated: boolean; order_cancelled: boolean } | null;
}

export async function POST(request: Request) {
  const secret = process.env.MERCADO_PAGO_RECONCILIATION_SECRET;
  if (!secret) return fail("Reconciliation is not configured.", 503);
  const authorization = request.headers.get("authorization") ?? "";
  const suppliedSecret = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  const expectedBuffer = Buffer.from(secret, "utf8");
  const suppliedBuffer = Buffer.from(suppliedSecret, "utf8");
  if (expectedBuffer.length !== suppliedBuffer.length || !timingSafeEqual(expectedBuffer, suppliedBuffer)) {
    return fail("Unauthorized.", 401);
  }
  const token = process.env.MERCADO_PAGO_ACCESS_TOKEN;
  if (!token) return fail("Payment provider is not configured.", 503);

  try {
    const db = admin();
    const now = new Date();
    const cutoff = new Date(now.getTime() - 2 * 60 * 1000).toISOString();
    const cursorValue = new URL(request.url).searchParams.get("cursor");
    let cursor: { created_at: string; id: string } | null = null;
    if (cursorValue) {
      try {
        const parsed: unknown = JSON.parse(Buffer.from(cursorValue, "base64url").toString("utf8"));
        if (parsed && typeof parsed === "object" &&
            typeof (parsed as any).created_at === "string" &&
            Number.isFinite(new Date((parsed as any).created_at).getTime()) &&
            typeof (parsed as any).id === "string" &&
            /^[0-9a-f-]{36}$/i.test((parsed as any).id)) {
          cursor = { created_at: (parsed as any).created_at, id: (parsed as any).id };
        } else {
          return fail("Invalid reconciliation cursor.", 400);
        }
      } catch {
        return fail("Invalid reconciliation cursor.", 400);
      }
    }

    let orderQuery = db.from("orders")
      .select("id,total,status,created_at,mercado_pago_order_id")
      .in("status", ["aguardando", "Cancelado", "cancelado", "Cancelada", "cancelada", "Canceled", "canceled", "Cancelled", "cancelled"])
      .lt("created_at", cutoff)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(MAX_ORDERS);
    if (cursor) {
      orderQuery = orderQuery.or(
        "created_at.gt." + cursor.created_at + ",and(created_at.eq." + cursor.created_at + ",id.gt." + cursor.id + ")"
      );
    }
    const { data: orders, error } = await orderQuery;

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
          .eq("status", order.status)
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
              String(latest?.status ?? "") !== String(order.status)) {
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
      const transition = getReconciliationTransition(order.status, disposition);
      if (transition.result === "waiting") {
        // Release the event lease so the next scheduled/manual run can recheck immediately.
        await finalize(db, claim, id, "none", undefined, true);
        result.waiting += 1;
        continue;
      }
      const applied = await finalize(
        db,
        claim,
        id,
        transition.action,
        transition.status,
        transition.failed,
        transition.allowedCurrentStatuses
      );

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

    const lastOrder = orders?.length === MAX_ORDERS ? orders[orders.length - 1] : null;
    const nextCursor = lastOrder
      ? Buffer.from(JSON.stringify({ created_at: lastOrder.created_at, id: lastOrder.id }), "utf8").toString("base64url")
      : null;
    return NextResponse.json({ ...result, nextCursor }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("[MP reconciliation] Failed:", error);
    return fail("Reconciliation failed.", 500);
  }
}
