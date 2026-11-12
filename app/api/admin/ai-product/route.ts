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
  const prompt = `Você é o assistente de cadastro e marketing da NOVASHOPP STORE, uma loja virtual brasileira.
Analise os dados e, se fornecida, a foto do produto. Gere um título comercial claro e uma descrição útil em português do Brasil.
REGRAS OBRIGATÓRIAS:
- Não invente marca, modelo, material, medidas, compatibilidade, potência, capacidade, certificações, acessórios ou especificações.
- Use somente o que estiver escrito nos dados ou for claramente visível na foto. Se houver dúvida, não afirme.
- Não deduza especificações técnicas apenas pela aparência.
- Se faltarem dados, faça uma descrição honesta e indique em "dados_a_confirmar" o que o administrador pode completar.
- Não inclua preço, desconto, frete, estoque, garantia ou promessa que não foi fornecida.
- O preço e todas as decisões comerciais são exclusivos do administrador.
- Responda somente em JSON válido, com as chaves: nome_sugerido (string), descricao (string), beneficios (array de strings), dados_a_confirmar (array de strings), palavras_chave (array de strings).
Dados informados pelo administrador:
Nome atual: ${name || "Não informado"}
Categoria: ${category || "Não informada"}
Descrição/detalhes: ${description || "Não informado"}`;

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

    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/interactions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({
          model: "gemini-3.8-flash",
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

    const result = await response.json();
    if (!response.ok) {
      const providerMessage = result?.error?.message || "Falha no serviço Gemini.";
      return errorResponse(providerMessage, response.status === 429 ? 429 : 502);
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
