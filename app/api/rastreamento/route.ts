import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

function getClientIp(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for");
  const realIp = request.headers.get("x-real-ip");
  return (forwarded?.split(",")[0] || realIp || "").trim();
}

export async function POST(request: Request) {
  try {
    const ip = getClientIp(request);
    if (!ip) {
      return NextResponse.json(
        { error: "Não foi possível validar a origem da consulta. Tente novamente." },
        { status: 503, headers: { "Cache-Control": "no-store" } }
      );
    }

    const body = await request.json();
    const orderNumber = typeof body.orderNumber === "string" ? body.orderNumber.trim().replace(/^#\\s*/, "") : "";
    const phone = typeof body.phone === "string" ? body.phone.trim() : "";

    if (!orderNumber || orderNumber.length > 120 || !phone || phone.length > 40) {
      return NextResponse.json(
        { error: "Informe o número do pedido e o telefone utilizado na compra." },
        { status: 400, headers: { "Cache-Control": "no-store" } }
      );
    }

    const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!secret) {
      return NextResponse.json(
        { error: "Serviço temporariamente indisponível." },
        { status: 503, headers: { "Cache-Control": "no-store" } }
      );
    }

    const ipHash = createHash("sha256").update(secret + ":" + ip).digest("hex");
    const { data: allowed, error: limitError } = await supabaseAdmin.rpc(
      "consume_order_tracking_attempt",
      { p_ip_hash: ipHash }
    );

    if (limitError || allowed !== true) {
      if (limitError) console.error("ERRO AO VALIDAR LIMITE DE RASTREAMENTO:", limitError);
      return NextResponse.json(
        { error: "Muitas tentativas de consulta. Aguarde 15 minutos e tente novamente." },
        { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": "900" } }
      );
    }

    const { data, error } = await supabaseAdmin.rpc("track_customer_order", {
      p_order_number: orderNumber,
      p_phone: phone,
    });

    if (error) {
      console.error("ERRO AO CONSULTAR RASTREAMENTO:", error);
      return NextResponse.json(
        { error: "Não foi possível consultar o pedido. Confira os dados e tente novamente." },
        { status: 500, headers: { "Cache-Control": "no-store" } }
      );
    }

    const result = Array.isArray(data) ? data[0] : data;
    if (!result) {
      return NextResponse.json(
        { error: "Não encontramos pedido com esses dados. Confira o número e o telefone." },
        { status: 404, headers: { "Cache-Control": "no-store" } }
      );
    }

    return NextResponse.json(
      { order: result },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("ERRO NA ROTA DE RASTREAMENTO:", error);
    return NextResponse.json(
      { error: "Ocorreu um erro na consulta. Tente novamente." },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
