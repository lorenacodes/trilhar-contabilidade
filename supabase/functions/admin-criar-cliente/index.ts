// Cria um cliente de verdade (Auth + users + clientes) a partir do painel
// administrativo. Só existe porque "users"/"clientes" não têm policy de
// INSERT via app de propósito — criação de conta de Auth exige a
// service_role key, que NUNCA pode ir pro browser. Esta função roda no
// servidor, confirma que quem chamou é admin (via RPC is_admin() com o JWT
// de quem chamou), valida CPF/CNPJ/endereço de novo aqui (nunca confiar só
// no que o front-end validou), e só então usa a service_role pra criar a conta.
//
// Envio de e-mail de convite DESATIVADO temporariamente (o Resend está em
// modo sandbox e só entrega pro próprio dono da conta — nenhum convite real
// estava chegando no cliente). Em vez de convidar por e-mail, a conta já
// nasce com uma senha temporária gerada aqui no servidor (nunca no
// navegador) e ativa (email_confirm: true, sem precisar clicar em nada).
// A senha temporária volta na resposta só pra esta chamada poder gerar o
// PDF de boas-vindas — não fica salva em lugar nenhum depois disso.
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
// criando contas em sequência sem nenhum freio. Não é perfeitamente atômico
// sob concorrência alta (select+update, não um upsert atômico único) —
// aceitável aqui porque o volume normal de uso administrativo é baixíssimo
// (ninguém cadastra 10 clientes por minuto de verdade); o objetivo é frear
// abuso óbvio, não servir de rate limiter de produção de alto tráfego.
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

function somenteDigitos(v: string): string {
  return (v || "").replace(/\D/g, "");
}

function cpfValido(cpfEntrada: string): boolean {
  const cpf = somenteDigitos(cpfEntrada);
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  const digitos = cpf.split("").map(Number);
  let soma = 0;
  for (let i = 0; i < 9; i++) soma += digitos[i] * (10 - i);
  let resto = (soma * 10) % 11;
  if (resto === 10) resto = 0;
  if (resto !== digitos[9]) return false;
  soma = 0;
  for (let i = 0; i < 10; i++) soma += digitos[i] * (11 - i);
  resto = (soma * 10) % 11;
  if (resto === 10) resto = 0;
  return resto === digitos[10];
}

function cnpjValido(cnpjEntrada: string): boolean {
  const cnpj = somenteDigitos(cnpjEntrada);
  if (cnpj.length !== 14 || /^(\d)\1{13}$/.test(cnpj)) return false;
  const digitos = cnpj.split("").map(Number);
  const calc = (base: number[]) => {
    const pesos = base.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const soma = base.reduce((acc, d, i) => acc + d * pesos[i], 0);
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };
  const d1 = calc(digitos.slice(0, 12));
  if (d1 !== digitos[12]) return false;
  const d2 = calc(digitos.slice(0, 13));
  return d2 === digitos[13];
}

const DDDS_VALIDOS = new Set([
  11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 24, 27, 28, 31, 32, 33, 34, 35, 37, 38,
  41, 42, 43, 44, 45, 46, 47, 48, 49, 51, 53, 54, 55, 61, 62, 63, 64, 65, 66, 67, 68, 69,
  71, 73, 74, 75, 77, 79, 81, 82, 83, 84, 85, 86, 87, 88, 89, 91, 92, 93, 94, 95, 96, 97, 98, 99,
]);

function telefoneValido(telEntrada: string): boolean {
  const tel = somenteDigitos(telEntrada);
  if (tel.length !== 10 && tel.length !== 11) return false;
  const ddd = parseInt(tel.slice(0, 2), 10);
  if (!DDDS_VALIDOS.has(ddd)) return false;
  if (tel.length === 11 && tel[2] !== "9") return false;
  return true;
}

const UFS_VALIDAS = new Set([
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG",
  "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO",
]);

