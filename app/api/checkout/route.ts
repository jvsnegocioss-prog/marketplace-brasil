
import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { isDefinitiveOrderCreationRejection } from "@/lib/mercadopago-security.cjs";

export const runtime = "nodejs";

async function readLimitedJson(request: Request, maxBytes = 32 * 1024): Promise<
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
      if (total > maxBytes) {
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

function mercadoPagoIdempotencyKey(orderId: string) {
  const hex = createHash("sha256").update(`novashopp-checkout:${orderId}`).digest("hex").slice(0, 32).split("");
  hex[12] = "5";
  hex[16] = ((parseInt(hex[16], 16) & 3) | 8).toString(16);
  const value = hex.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

let supabaseAdmin: ReturnType<typeof createClient<any>> | null = null;

function getSupabaseAdmin() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Configuração do Supabase indisponível.");
  }
  if (!supabaseAdmin) {
    supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }
  return supabaseAdmin;
}

async function cancelOrder(orderId: string): Promise<boolean> {
  const { data, error } = await getSupabaseAdmin().rpc(
    "cancel_unpaid_order_and_restore_stock",
    { p_order_id: orderId }
  );

  if (error) {
    console.error("ERRO AO RESTAURAR ESTOQUE:", error);
    return false;
  }
  return data === true;
}

