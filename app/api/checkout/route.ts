
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);

async function cancelOrder(orderId: string) {
  const { error } = await supabaseAdmin.rpc(
    "cancel_unpaid_order_and_restore_stock",
    { p_order_id: orderId }
  );

  if (error) {
    console.error("ERRO AO RESTAURAR ESTOQUE:", error);
  }
}

export async function POST(request: Request) {
  if (process.env.STORE_SALES_ENABLED !== "true") {
    return NextResponse.json(
      { error: "As vendas estão temporariamente suspensas. Em breve voltaremos!" },
      { status: 503 }
    );
  }

  let createdOrderId: string | null = null;

  try {
    const body = await request.json();

    const {
      customerName,
      customerEmail,
      customerPhone,
      deliveryAddress,
      items,
      couponCode,
    } = body;

    if (
      typeof customerName !== "string" ||
      !customerName.trim() ||
      typeof customerPhone !== "string" ||
      !customerPhone.trim() ||
      typeof deliveryAddress !== "string" ||
      !deliveryAddress.trim() ||
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

      // Usa o e-mail confirmado da sessão, nunca um e-mail enviado livremente pelo navegador.
      verifiedCustomerEmail = customerAuth.user.email;
    }

    const accessToken = process.env.MERCADO_PAGO_ACCESS_TOKEN;

    if (!accessToken) {
      return NextResponse.json(
        { error: "Configuração do Mercado Pago não encontrada." },
        { status: 500 }
      );
    }

    const { data: orderId, error: orderError } =
      await supabaseAdmin.rpc("create_store_order_with_coupon", {
        p_customer_name: customerName.trim(),
        p_customer_email: verifiedCustomerEmail,
        p_customer_phone: customerPhone.trim(),
        p_delivery_address: deliveryAddress.trim(),
        p_coupon_code: typeof couponCode === "string" ? couponCode : null,
        p_items: items.map(
          (item: { id: string; qty: number }) => ({
            id: item.id,
            qty: item.qty,
          })
        ),
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
        .select("id,total,discount_amount,coupon_code")
        .eq("id", orderId)
        .single();

    if (fetchOrderError || !order) {
      console.error("ERRO AO BUSCAR PEDIDO:", fetchOrderError);

      await cancelOrder(orderId);
      createdOrderId = null;

      return NextResponse.json(
        {
          error: "Falha ao consultar o pedido.",
          detalhe: fetchOrderError?.message || "Pedido não encontrado.",
        },
        { status: 500 }
      );
    }

    const { data: orderItems, error: itemsError } =
      await supabaseAdmin
        .from("order_items")
        .select("product_name,quantity,unit_price")
        .eq("order_id", orderId);

    if (itemsError || !orderItems?.length) {
      console.error("ERRO AO BUSCAR ITENS:", itemsError);

      await cancelOrder(orderId);
      createdOrderId = null;

      return NextResponse.json(
        {
          error: "Falha ao consultar os itens do pedido.",
          detalhe: itemsError?.message || "Nenhum item encontrado.",
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
    const finalTotalCents = Math.round(Number(order.total) * 100);
    const discountCents = originalTotalCents - finalTotalCents;

    if (
      units.length === 0 ||
      finalTotalCents <= 0 ||
      discountCents < 0
    ) {
      throw new Error("Os valores do pedido não conferem com os itens.");
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

    const paymentResponse = await fetch(
      "https://api.mercadopago.com/v1/orders",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "X-Idempotency-Key": crypto.randomUUID(),
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

      await cancelOrder(orderId);
      createdOrderId = null;

      return NextResponse.json(
        {
          error: "Não foi possível gerar o pagamento.",
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

    if (createdOrderId) {
      await cancelOrder(createdOrderId);
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

