
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
    console.error("Erro ao restaurar estoque:", error);
  }
}

export async function POST(request: Request) {
  let createdOrderId: string | null = null;

  try {
    const body = await request.json();

    const {
      customerName,
      customerEmail,
      customerPhone,
      deliveryAddress,
      items,
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

    const accessToken = process.env.MERCADO_PAGO_ACCESS_TOKEN;

    if (!accessToken) {
      return NextResponse.json(
        { error: "Configuração do Mercado Pago não encontrada." },
        { status: 500 }
      );
    }

    const { data: orderId, error: orderError } =
      await supabaseAdmin.rpc("create_store_order", {
        p_customer_name: customerName.trim(),
        p_customer_email:
          typeof customerEmail === "string"
            ? customerEmail.trim()
            : "",
        p_customer_phone: customerPhone.trim(),
        p_delivery_address: deliveryAddress.trim(),
        p_items: items.map(
          (item: { id: string; qty: number }) => ({
            id: item.id,
            qty: item.qty,
          })
        ),
      });

    if (orderError || !orderId) {
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
        .select("id,total")
        .eq("id", orderId)
        .single();

    const { data: orderItems, error: itemsError } =
      await supabaseAdmin
        .from("order_items")
        .select("product_name,quantity,unit_price")
        .eq("order_id", orderId);

    if (
      fetchOrderError ||
      itemsError ||
      !order ||
      !orderItems?.length
    ) {
      await cancelOrder(orderId);
      createdOrderId = null;

      return NextResponse.json(
        { error: "Não foi possível preparar o pagamento." },
        { status: 500 }
      );
    }

    const paymentBody: Record<string, unknown> = {
      type: "online",
      processing_mode: "manual",
      capture_mode: "automatic_async",
      total_amount: Number(order.total).toFixed(2),
      external_reference: orderId,
      description: `Pedido ${orderId}`,
      items: orderItems.map((item) => ({
        title: item.product_name,
        quantity: Number(item.quantity),
        unit_price: Number(item.unit_price).toFixed(2),
      })),
    };

    if (
      typeof customerEmail === "string" &&
      customerEmail.trim()
    ) {
      paymentBody.payer = {
        email: customerEmail.trim(),
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
      console.error("Erro Mercado Pago:", paymentData);

      await cancelOrder(orderId);
      createdOrderId = null;

      return NextResponse.json(
        {
          error:
            "Não foi possível gerar o pagamento. O pedido foi cancelado e o estoque restaurado.",
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
        "Erro ao salvar ID do Mercado Pago:",
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
    console.error("Erro no checkout:", error);

    if (createdOrderId) {
      await cancelOrder(createdOrderId);
    }

    return NextResponse.json(
      { error: "Ocorreu um erro ao iniciar o pagamento." },
      { status: 500 }
    );
  }
}
