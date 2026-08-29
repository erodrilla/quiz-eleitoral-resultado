import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY")!;

function mapResposta(valor: string): string {
  const v = valor?.trim();
  if (v === "Favorável") return "Favorável";
  if (v === "Moderado") return "Moderado";
  return "Contrário";
}

function extrairResposta(fields: any[], prefixo: string): string {
  const field = fields.find((f: any) =>
    f.label?.includes(`[${prefixo}]`)
  );
  const valor = Array.isArray(field?.value)
    ? field.value[0]
    : field?.value ?? "Moderado";
  return mapResposta(valor);
}

serve(async (req) => {
  try {
    const body = await req.json();

    const fields = body?.data?.fields ?? [];
    const id_sessao = body?.data?.submissionId ?? crypto.randomUUID();

    const mulheres      = extrairResposta(fields, "Mulheres");
    const educacao      = extrairResposta(fields, "Educação");
    const meio_ambiente = extrairResposta(fields, "Meio Ambiente");
    const impostos      = extrairResposta(fields, "Impostos");
    const direitos      = extrairResposta(fields, "Direitos");
    const seguranca     = extrairResposta(fields, "Segurança");
    const transparencia = extrairResposta(fields, "Transparência");

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    const { data: match, error: matchError } = await supabase.rpc(
      "match_completo",
      {
        p_mulheres:       mulheres,
        p_educacao:       educacao,
        p_meio_ambiente:  meio_ambiente,
        p_impostos:       impostos,
        p_direitos:       direitos,
        p_seguranca:      seguranca,
        p_transparencia:  transparencia,
      }
    );

    if (matchError || !match?.length) {
      throw new Error("match_completo falhou: " + JSON.stringify(matchError));
    }

    const candidato = match[0];

    const prompt = `Você é um assistente eleitoral progressista brasileiro.
Em 2 frases curtas e diretas, explique por que ${candidato.nome_urna} (${candidato.partido}) 
é o candidato mais compatível com este eleitor, com base nas posições dele:
- Mulheres: ${mulheres}
- Educação: ${educacao}
- Meio Ambiente: ${meio_ambiente}
- Impostos: ${impostos}
- Direitos: ${direitos}
- Segurança: ${seguranca}
- Transparência: ${transparencia}
Fale diretamente para o eleitor. Não mencione pontuações ou números.`;

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
        }),
      }
    );

    const geminiData = await geminiRes.json();
    const justificativa =
      geminiData?.candidates?.[0]?.content?.parts?.[0]?.text ??
      "Candidato selecionado por afinidade programática.";

    const { error: insertError } = await supabase
      .from("eleitores_respostas")
      .insert({
        id_sessao,
        mulheres,
        educacao,
        meio_ambiente,
        impostos,
        direitos,
        seguranca,
        transparencia,
        pontuacao_afinidade:   candidato.score,
        candidato_recomendado: justificativa,
        nome_candidato:        candidato.nome_urna,
        partido:               candidato.partido,
      });

    if (insertError) {
      throw new Error("Insert falhou: " + JSON.stringify(insertError));
    }

    return new Response(
      JSON.stringify({
        success: true,
        id_sessao,
        candidato: candidato.nome_urna,
        score: candidato.score,
      }),
      { headers: { "Content-Type": "application/json" }, status: 200 }
    );

  } catch (err) {
    return new Response(
      JSON.stringify({ error: String(err) }),
      { headers: { "Content-Type": "application/json" }, status: 500 }
    );
  }
});
