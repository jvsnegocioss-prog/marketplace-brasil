import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function responseError(message: string, status: number) {
  return NextResponse.json({ error: message }, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

async function readLimitedJson(request: Request): Promise<
  { ok: true; value: unknown } | { ok: false; status: 400 | 413 }
> {
  if (!request.body) return { ok: false, status: 400 };
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let source = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > 4096) {
        await reader.cancel();
        return { ok: false, status: 413 };
      }
      source += decoder.decode(value, { stream: true });
    }
    source += decoder.decode();
    return { ok: true, value: JSON.parse(source) };
  } catch {
    return { ok: false, status: 400 };
  } finally {
    reader.releaseLock();
  }
}

async function isAdmin(request: NextRequest): Promise<boolean> {
  const authorization = request.headers.get("authorization") || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!token) return false;

  const userClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser(token);
  if (userError || !userData.user) return false;

  const { data, error } = await userClient.rpc("is_marketplace_admin");
  return !error && data === true;
}

function isPaid(status: string) {
  return ["pago", "aprovado", "approved", "concluido", "concluído"].includes(
    (status || "").trim().toLowerCase()
  );
}

const deliverySteps = [
  "aguardando_separacao",
  "em_preparacao",
  "enviado",
  "entregue",
];

export async function PATCH(request: NextRequest) {
  try {
    if (!await isAdmin(request)) {
      return responseError("Acesso administrativo não autorizado.", 401);
    }

    if (!supabaseUrl || !serviceKey) {
      return responseError("Configuração administrativa indisponível.", 503);
    }

    const parsed = await readLimitedJson(request);
    if (!parsed.ok) {
      return responseError(parsed.status === 413 ? "Solicitação muito grande." : "Dados inválidos.", parsed.status);
    }
    if (!parsed.value || typeof parsed.value !== "object" || Array.isArray(parsed.value)) {
      return responseError("Dados inválidos.", 400);
    }

    const body = parsed.value as {
      action?: string;
      orderId?: string;
      status?: string;
      estimatedDeliveryAt?: string | null;
    };
    if (
      typeof body.orderId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.orderId)
    ) {
      return responseError("Pedido inválido.", 400);
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: order, error: readError } = await admin
      .from("orders")
      .select("id,status,delivery_status")
      .eq("id", body.orderId)
      .maybeSingle();

    if (readError) {
      console.error("Falha ao consultar pedido para atualização administrativa:", readError);
      return responseError("Não foi possível consultar o pedido.", 500);
    }
    if (!order) return responseError("Pedido não encontrado.", 404);
    if (!isPaid(order.status)) {
      return responseError("A entrega só pode ser alterada após a confirmação do pagamento.", 409);
    }

    const currentDeliveryStatus = order.delivery_status || "aguardando_separacao";
    let update: Record<string, string | null>;

    if (body.action === "delivery_status") {
      if (typeof body.status !== "string") {
        return responseError("Etapa de entrega inválida.", 400);
      }
      const currentIndex = deliverySteps.indexOf(currentDeliveryStatus);
      const nextIndex = deliverySteps.indexOf(body.status);
      if (currentIndex < 0 || nextIndex < 0 || nextIndex !== currentIndex + 1) {
        return responseError("O pedido deve avançar uma etapa por vez, sem pular ou voltar etapas.", 409);
      }
      update = { delivery_status: body.status };
    } else if (body.action === "estimated_delivery") {
      let estimated: string | null = null;
      if (body.estimatedDeliveryAt !== null) {
        if (typeof body.estimatedDeliveryAt !== "string") {
          return responseError("Data de previsão inválida.", 400);
        }
        const parsedDate = new Date(body.estimatedDeliveryAt);
        if (Number.isNaN(parsedDate.getTime()) || parsedDate.getTime() < Date.now()) {
          return responseError("A previsão de entrega deve ser uma data válida no futuro.", 400);
        }
        estimated = parsedDate.toISOString();
      }
      update = { estimated_delivery_at: estimated, delivery_method: "motoboy" };
    } else {
      return responseError("Ação administrativa inválida.", 400);
    }

    let query = admin.from("orders").update(update).eq("id", order.id).eq("status", order.status);
    query = order.delivery_status === null
      ? query.is("delivery_status", null)
      : query.eq("delivery_status", order.delivery_status);

    const { data: updated, error: updateError } = await query.select("id").maybeSingle();
    if (updateError) {
      console.error("Falha ao atualizar entrega do pedido:", updateError);
      return responseError("Não foi possível atualizar a entrega.", 500);
    }
    if (!updated) {
      return responseError("O pedido foi alterado por outra operação. Atualize a lista e tente novamente.", 409);
    }

    return NextResponse.json({ success: true }, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    console.error("Erro na API administrativa de entrega:", error);
    return responseError("Ocorreu um erro ao atualizar a entrega.", 500);
  }
}