// Sem 0/O, 1/l/I e similares — evita erro de leitura ao digitar a senha
// temporária a partir do PDF impresso ou de uma tela pequena de celular.
const ALFABETO_SENHA = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%";
function gerarSenhaTemporaria(tamanho = 12): string {
  const bytes = new Uint8Array(tamanho);
  crypto.getRandomValues(bytes);
  let senha = "";
  for (let i = 0; i < tamanho; i++) senha += ALFABETO_SENHA[bytes[i] % ALFABETO_SENHA.length];
  return senha;
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
      return jsonResponse({ error: "Apenas administradores podem cadastrar clientes" }, 403);
    }

    // Quem está criando, resolvido no servidor (nunca confiar em nada que o
    // browser mandasse) — grava em clientes.criado_por e no evento de
    // histórico, pra "quem criou o cadastro" ser um registro real, não uma
    // inferência do frontend.
    const { data: adminAtualRows } = await callerClient.rpc("admin_atual");
    const adminAtual = Array.isArray(adminAtualRows) ? adminAtualRows[0] : adminAtualRows;
    const criadoPorId: string | null = adminAtual?.id ?? null;
    const criadoPorNome: string | null = adminAtual?.nome ?? null;

    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "desconhecido";
    const podeSeguir = await verificarRateLimit(adminClient, `admin-criar-cliente:${ip}`, 10, 60);
    if (!podeSeguir) {
      return jsonResponse({ error: "Muitas tentativas em pouco tempo. Aguarde um minuto e tente novamente." }, 429);
    }

    const body = await req.json().catch(() => ({}));
    const tipoPessoa = body.tipoPessoa === "juridica" ? "juridica" : "fisica";
    const nome = String(body.nome || "").trim();
    const sobrenome = String(body.sobrenome || "").trim();
    const razaoSocial = String(body.razaoSocial || "").trim();
    const nomeFantasia = String(body.nomeFantasia || "").trim();
    const cpf = somenteDigitos(body.cpf || "");
    const cnpj = somenteDigitos(body.cnpj || "");
    const email = String(body.email || "").trim().toLowerCase();
    const telefone = somenteDigitos(body.telefone || "");

    const enderecoCep = somenteDigitos(body.enderecoCep || "");
    const enderecoRua = String(body.enderecoRua || "").trim();
    const enderecoNumero = String(body.enderecoNumero || "").trim();
    const enderecoComplemento = String(body.enderecoComplemento || "").trim();
    const enderecoBairro = String(body.enderecoBairro || "").trim();
    const enderecoCidade = String(body.enderecoCidade || "").trim();
    const enderecoEstado = String(body.enderecoEstado || "").trim().toUpperCase();

    if (!email) return jsonResponse({ error: "E-mail é obrigatório" }, 400);
    if (tipoPessoa === "fisica") {
      if (!nome) return jsonResponse({ error: "Nome é obrigatório" }, 400);
      if (!cpfValido(cpf)) return jsonResponse({ error: "CPF inválido" }, 400);
    } else {
      if (!razaoSocial) return jsonResponse({ error: "Razão social é obrigatória" }, 400);
      if (!cnpjValido(cnpj)) return jsonResponse({ error: "CNPJ inválido" }, 400);
    }
    if (!telefone) return jsonResponse({ error: "Telefone é obrigatório" }, 400);
    if (!telefoneValido(telefone)) {
      return jsonResponse({ error: "Telefone inválido (confira o DDD e a quantidade de dígitos)" }, 400);
    }

    // Endereço: CEP, rua, número, bairro, cidade e estado são obrigatórios
    // pra QUALQUER cliente (pessoa física ou jurídica) — só complemento
    // fica opcional.
    if (!enderecoCep) return jsonResponse({ error: "Endereço: CEP é obrigatório" }, 400);
    if (enderecoCep.length !== 8) return jsonResponse({ error: "Endereço: CEP inválido" }, 400);
    if (!enderecoRua) return jsonResponse({ error: "Endereço: rua é obrigatória" }, 400);
    if (!enderecoNumero) return jsonResponse({ error: "Endereço: número é obrigatório" }, 400);
    if (!enderecoBairro) return jsonResponse({ error: "Endereço: bairro é obrigatório" }, 400);
    if (!enderecoCidade) return jsonResponse({ error: "Endereço: cidade é obrigatória" }, 400);
    if (!UFS_VALIDAS.has(enderecoEstado)) return jsonResponse({ error: "Endereço: estado inválido" }, 400);

    const nomeCompleto = tipoPessoa === "fisica" ? [nome, sobrenome].filter(Boolean).join(" ") : razaoSocial;

    const senhaTemporaria = gerarSenhaTemporaria();
    const { data: created, error: createError } = await adminClient.auth.admin.createUser({
      email,
      password: senhaTemporaria,
      email_confirm: true,
      user_metadata: { nome: nomeCompleto },
    });

    if (createError || !created?.user) {
      const msg = createError?.message?.toLowerCase().includes("already been registered")
        ? "Já existe uma conta com esse e-mail"
        : (createError?.message || "Não foi possível criar o cliente");
      return jsonResponse({ error: msg }, 400);
    }
    const authUserId = created.user.id;

    const { data: userRow, error: userError } = await adminClient
      .from("users")
      .insert({ auth_user_id: authUserId, nome: nomeCompleto, email, tipo: "cliente", primeiro_acesso: true })
      .select("id")
      .single();

    if (userError || !userRow) {
      await adminClient.auth.admin.deleteUser(authUserId);
      return jsonResponse({ error: "Não foi possível criar o cadastro do cliente" }, 500);
    }

    const { data: clienteRow, error: clienteError } = await adminClient
      .from("clientes")
      .insert({
        user_id: userRow.id,
        tipo_pessoa: tipoPessoa,
        nome: tipoPessoa === "fisica" ? nome : null,
        sobrenome: tipoPessoa === "fisica" ? (sobrenome || null) : null,
        razao_social: tipoPessoa === "juridica" ? razaoSocial : null,
        nome_fantasia: tipoPessoa === "juridica" ? (nomeFantasia || null) : null,
        cpf: tipoPessoa === "fisica" ? cpf : null,
        cnpj: tipoPessoa === "juridica" ? cnpj : null,
        telefone: telefone,
        endereco_cep: enderecoCep,
        endereco_rua: enderecoRua,
        endereco_numero: enderecoNumero,
        endereco_complemento: enderecoComplemento || null,
        endereco_bairro: enderecoBairro,
        endereco_cidade: enderecoCidade,
        endereco_estado: enderecoEstado,
        criado_por: criadoPorId,
      })
      .select("id")
      .single();

    if (clienteError || !clienteRow) {
      await adminClient.from("users").delete().eq("id", userRow.id);
      await adminClient.auth.admin.deleteUser(authUserId);
      const msg = clienteError?.code === "23505"
        ? (tipoPessoa === "fisica" ? "Já existe um cliente com esse CPF" : "Já existe um cliente com esse CNPJ")
        : "Não foi possível criar o cadastro do cliente";
      return jsonResponse({ error: msg }, clienteError?.code === "23505" ? 409 : 500);
    }

    // Evento auxiliar de histórico — mesmo padrão do resto do sistema:
    // se falhar, não desfaz a criação (que já teve sucesso), só loga.
    const { error: eventoErro } = await adminClient.from("eventos_cliente").insert({
      cliente_id: clienteRow.id, tipo: "cliente_criado",
      descricao: "Cliente cadastrado", ator: criadoPorNome, ator_admin_id: criadoPorId,
    });
    if (eventoErro) console.error("Falha ao registrar evento de criação:", eventoErro);

    return jsonResponse({
      success: true,
      clienteId: clienteRow.id,
      email,
      nome: nomeCompleto,
      senhaTemporaria,
    }, 200);
  } catch (_err) {
    return jsonResponse({ error: "Erro inesperado ao cadastrar cliente" }, 500);
  }
});
