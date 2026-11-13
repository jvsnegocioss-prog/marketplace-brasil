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

function parseJsonContent(value: unknown) {
  let text = typeof value === "string" ? value.trim() : "";
  text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) text = text.slice(start, end + 1);
  return JSON.parse(text);
}

export async function POST(request: NextRequest) {
  if (!(await isAdmin(request))) {
    return errorResponse("Acesso administrativo não autorizado.", 401);
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return errorResponse("Configure OPENROUTER_API_KEY nas variáveis de ambiente da Vercel para ativar a IA gratuita.", 503);
  }

  let body: {
    objective?: string;
    product?: string;
    offer?: string;
    audience?: string;
    tone?: string;
    imageBase64?: string;
    imageMimeType?: string;
  };

  try {
    body = await request.json();
  } catch {
    return errorResponse("Não foi possível ler os dados enviados.", 400);
  }

  const objective = String(body.objective || "").trim().slice(0, 500);
  const product = String(body.product || "").trim().slice(0, 300);
  const offer = String(body.offer || "").trim().slice(0, 500);
  const audience = body.audience ? String(body.audience).trim().slice(0, 300) : "";
  const tone = body.tone ? String(body.tone).trim().slice(0, 100) : "Persuasivo e profissional";
  const imageBase64 = body.imageBase64 ? String(body.imageBase64) : "";
  const imageMimeType = String(body.imageMimeType || "");
  const hasImage = Boolean(imageBase64);
  const allowedImageTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];

  if (!objective && !product && !offer && !hasImage) {
    return errorResponse("Preencha os detalhes da campanha ou envie uma imagem para a IA analisar.", 400);
  }
  if (hasImage && (!allowedImageTypes.includes(imageMimeType) || imageBase64.length > 11_200_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(imageBase64))) {
    return errorResponse("Imagem inválida ou muito grande. Envie JPG, PNG, WEBP ou GIF de até 8 MB.", 400);
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
- Responda somente um objeto JSON válido com as chaves: title, subtitle, description, button_text, placement, visual_idea (todas strings).

DADOS DA CAMPANHA:
Objetivo: ${objective || "Não informado"}
Produto ou categoria: ${product || "Não informado"}
Oferta/condições confirmadas: ${offer || "Não informado"}
Público: ${audience || "Público geral"}
Tom: ${tone}

${hasImage ? "ANALISE TAMBÉM A IMAGEM ENVIADA: identifique visualmente o produto, cores, estilo, textos e informações que estejam realmente legíveis. Use a imagem como referência mesmo que os demais campos estejam vazios. Não presuma preço, desconto, marca, especificações ou condições que não estejam claramente visíveis ou informadas. Se houver texto ilegível, não o invente." : ""}`;

  try {
    const userContent: Array<Record<string, unknown>> = [{ type: "text", text: prompt }];
    if (hasImage) {
      userContent.push({
        type: "image_url",
        image_url: { url: `data:${imageMimeType};base64,${imageBase64}` },
      });
    }

    // O roteador e o modelo visual são exclusivamente gratuitos.
    // Não adicionar modelos pagos a esta lista nem configurar fallback pago.
    const model = hasImage
      ? "nvidia/nemotron-3.5-super-vl:free"
      : "openrouter/free";

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://novashoppstore.vercel.app",
        "X-Title": "NOVASHOPP STORE - Assistente de Publicidade",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: "Você cria campanhas de marketing em português brasileiro. Siga rigorosamente as instruções e retorne somente JSON válido." },
          { role: "user", content: userContent },
        ],
        temperature: 0.7,
        max_tokens: 1200,
        response_format: { type: "json_object" },
      }),
      signal: AbortSignal.timeout(60000),
    });

    const result = await response.json();
    if (!response.ok) {
      const providerMessage = String(result?.error?.message || "");
      if (response.status === 429) {
        return errorResponse("O limite gratuito de solicitações foi atingido ou o modelo está ocupado. Aguarde um pouco e tente novamente.", 429);
      }
      if (response.status === 402) {
        return errorResponse("O provedor recusou a solicitação por configuração de créditos. Nenhum modelo pago será utilizado; confira se a chave e o modelo gratuito estão corretos.", 502);
      }
      if (response.status === 404 && hasImage) {
        return errorResponse("O modelo gratuito de análise de imagem está temporariamente indisponível. Tente novamente mais tarde ou use a criação por texto.", 502);
      }
      return errorResponse(providerMessage.slice(0, 500) || "O serviço gratuito de IA está temporariamente indisponível. Tente novamente.", 502);
    }

    const messageContent = result?.choices?.[0]?.message?.content;
    const rawText = typeof messageContent === "string"
      ? messageContent
      : Array.isArray(messageContent)
        ? messageContent.map((part: { text?: string }) => part.text || "").join("")
        : "";

    if (!rawText.trim()) {
      return errorResponse("A IA não retornou uma proposta. Tente novamente.", 502);
    }

    let generated: any;
    try {
      generated = parseJsonContent(rawText);
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
    return errorResponse("Não foi possível conectar ao OpenRouter. Tente novamente em instantes.", 502);
  }
}
