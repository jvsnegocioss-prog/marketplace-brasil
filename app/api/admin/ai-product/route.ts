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
    name?: string;
    description?: string;
    category?: string;
    imageBase64?: string;
    imageMimeType?: string;
    imageUrl?: string;
  };

  try {
    body = await request.json();
  } catch {
    return errorResponse("Não foi possível ler os dados enviados.", 400);
  }

  const name = String(body.name || "").trim().slice(0, 180);
  const description = String(body.description || "").trim().slice(0, 4000);
  const category = String(body.category || "").trim().slice(0, 120);

  if (!name && !description && !category && !body.imageBase64 && !body.imageUrl) {
    return errorResponse("Informe o nome, a categoria, a descrição ou a foto do produto.", 400);
  }

  const parts: Array<Record<string, unknown>> = [];
  const prompt = `Você é especialista sênior em descrição de produtos para e-commerce da NOVASHOPP STORE.
Sua prioridade é DESCREVER O PRODUTO EM SI, não fazer uma lista da embalagem.

CRIE:
- nome_sugerido: título claro com tipo e modelo somente se confirmados.
- descricao: texto comercial completo, com 3 a 5 parágrafos curtos e informativos. Explique o que é o produto, sua finalidade, design e características confirmadas, como pode ser usado no dia a dia e quais vantagens reais oferece. Use linguagem natural, específica e útil para ajudar o cliente a decidir a compra. Evite frases genéricas e repetição.
- beneficios: 3 a 5 vantagens práticas sustentadas por características confirmadas.
- dados_a_confirmar: perguntas objetivas sobre funções, especificações e compatibilidade que não podem ser comprovadas.
- palavras_chave: termos de busca específicos e relevantes.

REGRA MUITO IMPORTANTE SOBRE A EMBALAGEM:
- Não transforme a descrição em uma prévia ou inventário do que vem na caixa.
- Não use a lista de acessórios como assunto principal.
- Só mencione itens da embalagem em uma frase final curta e somente se o administrador os tiver confirmado expressamente.
- A presença de um objeto na foto NÃO comprova que ele acompanha o produto.
- Se a informação recebida falar principalmente da embalagem, use-a apenas como contexto secundário; concentre a descrição no produto.
- Não invente funções para preencher espaço. Se faltarem dados técnicos, deixe isso claro em dados_a_confirmar e escreva uma descrição honesta com o que realmente se sabe.

CONFIABILIDADE:
- Não invente marca, modelo, material, dimensões, compatibilidade, potência, capacidade, funções, sensores, resistência à água, certificações, autonomia, garantia ou especificações.
- Não deduza funções técnicas ou de saúde pela aparência da foto.
- Não diga que o relógio recebe notificações, faz chamadas, mede saúde ou tem GPS/Bluetooth sem confirmação nos dados.
- Não inclua preço, desconto, frete, estoque, prazo ou promessas comerciais.
- O administrador decide preço, estoque e conteúdo final.
- Responda somente em JSON válido com as chaves: nome_sugerido (string), descricao (string), beneficios (array de strings), dados_a_confirmar (array de strings), palavras_chave (array de strings).

DADOS INFORMADOS PELO ADMINISTRADOR:
Nome atual: ${name || "Não informado"}
Categoria: ${category || "Não informada"}
Informações e características fornecidas: ${description || "Não informado"}`;

  parts.push({ text: prompt });

  let imageData = body.imageBase64 || "";
  let mimeType = body.imageMimeType || "";

  if (!imageData && body.imageUrl) {
    try {
      const imageUrl = new URL(body.imageUrl);
      const trustedHost = new URL(supabaseUrl).host;
      if (
        imageUrl.host !== trustedHost ||
        !imageUrl.pathname.includes("/storage/v1/object/public/products-images/")
      ) {
        return errorResponse("A imagem informada não pertence ao armazenamento público de produtos da loja.", 400);
      }
      const imageResponse = await fetch(imageUrl.toString(), { signal: AbortSignal.timeout(12000) });
      if (!imageResponse.ok) return errorResponse("Não foi possível acessar a foto atual do produto.", 400);
      const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
      if (imageBuffer.byteLength > 2.5 * 1024 * 1024) {
        return errorResponse("A foto deve ter no máximo 2,5 MB para análise.", 413);
      }
      mimeType = imageResponse.headers.get("content-type") || "image/jpeg";
      if (!["image/jpeg", "image/png", "image/webp"].includes(mimeType)) {
        return errorResponse("A foto deve estar em JPG, PNG ou WEBP.", 400);
      }
      imageData = imageBuffer.toString("base64");
    } catch {
      return errorResponse("Não foi possível carregar a foto atual do produto.", 400);
    }
  }

  if (imageData) {
    if (!["image/jpeg", "image/png", "image/webp"].includes(mimeType)) {
      return errorResponse("Formato de foto não permitido. Use JPG, PNG ou WEBP.", 400);
    }
    if (imageData.length > 3_500_000) {
      return errorResponse("A foto deve ter no máximo 2,5 MB.", 413);
    }
    parts.push({ inline_data: { mime_type: mimeType, data: imageData } });
  }

  try {
    const input: Array<Record<string, unknown>> = [
      { type: "text", text: prompt },
    ];

    if (imageData) {
      input.push({
        type: "image",
        data: imageData,
        mime_type: mimeType,
      });
    }

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
            input,
            response_format: {
              type: "text",
              mime_type: "application/json",
              schema: {
                type: "object",
                properties: {
                  nome_sugerido: { type: "string" },
                  descricao: { type: "string" },
                  beneficios: { type: "array", items: { type: "string" } },
                  dados_a_confirmar: { type: "array", items: { type: "string" } },
                  palavras_chave: { type: "array", items: { type: "string" } },
                },
                required: [
                  "nome_sugerido",
                  "descricao",
                  "beneficios",
                  "dados_a_confirmar",
                  "palavras_chave",
                ],
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
            ? "Os modelos gratuitos do Gemini estão temporariamente sobrecarregados. Tente novamente mais tarde."
            : lastProviderMessage,
          response.status === 429 ? 429 : 502
        );
      }
    }

    if (!result) {
      return errorResponse("Não foi possível obter uma resposta do Gemini.", 502);
    }

    const outputText =
      result?.output_text ||
      result?.steps
        ?.filter((step: { type?: string }) => step.type === "model_output")
        ?.flatMap((step: { content?: Array<{ type?: string; text?: string }> }) => step.content || [])
        ?.filter((item: { type?: string }) => item.type === "text")
        ?.map((item: { text?: string }) => item.text || "")
        ?.join("");

    const text = String(outputText || "").trim();
    if (!text) return errorResponse("A IA não retornou uma descrição. Tente novamente.", 502);

    let generated;
    try {
      generated = JSON.parse(text);
    } catch {
      return errorResponse("A resposta da IA veio em formato inesperado. Tente novamente.", 502);
    }

    return NextResponse.json({
      nome_sugerido: String(generated.nome_sugerido || name || "").slice(0, 180),
      descricao: String(generated.descricao || "").slice(0, 5000),
      beneficios: Array.isArray(generated.beneficios) ? generated.beneficios.map(String).slice(0, 10) : [],
      dados_a_confirmar: Array.isArray(generated.dados_a_confirmar) ? generated.dados_a_confirmar.map(String).slice(0, 10) : [],
      palavras_chave: Array.isArray(generated.palavras_chave) ? generated.palavras_chave.map(String).slice(0, 15) : [],
    });
  } catch {
    return errorResponse("Não foi possível conectar ao Gemini. Tente novamente em instantes.", 502);
  }
}
