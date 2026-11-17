import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
const { isValidTrackingPhone } = require("../../../lib/tracking-phone-validation.cjs");

export const runtime = "nodejs";

let supabaseAdmin: ReturnType<typeof createClient<any>> | null = null;

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Configuração do Supabase indisponível.");
  if (!supabaseAdmin) supabaseAdmin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  return supabaseAdmin;
}

function getClientIp(request: Request) {
  // Use only the platform-provided client IP header. Never trust the
  // left-most x-forwarded-for value, which can contain client-supplied data.
  return (request.headers.get("x-real-ip") || "").trim();
}

async function readLimitedJson(request: Request): Promise<
  { ok: true; value: unknown } | { ok: false; status: 400 | 413 }
> {
  if (!request.body) return { ok: false, status: 400 };
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let totalBytes = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > 4000) {
        await reader.cancel();
        return { ok: false, status: 413 };
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, status: 400 };
  } finally {
    reader.releaseLock();
  }
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

    const contentLength = Number(request.headers.get("content-length") || 0);
    if (Number.isFinite(contentLength) && contentLength > 4000) {
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
    const orderNumber = typeof body.orderNumber === "string" ? body.orderNumber.trim().replace(/^#\s*/, "") : "";
    const phone = typeof body.phone === "string" ? body.phone.trim() : "";

    if (!orderNumber || orderNumber.length > 120 || !phone || phone.length > 40 || !isValidTrackingPhone(phone)) {
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
    const { data: allowed, error: limitError } = await getSupabaseAdmin().rpc(
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

    const { data, error } = await getSupabaseAdmin().rpc("track_customer_order", {
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
