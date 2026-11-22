
import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function mercadoPagoIdempotencyKey(orderId: string) {
  const hex = createHash("sha256").update(`novashopp-checkout:${orderId}`).digest("hex").slice(0, 32).split("");
  hex[12] = "5";
  hex[16] = ((parseInt(hex[16], 16) & 3) | 8).toString(16);
  const value = hex.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

type SupabaseAdminClient = ReturnType<typeof createClient<any>>;

async function cancelOrder(
  supabaseAdmin: SupabaseAdminClient,
  orderId: string
): Promise<{ confirmed: boolean; outcome?: string; message?: string }> {
  const rpc = supabaseAdmin.rpc as unknown as (
    functionName: string,
    args: { p_order_id: string }
  ) => Promise<{
    data: { outcome?: string } | null;
    error: { message: string } | null;
  }>;

  const { data, error } = await rpc(
    "cancel_unpaid_order_and_restore_stock",
    { p_order_id: orderId }
  );

  if (error) {
    console.error("ERRO AO RESTAURAR ESTOQUE:", error);
    return { confirmed: false, message: error.message };
  }

  const outcome = data?.outcome;
  return {
    confirmed: outcome === "cancelled" || outcome === "already_restored",
    outcome,
    message: outcome ? undefined : "A RPC não confirmou o resultado do cancelamento.",
  };
}

export async function POST(request: Request) {
  if (process.env.STORE_SALES_ENABLED !== "true") {
    return NextResponse.json(
      { error: "As vendas estão temporariamente suspensas. Em breve voltaremos!" },
      { status: 503 }
    );
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json(
      { error: "Configuração do serviço indisponível." },
      { status: 503 }
    );
  }

  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  let createdOrderId: string | null = null;
  let mercadoPagoRequestStarted = false;

  try {
    const body = await request.json();

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

    let verifiedCustomerEmail =
      typeof customerEmail === "string" ? customerEmail.trim() : "";
    let authenticatedCustomerUserId: string | null = null;

    const authorization = request.headers.get("authorization") || "";
    if (authorization.startsWith("Bearer ")) {
      const customerAccessToken = authorization.slice(7);
      const { data: customerAuth, error: customerAuthError } =
        await supabaseAdmin.auth.getUser(customerAccessToken);

      if (customerAuthError || !customerAuth.user?.email) {
        return NextResponse.json(
          { error: "Sua sessão da conta expirou. Entre novamente ou finalize como visitante." },
          { status: 401 }
        );
      }

      // Usa os dados confirmados da sessão, nunca os dados de identidade enviados livremente pelo navegador.
      verifiedCustomerEmail = customerAuth.user.email;
      authenticatedCustomerUserId = customerAuth.user.id;
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
      customerName: customerName.trim(),
      customerEmail: verifiedCustomerEmail,
      customerPhone: customerPhone.trim(),
      deliveryAddress: deliveryAddress.trim(),
      couponCode: typeof couponCode === "string" ? couponCode.trim().toUpperCase() : null,
      deliveryNeighborhoodId,
      items: normalizedItems,
    })).digest("hex");

    const { data: orderId, error: orderError } =
      await supabaseAdmin.rpc("create_store_order_with_coupon_and_delivery_for_customer", {
        p_customer_name: customerName.trim(),
        p_customer_email: verifiedCustomerEmail,
        p_customer_phone: customerPhone.trim(),
        p_delivery_address: deliveryAddress.trim(),
        p_coupon_code: typeof couponCode === "string" ? couponCode : null,
        p_delivery_neighborhood_id: deliveryNeighborhoodId,
        p_items: normalizedItems,
        p_checkout_idempotency_key: checkoutIdempotencyKey,
        p_checkout_request_hash: requestHash,
        p_customer_user_id: authenticatedCustomerUserId,
      });

    if (orderError || !orderId) {
      console.error("ERRO AO CRIAR PEDIDO:", orderError);

      return NextResponse.json(
        {
          error:
            "Não foi possível registrar o pedido: " +
            (orderError?.message || "erro desconhecido"),
        },
        { status: 400 }
      );
    }

    createdOrderId = orderId;

    const { data: order, error: fetchOrderError } =
      await supabaseAdmin
        .from("orders")
        .select("id,status,total,discount_amount,coupon_code,shipping_fee")
        .eq("id", orderId)
        .single();

    if (fetchOrderError || !order) {
      console.error("ERRO AO BUSCAR PEDIDO:", fetchOrderError);

      const cancellation = await cancelOrder(supabaseAdmin, orderId);
      if (cancellation.confirmed) createdOrderId = null;

      return NextResponse.json(
        {
          error: cancellation.confirmed
            ? "Falha ao consultar o pedido; a reserva foi cancelada."
            : "Falha ao consultar o pedido e não foi possível confirmar a liberação do estoque. Não refaça a compra; entre em contato com o suporte.",
          orderId,
          detalhe: cancellation.message || fetchOrderError?.message || "Pedido não encontrado.",
        },
        { status: cancellation.confirmed ? 500 : 503 }
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
      await supabaseAdmin
        .from("order_items")
        .select("product_name,quantity,unit_price")
        .eq("order_id", orderId);

    if (itemsError || !orderItems?.length) {
      console.error("ERRO AO BUSCAR ITENS:", itemsError);

      const cancellation = await cancelOrder(supabaseAdmin, orderId);
      if (cancellation.confirmed) createdOrderId = null;

      return NextResponse.json(
        {
          error: cancellation.confirmed
            ? "Falha ao consultar os itens; a reserva foi cancelada."
            : "Falha ao consultar os itens e não foi possível confirmar a liberação do estoque. Não refaça a compra; entre em contato com o suporte.",
          orderId,
          detalhe: cancellation.message || itemsError?.message || "Nenhum item encontrado.",
        },
        { status: cancellation.confirmed ? 500 : 503 }
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
    const paymentResponse = await fetch(
      "https://api.mercadopago.com/v1/orders",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "X-Idempotency-Key": mercadoPagoIdempotencyKey(orderId),
        },
        body: JSON.stringify(paymentBody),
      }
    );

    const paymentData = await paymentResponse.json();

    if (
      !paymentResponse.ok ||
      !paymentData.checkout_url ||
      paymentData.id === undefined ||
      paymentData.id === null
    ) {
      console.error("ERRO MERCADO PAGO:", paymentData);

      // Mantém o pedido aguardando: a resposta pode ter sido perdida após
      // o Mercado Pago aceitar a solicitação. A repetição usará a mesma chave.
      createdOrderId = null;

      return NextResponse.json(
        {
          error: "Não foi possível confirmar a criação do pagamento. Tente novamente sem alterar o pedido.",
          detalhe: paymentData,
        },
        { status: 502 }
      );
    }

    const mercadoPagoOrderId = String(paymentData.id);

    const { error: savePaymentIdError } =
      await supabaseAdmin
        .from("orders")
        .update({
          mercado_pago_order_id: mercadoPagoOrderId,
        })
        .eq("id", orderId);

    if (savePaymentIdError) {
      console.error(
        "ERRO AO SALVAR ID MERCADO PAGO:",
        savePaymentIdError
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
      const cancellation = await cancelOrder(supabaseAdmin, createdOrderId);
      if (!cancellation.confirmed) {
        console.error("RESERVA DO PEDIDO PERMANECE PENDENTE DE RECONCILIAÇÃO:", {
          orderId: createdOrderId,
          message: cancellation.message,
        });
      }
    }

    return NextResponse.json(
      {
        error: "Ocorreu um erro ao iniciar o pagamento.",
        detalhe:
          error instanceof Error ? error.message : "Erro desconhecido.",
      },
      { status: 500 }
    );
  }
}

