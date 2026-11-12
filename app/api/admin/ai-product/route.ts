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
  const prompt = `Você é redatora sênior de e-commerce e especialista em conversão da NOVASHOPP STORE.
Sua tarefa é criar um cadastro de produto de qualidade profissional, em português do Brasil, pronto para revisão humana.

ENTREGUE UM CONTEÚDO REALMENTE COMPLETO:
- nome_sugerido: título comercial claro, específico e natural, com tipo de produto e características confirmadas. Evite repetição e exageros.
- descricao: escreva entre 3 e 5 parágrafos curtos, com linguagem persuasiva e natural. Comece explicando o que é o produto e para que serve; depois apresente apenas características confirmadas; explique benefícios práticos que decorram diretamente dessas características; finalize com uma chamada comercial discreta. Não entregue uma frase genérica nem uma lista de palavras-chave.
- beneficios: 3 a 5 benefícios concretos, somente quando sustentados pelos dados ou pela imagem.
- dados_a_confirmar: liste informações importantes que não podem ser comprovadas, para o administrador confirmar antes de publicar.
- palavras_chave: termos relevantes para busca, sem repetir variações inúteis.

REGRAS DE CONFIABILIDADE:
- A foto pode ajudar a identificar a aparência e objetos claramente visíveis, mas não prova que todos os objetos mostrados acompanham o produto.
- Nunca diga que um acessório, cabo, pulseira extra, manual, carregador ou item acompanha o produto, a menos que o administrador tenha confirmado expressamente isso nos dados.
- Nunca invente marca, modelo, material, medidas, compatibilidade, potência, capacidade, funções, sensores, resistência à água, certificações, autonomia, garantia ou especificações.
- Não deduza recursos técnicos ou de saúde pela aparência. Não transforme possibilidades em fatos.
- Se os dados forem escassos, escreva uma descrição atraente, porém honesta, e deixe os detalhes desconhecidos em dados_a_confirmar.
- Não use superlativos vazios como "o melhor", "revolucionário" ou "imperdível".
- Não inclua preço, desconto, frete, estoque, prazo, garantia ou promessa não fornecida.
- O preço, estoque e decisões comerciais pertencem exclusivamente ao administrador.
- Responda somente em JSON válido, com as chaves: nome_sugerido (string), descricao (string), beneficios (array de strings), dados_a_confirmar (array de strings), palavras_chave (array de strings).

DADOS INFORMADOS PELO ADMINISTRADOR:
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
