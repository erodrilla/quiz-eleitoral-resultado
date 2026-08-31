import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL         = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const QUEM_FOI_QUEM = "https://quemfoiquem.org.br/";
const DEPUTOMETRO   = "https://www.agencialupa.org/deputometro/";

function extrairResposta(fields: any[], prefixo: string): string {
  const field = fields.find((f: any) => f.label?.includes(`[${prefixo}]`));
  if (!field) return "Moderado";
  const valueId = Array.isArray(field.value) ? field.value[0] : field.value;
  const option  = field.options?.find((o: any) => o.id === valueId);
  return option?.text ?? "Moderado";
}

function temasBloqueantes(mulheres: string, meio_ambiente: string): string[] {
  const bloqueados: string[] = [];
  if (mulheres === "Contrário")      bloqueados.push("Mulheres & Gênero");
  if (meio_ambiente === "Contrário") bloqueados.push("Meio Ambiente");
  return bloqueados;
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

    // — Bloqueio por temas críticos —
    const temasBloq = temasBloqueantes(mulheres, meio_ambiente);
    const bloqueado = temasBloq.length > 0;

    if (bloqueado) {
      // Grava mesmo bloqueado, sem candidato
      await supabase.from("eleitores_respostas").insert({
        id_sessao,
        mulheres,
        educacao,
        meio_ambiente,
        impostos,
        direitos,
        seguranca,
        transparencia,
        pontuacao_afinidade:   null,
        candidato_recomendado: null,
        nome_candidato:        null,
        partido:               null,
        bloqueado:             true,
      });

      return new Response(
        JSON.stringify({
          success:        true,
          bloqueado:      true,
          temas_criticos: temasBloq,
          mensagem:       "Não foi possível identificar um candidato compatível com suas respostas nos temas essenciais. Consulte os recursos abaixo para conhecer melhor os candidatos.",
          links: {
            quem_foi_quem: QUEM_FOI_QUEM,
            deputometro:   DEPUTOMETRO,
          },
        }),
        { headers: { ...cors, "Content-Type": "application/json" }, status: 200 }
      );
    }

    // — Candidato normal —
    const { data: rpcMatchResult, error: matchError } = await supabase.rpc("match_quiz", {
      p_mulheres:      mulheres,
      p_educacao:      educacao,
      p_meio_ambiente: meio_ambiente,
      p_impostos:      impostos,
      p_direitos:      direitos,
      p_seguranca:     seguranca,
      p_transparencia: transparencia,
    });

    if (matchError || !rpcMatchResult?.length) {
      throw new Error("match_quiz falhou: " + JSON.stringify(matchError ?? rpcMatchResult));
    }

    const candidato = rpcMatchResult[0];
    const scorePct  = Math.round((candidato.score ?? 0) * 100);

    // — Justificativa via SQL —
    const { data: rpcJustResult, error: justError } = await supabase.rpc("gerar_justificativa", {
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

    const justificativa = rpcJustResult ?? "Candidato selecionado por afinidade programática.";

    // — Grava resultado —
    const { error: insertError } = await supabase.from("eleitores_respostas").insert({
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
      bloqueado:             false,
    });

    if (insertError) {
      throw new Error("Insert falhou: " + JSON.stringify(insertError));
    }

    return new Response(
      JSON.stringify({
        success:      true,
        bloqueado:    false,
        id_sessao,
        candidato:    candidato.nome_urna,
        partido:      candidato.partido,
        score:        scorePct,
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
