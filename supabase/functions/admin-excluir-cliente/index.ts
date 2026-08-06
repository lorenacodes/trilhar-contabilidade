// Exclusão PERMANENTE de um cliente (hard delete) — diferente de
// admin_definir_status_cliente (RPC), que só marca inativo/ativo (soft).
// Precisa de service_role porque: (1) apagar o auth.users exige a Admin API,
// que nunca pode rodar no navegador; (2) os arquivos no Storage precisam ser
// removidos ANTES de apagar as linhas do banco, senão sobra arquivo órfão
// no bucket sem nenhum registro apontando pra ele (documentos/documento_arquivos
// já têm ON DELETE CASCADE a partir de clientes, mas isso não alcança o Storage).
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Rate limiting: no máximo LIMITE chamadas por IP a cada JANELA_SEGUNDOS,
// contra abuso de uma sessão de admin comprometida (ou script em loop)
// excluindo contas em sequência sem nenhum freio. Não é perfeitamente
// atômico sob concorrência alta (select+update, não um upsert atômico
// único) — aceitável aqui porque o volume normal de uso administrativo é
// baixíssimo; o objetivo é frear abuso óbvio, não servir de rate limiter
// de produção de alto tráfego.
async function verificarRateLimit(
  adminClient: ReturnType<typeof createClient>,
  chave: string,
  limite: number,
  janelaSegundos: number,
): Promise<boolean> {
  const agora = new Date();
  await adminClient.from("rate_limit_contadores").delete().lt("expira_em", agora.toISOString());

  const { data: existente } = await adminClient
    .from("rate_limit_contadores")
    .select("contagem, expira_em")
    .eq("chave", chave)
    .maybeSingle();

  if (existente && new Date(existente.expira_em) > agora) {
    if (existente.contagem >= limite) return false;
    await adminClient.from("rate_limit_contadores").update({ contagem: existente.contagem + 1 }).eq("chave", chave);
    return true;
  }

  const expiraEm = new Date(agora.getTime() + janelaSegundos * 1000).toISOString();
  await adminClient.from("rate_limit_contadores").upsert({ chave, contagem: 1, expira_em: expiraEm });
  return true;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Método não permitido" }, 405);
  }

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: souAdmin, error: adminCheckError } = await callerClient.rpc("is_admin");
    if (adminCheckError || !souAdmin) {
      return jsonResponse({ error: "Apenas administradores podem excluir clientes" }, 403);
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "desconhecido";
    const podeSeguir = await verificarRateLimit(adminClient, `admin-excluir-cliente:${ip}`, 10, 60);
    if (!podeSeguir) {
      return jsonResponse({ error: "Muitas tentativas em pouco tempo. Aguarde um minuto e tente novamente." }, 429);
    }

    const body = await req.json().catch(() => ({}));
    const clienteId = String(body.clienteId || "").trim();
    if (!clienteId) return jsonResponse({ error: "clienteId é obrigatório" }, 400);

    const { data: cliente, error: clienteError } = await adminClient
      .from("clientes")
      .select("id, user_id, users(nome, auth_user_id)")
      .eq("id", clienteId)
      .maybeSingle();

    if (clienteError || !cliente) {
      return jsonResponse({ error: "Cliente não encontrado" }, 404);
    }
    // users(...) vem como array em alguns clients do PostgREST — normaliza pro objeto único.
    const usuario = Array.isArray(cliente.users) ? cliente.users[0] : cliente.users;
    const authUserId: string | undefined = usuario?.auth_user_id;

    const { data: documentos } = await adminClient
      .from("documentos")
      .select("id, documento_arquivos(storage_path)")
      .eq("cliente_id", clienteId);

    const storagePaths = (documentos || []).flatMap((d) =>
      (d.documento_arquivos || []).map((a: { storage_path: string }) => a.storage_path)
    );

    if (storagePaths.length > 0) {
      const { error: removeError } = await adminClient.storage.from("documentos").remove(storagePaths);
      // Não interrompe a exclusão por causa de um arquivo que já não existia
      // no Storage (ex: removido manualmente antes) — só registra e segue,
      // já que o objetivo principal (excluir o cliente) não depende disso.
      if (removeError) console.error("Falha ao remover arquivos do Storage:", removeError.message);
    }

    // Apaga a linha de clientes — o ON DELETE CASCADE já configurado no banco
    // cuida de documentos e documento_arquivos automaticamente a partir daqui.
    const { error: deleteClienteError } = await adminClient.from("clientes").delete().eq("id", clienteId);
    if (deleteClienteError) {
      return jsonResponse({ error: "Não foi possível excluir o cadastro do cliente" }, 500);
    }

    if (cliente.user_id) {
      await adminClient.from("users").delete().eq("id", cliente.user_id);
    }
    if (authUserId) {
      await adminClient.auth.admin.deleteUser(authUserId);
    }

    return jsonResponse({
      success: true,
      documentosExcluidos: (documentos || []).length,
      arquivosExcluidos: storagePaths.length,
    }, 200);
  } catch (_err) {
    return jsonResponse({ error: "Erro inesperado ao excluir cliente" }, 500);
  }
});
