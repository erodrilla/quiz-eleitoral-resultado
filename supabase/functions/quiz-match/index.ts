import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function extrairResposta(fields: any[], prefixo: string): string {
  const field = fields.find((f: any) => f.label?.includes(`[${prefixo}]`));
  if (!field) return "Moderado";
  const valueId = Array.isArray(field.value) ? field.value[0] : field.value;
  const option = field.options?.find((o: any) => o.id === valueId);
  return option?.text ?? "Moderado";
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: cors });
  }

  try {
    const body = await req.json();
    const fields = body?.data?.fields ?? [];
    const id_sessao = body?.data?.submissionId ?? crypto.randomUUID();

    const mulheres = extrairResposta(fields, "Mulheres");
    const educacao = extrairResposta(fields, "Educação");
    const meio_ambiente = extrairResposta(fields, "Meio Ambiente");
    const impostos = extrairResposta(fields, "Impostos");
    const direitos = extrairResposta(fields, "Direitos");
    const seguranca = extrairResposta(fields, "Segurança");
    const transparencia = extrairResposta(fields, "Transparência");

    const bloqueado = mulheres === "Contrário" || meio_ambiente === "Contrário";

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    const { data: rpcMatchResult, error: matchError } = await supabase.rpc("match_quiz", {
      p_mulheres: mulheres,
      p_educacao: educacao,
      p_meio_ambiente: meio_ambiente,
      p_impostos: impostos,
      p_direitos: direitos,
      p_seguranca: seguranca,
      p_transparencia: transparencia,
    });

    if (matchError) {
      throw new Error("match_quiz falhou: " + JSON.stringify(matchError));
    }

    if (!rpcMatchResult || rpcMatchResult.length === 0) {
      if (bloqueado) {
        const { error: insertBlockedError } = await supabase
          .from("eleitores_respostas")
          .insert({
            id_sessao: id_sessao,
            mulheres: mulheres,
            educacao: educacao,
            meio_ambiente: meio_ambiente,
            impostos: impostos,
            direitos: direitos,
            seguranca: seguranca,
            transparencia: transparencia,
            pontuacao_afinidade: null,
            candidato_recomendado: null,
            nome_candidato: null,
            partido: null,
            bloqueado: true,
          });

        if (insertBlockedError) {
          throw new Error("Insert bloqueado falhou: " + JSON.stringify(insertBlockedError));
        }

        return new Response(
          JSON.stringify({
            success: true,
            bloqueado: true,
            id_sessao: id_sessao,
            candidato: null,
            partido: null,
            score: null,
            justificativa: null,
          }),
          { headers: { ...cors, "Content-Type": "application/json" }, status: 200 }
        );
      }

      throw new Error("match_quiz não retornou candidatos");
    }

    const candidato = rpcMatchResult[0];
    const score = Number(candidato.score ?? 0);

    let justificativa = "Candidato selecionado por afinidade programática.";

    const { data: justData, error: justError } = await supabase.rpc("gerar_justificativa", {
      p_nome: candidato.nome_urna,
      p_partido: candidato.partido,
      p_score: score,
      p_mulheres: mulheres,
      p_educacao: educacao,
      p_meio_ambiente: meio_ambiente,
      p_impostos: impostos,
      p_direitos: direitos,
      p_seguranca: seguranca,
      p_transparencia: transparencia,
    });

    if (justError) {
      console.error("gerar_justificativa erro:", JSON.stringify(justError));
    } else if (justData) {
      justificativa = justData;
    }

    const { error: insertError } = await supabase
      .from("eleitores_respostas")
      .insert({
        id_sessao: id_sessao,
        mulheres: mulheres,
        educacao: educacao,
        meio_ambiente: meio_ambiente,
        impostos: impostos,
        direitos: direitos,
        seguranca: seguranca,
        transparencia: transparencia,
        pontuacao_afinidade: score,
        candidato_recomendado: justificativa,
        nome_candidato: candidato.nome_urna,
        partido: candidato.partido,
        bloqueado: false,
      });

    if (insertError) {
      throw new Error("Insert falhou: " + JSON.stringify(insertError));
    }

    return new Response(
      JSON.stringify({
        success: true,
        bloqueado: false,
        id_sessao: id_sessao,
        candidato: candidato.nome_urna,
        partido: candidato.partido,
        score: score,
        justificativa: justificativa,
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