export async function POST(request: Request) {
  if (process.env.STORE_SALES_ENABLED !== "true") {
    return NextResponse.json(
      { error: "As vendas estão temporariamente suspensas. Em breve voltaremos!" },
      { status: 503 }
    );
  }

  let createdOrderId: string | null = null;
  let mercadoPagoRequestStarted = false;

  try {
    const contentLength = Number(request.headers.get("content-length") || 0);
    if (Number.isFinite(contentLength) && contentLength > 32 * 1024) {
      return NextResponse.json({ error: "Solicitação muito grande." }, { status: 413, headers: { "Cache-Control": "no-store" } });
    }
    const parsedBody = await readLimitedJson(request);
    if (!parsedBody.ok) {
      return NextResponse.json(
        { error: parsedBody.status === 413 ? "Solicitação muito grande." : "Corpo da solicitação inválido." },
        { status: parsedBody.status, headers: { "Cache-Control": "no-store" } }
      );
    }
    if (!parsedBody.value || typeof parsedBody.value !== "object" || Array.isArray(parsedBody.value)) {
      return NextResponse.json({ error: "Corpo da solicitação inválido." }, { status: 400, headers: { "Cache-Control": "no-store" } });
    }
    const body = parsedBody.value as Record<string, unknown>;

    const {
      customerName,
      customerEmail,
      customerPhone,
      deliveryAddress,
      items,
      couponCode,
      deliveryNeighborhoodId,
    } = body;

    if (
      typeof customerName !== "string" ||
      !customerName.trim() ||
      typeof customerPhone !== "string" ||
      !customerPhone.trim() ||
      typeof deliveryAddress !== "string" ||
      !deliveryAddress.trim() ||
      typeof deliveryNeighborhoodId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(deliveryNeighborhoodId) ||
      !Array.isArray(items) ||
      items.length === 0 ||
      items.length > 100 ||
      items.some(
        (item: { id?: unknown; qty?: unknown }) =>
          typeof item.id !== "string" ||
          !item.id ||
          !Number.isInteger(item.qty) ||
          Number(item.qty) < 1
      )
    ) {
      return NextResponse.json(
        { error: "Confira os dados e os produtos do pedido." },
        { status: 400 }
      );
    }

    let authenticatedCustomerId: string | null = null;
    let verifiedCustomerEmail =
      typeof customerEmail === "string" ? customerEmail.trim() : "";

    const authorization = request.headers.get("authorization") || "";
    if (authorization.startsWith("Bearer ")) {
      const customerAccessToken = authorization.slice(7);
      const { data: customerAuth, error: customerAuthError } =
        await getSupabaseAdmin().auth.getUser(customerAccessToken);

      if (customerAuthError || !customerAuth.user?.email) {
        return NextResponse.json(
          { error: "Sua sessão da conta expirou. Entre novamente ou finalize como visitante." },
          { status: 401 }
        );
      }

      // Usa o e-mail confirmado da sessão, nunca um e-mail enviado livremente pelo navegador.
      verifiedCustomerEmail = customerAuth.user.email;
      authenticatedCustomerId = customerAuth.user.id;
    }

    const accessToken = process.env.MERCADO_PAGO_ACCESS_TOKEN;

    if (!accessToken) {
      return NextResponse.json(
        { error: "Configuração do Mercado Pago não encontrada." },
        { status: 500 }
      );
    }

    const checkoutIdempotencyKey = request.headers.get("x-checkout-idempotency-key") || "";
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(checkoutIdempotencyKey)) {
      return NextResponse.json(
        { error: "Identificador da tentativa inválido. Atualize a página e tente novamente." },
        { status: 400 }
      );
    }

    const normalizedItems = items.map((item: { id: string; qty: number }) => ({
      id: item.id,
      qty: item.qty,
    }));
    const requestHash = createHash("sha256").update(JSON.stringify({
      customerUserId: authenticatedCustomerId,
      customerName: customerName.trim(),
      customerEmail: verifiedCustomerEmail,
      customerPhone: customerPhone.trim(),
      deliveryAddress: deliveryAddress.trim(),
      couponCode: typeof couponCode === "string" ? couponCode.trim().toUpperCase() : null,
      deliveryNeighborhoodId,
      items: normalizedItems,
    })).digest("hex");

    const { data: orderId, error: orderError } =
      await getSupabaseAdmin().rpc("create_store_order_with_coupon_and_delivery", {
        p_customer_name: customerName.trim(),
        p_customer_email: verifiedCustomerEmail,
        p_customer_phone: customerPhone.trim(),
        p_delivery_address: deliveryAddress.trim(),
        p_coupon_code: typeof couponCode === "string" ? couponCode : null,
        p_delivery_neighborhood_id: deliveryNeighborhoodId,
        p_items: normalizedItems,
        p_checkout_idempotency_key: checkoutIdempotencyKey,
        p_checkout_request_hash: requestHash,
      });

    if (orderError || !orderId) {
      console.error("ERRO AO CRIAR PEDIDO:", orderError);

      return NextResponse.json(
        { error: "Não foi possível registrar o pedido. Confira os dados e tente novamente." },
        { status: 400, headers: { "Cache-Control": "no-store" } }
      );
    }

    createdOrderId = orderId;

    // Bind account ownership by the verified Supabase user ID, never by a supplied email.
    // The request hash also includes this ID, preventing an idempotency-key reuse across accounts.
    if (authenticatedCustomerId) {
      const { data: ownership, error: ownershipError } = await getSupabaseAdmin()
        .from("orders")
        .update({ customer_user_id: authenticatedCustomerId })
        .eq("id", orderId)
        .or(`customer_user_id.is.null,customer_user_id.eq.${authenticatedCustomerId}`)
        .select("customer_user_id")
        .maybeSingle();

      if (ownershipError || ownership?.customer_user_id !== authenticatedCustomerId) {
        console.error("ERRO AO VINCULAR PEDIDO À CONTA:", ownershipError);
        await cancelOrder(orderId);
        createdOrderId = null;
        return NextResponse.json(
          { error: "Não foi possível vincular o pedido à sua conta. Nenhuma cobrança foi iniciada; atualize a página e tente novamente." },
          { status: 503, headers: { "Cache-Control": "no-store" } }
        );
      }
    }

    const { data: order, error: fetchOrderError } =
      await getSupabaseAdmin()
        .from("orders")
        .select("id,status,total,discount_amount,coupon_code,shipping_fee")
        .eq("id", orderId)
        .single();

    if (fetchOrderError || !order) {
      console.error("ERRO AO BUSCAR PEDIDO:", fetchOrderError);

      await cancelOrder(orderId);
      createdOrderId = null;

      return NextResponse.json(
        {
          error: "Não foi possível confirmar os dados do pedido. Tente novamente.",
        },
        { status: 500 }
      );
    }

    if (order.status !== "aguardando") {
      createdOrderId = null;
      return NextResponse.json(
        { error: "Este pedido já foi finalizado ou cancelado. Inicie uma nova tentativa de compra." },
        { status: 409 }
      );
    }

    const { data: orderItems, error: itemsError } =
      await getSupabaseAdmin()
        .from("order_items")
        .select("product_name,quantity,unit_price")
        .eq("order_id", orderId);

    if (itemsError || !orderItems?.length) {
      console.error("ERRO AO BUSCAR ITENS:", itemsError);

      await cancelOrder(orderId);
      createdOrderId = null;

      return NextResponse.json(
        {
          error: "Não foi possível confirmar os itens do pedido. Tente novamente.",
        },
        { status: 500 }
      );
    }

    // Distribui o desconto em centavos entre as unidades, garantindo que
    // a soma dos itens enviados seja exatamente igual ao total do pedido.
    const units = orderItems.flatMap((item) =>
      Array.from({ length: Number(item.quantity) }, () => ({
        title: item.product_name,
        originalCents: Math.round(Number(item.unit_price) * 100),
      }))
    );

    const originalTotalCents = units.reduce(
      (sum, unit) => sum + unit.originalCents,
      0
    );
    const discountCents = Math.round(Number(order.discount_amount) * 100);
    const shippingCents = Math.round(Number(order.shipping_fee) * 100);
    const productsFinalCents = originalTotalCents - discountCents;
    const finalTotalCents = Math.round(Number(order.total) * 100);

    if (
      units.length === 0 ||
      finalTotalCents <= 0 ||
      discountCents < 0 ||
      discountCents > originalTotalCents ||
      shippingCents < 0 ||
      productsFinalCents + shippingCents !== finalTotalCents
    ) {
      throw new Error("Os valores do pedido não conferem com os itens e a entrega.");
    }

    const allocations = units.map((unit) => {
      const exactShare = originalTotalCents > 0
        ? (discountCents * unit.originalCents) / originalTotalCents
        : 0;
      const cents = Math.floor(exactShare);
      return { ...unit, discountCents: cents, remainder: exactShare - cents };
    });

    let centsLeft = discountCents - allocations.reduce(
      (sum, item) => sum + item.discountCents,
      0
    );

    allocations
      .map((item, index) => ({ index, remainder: item.remainder }))
      .sort((a, b) => b.remainder - a.remainder)
      .slice(0, centsLeft)
      .forEach(({ index }) => {
        allocations[index].discountCents += 1;
      });

    const paymentItems = allocations.map((unit) => ({
      title: unit.title,
      quantity: 1,
      unit_price: ((unit.originalCents - unit.discountCents) / 100).toFixed(2),
    }));

    if (shippingCents > 0) {
      paymentItems.push({
        title: "Entrega",
        quantity: 1,
        unit_price: (shippingCents / 100).toFixed(2),
      });
    }

    const paymentBody: Record<string, unknown> = {
      type: "online",
      processing_mode: "manual",
      capture_mode: "automatic_async",
      total_amount: (finalTotalCents / 100).toFixed(2),
      external_reference: orderId,
      description: `Pedido ${orderId}`,
      items: paymentItems,
    };

    if (
      verifiedCustomerEmail
    ) {
      paymentBody.payer = {
        email: verifiedCustomerEmail,
      };
    }

    mercadoPagoRequestStarted = true;
    let paymentResponse: Response;
    try {
      paymentResponse = await fetch(
        "https://api.mercadopago.com/v1/orders",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
            "X-Idempotency-Key": mercadoPagoIdempotencyKey(orderId),
          },
          body: JSON.stringify(paymentBody),
          signal: AbortSignal.timeout(15_000),
        }
      );
    } catch {
      // Timeout/erro de rede não prova que o provedor rejeitou a criação.
      // Preserva o pedido e reutiliza a mesma chave idempotente na repetição.
      createdOrderId = null;
      return NextResponse.json(
        { error: "A confirmação do pagamento demorou. Tente novamente sem alterar o pedido." },
        { status: 502, headers: { "Cache-Control": "no-store" } }
      );
    }

    // Uma resposta sem JSON válido não deve desviar o tratamento pelo status HTTP.
    // Em 2xx, mantém o pedido para reconciliação/idempotência; em 4xx definitivo,
    // o bloco abaixo ainda pode liberar a reserva com confirmação do banco.
    let paymentData: Record<string, unknown> = {};
    try {
      const parsedPaymentData: unknown = await paymentResponse.json();
      if (
        parsedPaymentData &&
        typeof parsedPaymentData === "object" &&
        !Array.isArray(parsedPaymentData)
      ) {
        paymentData = parsedPaymentData as Record<string, unknown>;
      }
    } catch {
      // Corpo ausente/inválido: a decisão de segurança usa o status HTTP.
    }

    if (
      !paymentResponse.ok ||
      !paymentData.checkout_url ||
      paymentData.id === undefined ||
      paymentData.id === null
    ) {
      console.error("ERRO MERCADO PAGO:", {
        status: paymentResponse.status,
        error: typeof paymentData?.error === "string" ? paymentData.error.slice(0, 120) : undefined,
        code: typeof paymentData?.code === "string" ? paymentData.code.slice(0, 80) : undefined,
      });

      // Respostas 4xx definitivas significam que o provedor rejeitou a criação.
      // Só libere o estoque se o banco confirmar o cancelamento do pedido.
      // 409/423, 429 e 5xx permanecem ambíguos e preservam a chave idempotente.
      if (!paymentResponse.ok && isDefinitiveOrderCreationRejection(paymentResponse.status)) {
        const canceled = await cancelOrder(orderId);
        createdOrderId = null;
        if (canceled) {
          return NextResponse.json(
            { error: "O provedor recusou esta tentativa. Inicie uma nova tentativa de compra." },
            { status: 409, headers: { "Cache-Control": "no-store" } }
          );
        }
        return NextResponse.json(
          { error: "A solicitação foi recusada, mas não foi possível confirmar a liberação do estoque. Tente novamente em instantes." },
          { status: 503, headers: { "Cache-Control": "no-store" } }
        );
      }

      // Timeout, conflito de idempotência, bloqueio temporário, limitação ou
      // erro do servidor não provam que o provedor deixou de criar a order.
      createdOrderId = null;
      return NextResponse.json(
        {
          error: "Não foi possível confirmar a criação do pagamento. Tente novamente sem alterar o pedido.",
        },
        { status: 502, headers: { "Cache-Control": "no-store" } }
      );
    }

    const mercadoPagoOrderId = String(paymentData.id);

    const { data: linkedOrder, error: savePaymentIdError } =
      await getSupabaseAdmin()
        .from("orders")
        .update({
          mercado_pago_order_id: mercadoPagoOrderId,
        })
        .eq("id", orderId)
        .select("id,mercado_pago_order_id")
        .maybeSingle();

    if (
      savePaymentIdError ||
      !linkedOrder ||
      linkedOrder.mercado_pago_order_id !== mercadoPagoOrderId
    ) {
      console.error(
        "ERRO AO CONFIRMAR VÍNCULO DO PEDIDO COM MERCADO PAGO:",
        savePaymentIdError
      );

      // Não liberar o checkout sem gravar o vínculo que o webhook exige.
      // O pedido e a Order externa são preservados: a repetição usa a mesma
      // chave idempotente e tenta salvar novamente o mesmo identificador.
      createdOrderId = null;
      return NextResponse.json(
        { error: "O pagamento foi iniciado, mas a confirmação do vínculo está pendente. Tente novamente em instantes." },
        { status: 503 }
      );
    }

    return NextResponse.json({
      success: true,
      orderId,
      mercadoPagoOrderId,
      checkoutUrl: paymentData.checkout_url,
    });
  } catch (error) {
    console.error("ERRO GERAL NO CHECKOUT:", error);

    // Antes de chamar o Mercado Pago, é seguro desfazer a reserva do pedido.
    // Depois do início da chamada externa, preservamos o pedido para que uma
    // repetição use a mesma chave idempotente e não gere um pagamento duplicado.
    if (createdOrderId && !mercadoPagoRequestStarted) {
      await cancelOrder(createdOrderId);
    }

    return NextResponse.json(
      { error: "Ocorreu um erro ao iniciar o pagamento. Tente novamente." },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}

