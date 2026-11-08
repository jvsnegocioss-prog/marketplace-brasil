
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

export async function POST(request: Request) {
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
      !customerName?.trim() ||
      !customerPhone?.trim() ||
      !deliveryAddress?.trim() ||
      !Array.isArray(items) ||
      items.length === 0
    ) {
      return NextResponse.json(
        { error: "Preencha os dados obrigatórios e informe os produtos." },
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

    // Registra o pedido e reserva o estoque pelo procedimento existente.
    const { data: orderId, error: orderError } =
      await supabaseAdmin.rpc("create_store_order", {
        p_customer_name: customerName.trim(),
        p_customer_email: (customerEmail || "").trim(),
        p_customer_phone: customerPhone.trim(),
        p_delivery_address: deliveryAddress.trim(),
        p_items: items.map((item: { id: string; qty: number }) => ({
          id: item.id,
          qty: item.qty,
        })),
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
      return NextResponse.json(
        {
          error: "Pedido registrado, mas não foi possível preparar o pagamento.",
          orderId,
        },
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

    if (customerEmail?.trim()) {
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

    if (!paymentResponse.ok || !paymentData.checkout_url) {
      console.error("Mercado Pago:", paymentData);

      return NextResponse.json(
        {
          error:
            "O pedido foi registrado, mas o Mercado Pago não conseguiu gerar o pagamento. Entre em contato com a loja antes de tentar novamente.",
          orderId,
        },
        { status: 502 }
      );
    }

    return NextResponse.json({
      success: true,
      orderId,
      checkoutUrl: paymentData.checkout_url,
    });
  } catch (error) {
    console.error("Erro no checkout:", error);

    return NextResponse.json(
      { error: "Ocorreu um erro ao iniciar o pagamento." },
      { status: 500 }
    );
  }
}
