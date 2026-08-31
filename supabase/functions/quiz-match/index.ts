import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL          = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function extrairResposta(fields: any[], prefixo: string): string {
  const field = fields.find((f: any) => f.label?.includes(`[${prefixo}]`));
  if (!field) return "Moderado";
  const valueId = Array.isArray(field.value) ? field.value[0] : field.value;
  const option  = field.options?.find((o: any) => o.id === valueId);
  return option?.text ?? "Moderado";
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: cors });
  }

  try {
    const body          = await req.json();
    const fields        = body?.data?.fields ?? [];
    const id_sessao     = body?.data?.submissionId ?? crypto.randomUUID();

    const mulheres      = extrairResposta(fields, "Mulheres");
    const educacao      = extrairResposta(fields, "Educação");
    const meio_ambiente = extrairResposta(fields, "Meio Ambiente");
    const impostos      = extrairResposta(fields, "Impostos");
    const direitos      = extrairResposta(fields, "Direitos");
    const seguranca     = extrairResposta(fields, "Segurança");
    const transparencia = extrairResposta(fields, "Transparência");

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // 1. match_quiz — candidato mais compatível
    const { data: match, error: matchError } = await supabase.rpc("match_quiz", {
      p_mulheres,
      p_educacao,
      p_meio_ambiente,
      p_impostos,
      p_direitos,
      p_seguranca,
      p_transparencia,
    });

    if (matchError || !match?.length) {
      throw new Error("match_quiz falhou: " + JSON.stringify(matchError ?? match));
    }

    const candidato = match[0];
    const scorePct  = Math.round((candidato.score ?? 0) * 100);
    const bloqueado = scorePct < 40;

    // 2. justificativa via SQL
    const { data: justData, error: justError } = await supabase.rpc("gerar_justificativa", {
      p_nome:          candidato.nome_urna,
      p_partido:       candidato.partido,
      p_score:         scorePct,
      p_mulheres:      mulheres,
      p_educacao:      educacao,
      p_meio_ambiente: meio_ambiente,
      p_impostos:      impostos,
      p_direitos:      direitos,
      p_seguranca:     seguranca,
      p_transparencia: transparencia,
    });

    if (justError) {
      console.error("gerar_justificativa erro:", JSON.stringify(justError));
    }

    const justificativa = justData ?? "Candidato selecionado por afinidade programática.";

    // 3. gravar sempre — bloqueado ou não
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
        pontuacao_afinidade:   scorePct,
        candidato_recomendado: justificativa,
        nome_candidato:        candidato.nome_urna,
        partido:               candidato.partido,
        bloqueado,
      });

    if (insertError) {
      throw new Error("Insert falhou: " + JSON.stringify(insertError));
    }

    return new Response(
      JSON.stringify({
        success:       true,
        bloqueado,
        id_sessao,
        candidato:     candidato.nome_urna,
        partido:       candidato.partido,
        score:         scorePct,
        justificativa,
      }),
      { headers: { ...cors, "Content-Type": "application/json" }, status: 200 }
    );

  } catch (err) {
    console.error("Erro geral:", String(err));
    return new Response(
      JSON.stringify({ error: String(err) }),
      { headers: { ...cors, "Content-Type": "application/json" }, status: 500 }
    );
  }
});

