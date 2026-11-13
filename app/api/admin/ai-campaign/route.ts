import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

async function isAdmin(request: NextRequest) {
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

export async function POST(request: NextRequest) {
  if (!(await isAdmin(request))) {
    return errorResponse("Acesso administrativo não autorizado.", 401);
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return errorResponse("A chave do Gemini não está configurada no servidor.", 500);
  }

  let body: {
    objective?: string;
    product?: string;
    offer?: string;
    audience?: string;
    tone?: string;
  };

  try {
    body = await request.json();
  } catch {
    return errorResponse("Não foi possível ler os dados enviados.", 400);
  }

  const objective = String(body.objective || "").trim().slice(0, 500);
  const product = String(body.product || "").trim().slice(0, 300);
  const offer = String(body.offer || "").trim().slice(0, 500);
  const audience = String(body.audience || "").trim().slice(0, 300);
  const tone = String(body.tone || "Persuasivo e profissional").trim().slice(0, 100);

  if (!objective && !product && !offer) {
    return errorResponse("Informe o objetivo, o produto ou a oferta da campanha.", 400);
  }

  const prompt = `Você é o assistente de marketing da NOVASHOPP STORE, uma loja virtual brasileira.
Crie uma proposta de campanha publicitária clara, profissional e comercialmente atraente, em português brasileiro.

REGRAS:
- Não invente preço, percentual de desconto, prazo, frete grátis, estoque, garantia ou características de produto.
- Só mencione condições comerciais que estejam expressamente nos dados fornecidos.
- Se os dados não informarem desconto ou preço, não crie números nem sugira que existe desconto.
- Evite urgência falsa como "últimas unidades" ou "só hoje", salvo se isso estiver informado.
- Título curto e chamativo; subtítulo complementar; descrição objetiva e convincente.
- O botão deve ter uma chamada curta, como "Confira agora" ou "Ver oferta".
- Dê uma ideia visual para foto/vídeo/banner, sem afirmar que a arte foi criada.
- Sugira um local da página: hero (banner principal), middle (entre seções) ou bottom (próximo ao final).
- A proposta é apenas um rascunho. O administrador revisará e decidirá se salva ou publica.
- Responda somente JSON válido com as chaves: title, subtitle, description, button_text, placement, visual_idea (todas strings).

DADOS DA CAMPANHA:
Objetivo: ${objective || "Não informado"}
Produto ou categoria: ${product || "Não informado"}
Oferta/condições confirmadas: ${offer || "Não informado"}
Público: ${audience || "Público geral"}
Tom: ${tone}`;

  try {
    const models = ["gemini-3.8-flash", "gemini-3.5-flash-lite"];
    let result: any = null;
    let lastProviderMessage = "O serviço Gemini está temporariamente indisponível.";

    for (const model of models) {
      const response = await fetch(
        "https://generativelanguage.googleapis.com/v1beta/interactions",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": apiKey,
          },
          body: JSON.stringify({
            model,
            input: [{ type: "text", text: prompt }],
            response_format: {
              type: "text",
              mime_type: "application/json",
              schema: {
                type: "object",
                properties: {
                  title: { type: "string" },
                  subtitle: { type: "string" },
                  description: { type: "string" },
                  button_text: { type: "string" },
                  placement: { type: "string", enum: ["hero", "middle", "bottom"] },
                  visual_idea: { type: "string" },
                },
                required: ["title", "subtitle", "description", "button_text", "placement", "visual_idea"],
              },
            },
            store: false,
          }),
          signal: AbortSignal.timeout(45000),
        }
      );

      result = await response.json();
      if (response.ok) break;

      lastProviderMessage = result?.error?.message || lastProviderMessage;
      const retryable = response.status === 429 || response.status === 503 ||
        /high demand|overload|temporar|unavailable|resource exhausted/i.test(lastProviderMessage);

      if (!retryable || model === models[models.length - 1]) {
        return errorResponse(
          retryable
            ? "Os modelos do Gemini estão temporariamente ocupados. Tente novamente mais tarde."
            : lastProviderMessage,
          response.status === 429 ? 429 : 502
        );
      }
    }

    if (!result) return errorResponse("Não foi possível obter uma resposta do Gemini.", 502);

    const outputText =
      result?.output_text ||
      result?.steps
        ?.filter((step: { type?: string }) => step.type === "model_output")
        ?.flatMap((step: { content?: Array<{ type?: string; text?: string }> }) => step.content || [])
        ?.filter((item: { type?: string }) => item.type === "text")
        ?.map((item: { text?: string }) => item.text || "")
        ?.join("");

    const rawText = String(outputText || "").trim();
    if (!rawText) return errorResponse("A IA não retornou uma proposta. Tente novamente.", 502);

    let generated: any;
    try {
      generated = JSON.parse(rawText);
    } catch {
      return errorResponse("A resposta da IA veio em formato inesperado. Tente novamente.", 502);
    }

    const placement = ["hero", "middle", "bottom"].includes(generated.placement)
      ? generated.placement
      : "hero";

    return NextResponse.json({
      title: String(generated.title || "").slice(0, 100),
      subtitle: String(generated.subtitle || "").slice(0, 180),
      description: String(generated.description || "").slice(0, 1200),
      button_text: String(generated.button_text || "Confira").slice(0, 40),
      placement,
      visual_idea: String(generated.visual_idea || "").slice(0, 1000),
    });
  } catch {
    return errorResponse("Não foi possível conectar ao Gemini. Tente novamente em instantes.", 502);
  }
}
