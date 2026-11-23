import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  classifyMercadoPagoOrderStatus,
  validateProcessedPayment,
} from "@/lib/mercado-pago-webhook-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

async function getAdminClient(request: NextRequest) {
  const authorization = request.headers.get("authorization") || "";
  const token = authorization.startsWith("Bearer ")
    ? authorization.slice(7)
    : "";

  if (!token || !supabaseUrl || !anonKey || !serviceKey) return null;

  const userClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data: userData, error: userError } = await userClient.auth.getUser(token);
  if (userError || !userData.user) return null;

  const { data: isAdmin, error: adminError } = await userClient.rpc(
    "is_marketplace_admin"
  );
  if (adminError || isAdmin !== true) return null;

  return createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function POST(request: NextRequest) {
  const supabase = await getAdminClient(request);
  if (!supabase) return errorResponse("Acesso administrativo não autorizado.", 401);

  const accessToken = process.env.MERCADO_PAGO_ACCESS_TOKEN;
  if (!accessToken) {
    return errorResponse("Configuração do Mercado Pago indisponível.", 503);
  }

  // Aguarda 10 minutos antes de reconciliar para evitar interferir no checkout em andamento.
  const cutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { data: pendingOrders, error: queryError } = await supabase
    .from("orders")
    .select("id, total, mercado_pago_order_id, created_at")
    .eq("status", "aguardando")
    .not("mercado_pago_order_id", "is", null)
    .lt("created_at", cutoff)
    .order("created_at", { ascending: true })
    .limit(25);

  if (queryError) {
    console.error("[MP reconcile] Erro ao buscar pedidos:", queryError.message);
    return errorResponse("Não foi possível consultar os pedidos pendentes.", 500);
  }

  const summary = {
    checked: 0,
    approved: 0,
    cancelledAndStockRestored: 0,
    stillPending: 0,
    manualReview: 0,
    errors: 0,
  };

  for (const order of pendingOrders || []) {
    summary.checked += 1;
    try {
      const response = await fetch(
        `https://api.mercadopago.com/v1/orders/${encodeURIComponent(String(order.mercado_pago_order_id))}`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
          cache: "no-store",
        }
      );

      if (!response.ok) {
        summary.errors += 1;
        console.error("[MP reconcile] Falha na consulta:", {
          orderId: order.id,
          status: response.status,
        });
        continue;
      }

      const mpOrder = await response.json();
      if (
        String(mpOrder.id) !== String(order.mercado_pago_order_id) ||
        String(mpOrder.external_reference) !== String(order.id)
      ) {
        summary.manualReview += 1;
        console.error("[MP reconcile] Vínculo divergente; nenhuma alteração feita:", {
          orderId: order.id,
        });
        continue;
      }

      const action = classifyMercadoPagoOrderStatus(mpOrder.status);

      if (action === "approve") {
        const validation = validateProcessedPayment(order.total, mpOrder);
        if (!validation.valid) {
          summary.manualReview += 1;
          console.error("[MP reconcile] Pagamento requer revisão:", {
            orderId: order.id,
            reason: validation.reason,
          });
          continue;
        }

        const { data: updated, error: updateError } = await supabase
          .from("orders")
          .update({ status: "Pago" })
          .eq("id", order.id)
          .eq("status", "aguardando")
          .select("id")
          .maybeSingle();

        if (updateError) {
          summary.errors += 1;
          console.error("[MP reconcile] Erro ao confirmar pagamento:", updateError.message);
        } else if (updated) {
          summary.approved += 1;
        } else {
          summary.manualReview += 1;
        }
        continue;
      }

      if (action === "cancel") {
        const { data: cancellation, error: cancelError } = await supabase.rpc(
          "cancel_unpaid_order_and_restore_stock",
          { p_order_id: order.id }
        );
        const outcome = (cancellation as { outcome?: string } | null)?.outcome;

        if (!cancelError && (outcome === "cancelled" || outcome === "already_restored")) {
          summary.cancelledAndStockRestored += 1;
        } else {
          summary.manualReview += 1;
          console.error("[MP reconcile] Cancelamento não confirmado:", {
            orderId: order.id,
            outcome,
            error: cancelError?.message,
          });
        }
        continue;
      }

      if (action === "reconcile") {
        summary.manualReview += 1;
      } else {
        // pending, in_process ou qualquer estado desconhecido: preservar pedido e estoque.
        summary.stillPending += 1;
      }
    } catch (error) {
      summary.errors += 1;
      console.error("[MP reconcile] Erro inesperado:", {
        orderId: order.id,
        error: error instanceof Error ? error.message : "unknown",
      });
    }
  }

  return NextResponse.json({
    success: true,
    message: "Conferência concluída. Somente estados confirmados pelo Mercado Pago foram aplicados.",
    summary,
  });
}
