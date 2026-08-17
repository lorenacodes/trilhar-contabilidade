-- ============================================================================
-- Portal do Cliente (Trilhar Contabilidade) — schema do banco de dados
-- ============================================================================
-- Este script roda no projeto Supabase da CLIENTE (Tinaysa), não no seu.
-- Cole no SQL Editor do Supabase dela (Dashboard > SQL Editor > New query)
-- e execute uma vez. Pode rodar de novo com segurança (usa "if not exists").
--
-- Por que este desenho:
-- - "documentos" guarda o registro lógico (ex: "Nota Fiscal 001 - Junho/2026").
-- - "documento_arquivos" guarda cada ARQUIVO físico ligado a um documento.
--   Isso é o que permite uma nota fiscal ter o PDF e o XML dela juntos:
--   duas linhas em documento_arquivos apontando pro mesmo documento_id.
-- - RLS (Row Level Security) garante que cada cliente só enxerga os próprios
--   documentos — o isolamento não depende do frontend "esconder" nada, o
--   próprio banco recusa a consulta se não for a linha do usuário logado.
-- ============================================================================

-- ---------- Clientes (empresas atendidas pela Trilhar) ----------
create table if not exists clientes (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid references auth.users(id), -- vínculo com o login Supabase do cliente
  nome text not null,
  email text not null,
  documento text, -- CPF ou CNPJ
  telefone text,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- Administradores (Tinaysa e colaboradoras da Trilhar) ----------
create table if not exists administradores (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid references auth.users(id),
  nome text not null,
  email text not null,
  nivel text not null default 'administrador' check (nivel in ('proprietario', 'administrador')),
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------- Categorias de documento ----------
-- Espelha o modelo já validado no protótipo (slug, grupo, cor, config de upload),
-- só que agora persistido de verdade em vez de localStorage.
create table if not exists categorias (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  nome text not null,
  grupo text,
  icone text default 'doc',
  cor text default 'navy',
  ordem integer default 999,
  padrao boolean not null default false, -- categorias padrão não podem ser excluídas
  obrigatoria boolean not null default false,
  tipos_arquivo_aceitos text[] not null default array['PDF'], -- ex: {PDF,XML}
  tamanho_maximo_mb integer not null default 10,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Categorias padrão, incluindo os dois tipos de boleto e notas fiscais com XML.
insert into categorias (slug, nome, grupo, icone, cor, ordem, padrao, obrigatoria, tipos_arquivo_aceitos, tamanho_maximo_mb)
values
  ('boleto-honorarios', 'Boleto - Honorários', 'Financeiro', 'card', 'gold', 1, true, true, array['PDF'], 10),
  ('boleto-imposto',    'Boleto - Imposto',    'Fiscal',     'card', 'red',  2, true, false, array['PDF'], 10),
  ('notas-fiscais',     'Notas Fiscais',       'Fiscal',     'doc',  'teal', 3, true, false, array['PDF','XML'], 15),
  ('cartao',            'Cartão CNPJ',         'Societário', 'card', 'navy', 4, true, false, array['PDF'], 10),
  ('empresa',           'Documentos da Empresa','Societário','building','purple', 5, true, false, array['PDF'], 10),
  ('contrato',          'Contrato',            'Jurídico',   'contract', 'green', 6, true, false, array['PDF'], 10),
  ('declaracoes',       'Declarações',         'Fiscal',     'chart', 'gray', 7, true, false, array['PDF'], 10)
on conflict (slug) do nothing;

-- ---------- Documentos (registro lógico, sem o arquivo em si) ----------
-- Os dois tipos de boleto NÃO viram uma coluna aqui — eles já são distinguidos
-- pela categoria (categoria_id apontando pra 'boleto-honorarios' ou
-- 'boleto-imposto'). Duplicar essa informação numa coluna à parte só criaria
-- risco de um dia categoria e "tipo" ficarem dessincronizados.
create table if not exists documentos (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references clientes(id) on delete cascade,
  categoria_id uuid not null references categorias(id),
  criado_por uuid references administradores(id),
  nome text not null, -- ex: "Boleto - Julho 2026" ou "NF 001 - Junho 2026"

  -- Campos específicos de boleto (null para os demais tipos de documento).
  -- Regra de negócio: só boleto tem vencimento e status de pagamento. status é
  -- binário de propósito — é exatamente o Select "Pago" / "Não Pago" que o admin
  -- preenche. "Vencendo"/"Vencido" NÃO são guardados aqui: são calculados na tela
  -- a partir de data_vencimento vs a data de hoje, pra não duplicar informação.
  valor numeric(12, 2),
  data_vencimento date,
  status text check (status is null or status in ('pago', 'nao_pago')),
  pago_em timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_documentos_cliente on documentos(cliente_id);
create index if not exists idx_documentos_categoria on documentos(categoria_id);
create index if not exists idx_documentos_vencimento on documentos(data_vencimento) where data_vencimento is not null;

-- Regra "só boleto tem vencimento e status" não dá pra ser um simples check
-- constraint (checks não podem consultar outra tabela), então vira um
-- trigger: antes de gravar, olha a categoria do documento e aplica a regra
-- nos dois sentidos — boleto EXIGE vencimento+status, documento comum PROÍBE
-- os dois (nunca deve parecer que tem vencimento ou pagamento se não for boleto).
create or replace function enforce_boleto_vencimento()
returns trigger as $$
declare
  categoria_slug text;
  eh_boleto boolean;
begin
  select slug into categoria_slug from categorias where id = new.categoria_id;
  eh_boleto := categoria_slug in ('boleto-honorarios', 'boleto-imposto');

  if eh_boleto then
    if new.data_vencimento is null then
      raise exception 'Boletos (categoria %) precisam de data_vencimento', categoria_slug;
    end if;
    if new.status is null or new.status not in ('pago', 'nao_pago') then
      raise exception 'Boletos (categoria %) precisam de status "pago" ou "nao_pago"', categoria_slug;
    end if;
  else
    if new.data_vencimento is not null then
      raise exception 'Documentos da categoria % não podem ter data_vencimento (só boletos têm vencimento)', categoria_slug;
    end if;
    if new.status is not null then
      raise exception 'Documentos da categoria % não podem ter status de pagamento (só boletos têm)', categoria_slug;
    end if;
  end if;

  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_enforce_boleto_vencimento on documentos;
create trigger trg_enforce_boleto_vencimento
  before insert or update on documentos
  for each row execute function enforce_boleto_vencimento();

-- ---------- Arquivos de cada documento (1 documento pode ter vários arquivos) ----------
-- É esta tabela que resolve o pedido de anexar a nota fiscal E o xml dela:
-- um mesmo documento (a NF) recebe duas linhas aqui, uma com tipo_arquivo='PDF'
-- e outra com tipo_arquivo='XML', cada uma apontando pro seu arquivo no Storage.
create table if not exists documento_arquivos (
  id uuid primary key default gen_random_uuid(),
  documento_id uuid not null references documentos(id) on delete cascade,
  tipo_arquivo text not null, -- 'PDF', 'XML', 'DOCX', etc.
  nome_original text not null,
  storage_path text not null, -- caminho no bucket do Supabase Storage
  tamanho_bytes bigint,
  created_at timestamptz not null default now()
);

create index if not exists idx_documento_arquivos_documento on documento_arquivos(documento_id);

-- ============================================================================
-- RLS — Row Level Security
-- ============================================================================
-- Por que: sem isso, qualquer usuário autenticado no projeto poderia consultar
-- a tabela inteira via API e ver documentos de outros clientes. Com RLS, o
-- Postgres filtra as linhas na origem, então mesmo um bug no frontend não
-- vaza dado de um cliente pro outro.

alter table clientes enable row level security;
alter table administradores enable row level security;
alter table categorias enable row level security;
alter table documentos enable row level security;
alter table documento_arquivos enable row level security;

-- Categorias: todo usuário autenticado (cliente ou admin) pode ler.
create policy "categorias_leitura_geral" on categorias
  for select using (auth.role() = 'authenticated');

-- Categorias: só administradores podem criar/editar/remover.
create policy "categorias_escrita_admin" on categorias
  for all using (
    exists (select 1 from administradores a where a.auth_user_id = auth.uid())
  );

-- Clientes: cada cliente só vê a própria linha de cadastro.
create policy "clientes_ve_proprio_cadastro" on clientes
  for select using (auth_user_id = auth.uid());

-- Clientes: administradores enxergam e gerenciam todos os clientes.
create policy "clientes_admin_gerencia_tudo" on clientes
  for all using (
    exists (select 1 from administradores a where a.auth_user_id = auth.uid())
  );

-- Administradores: só administradores enxergam a lista de administradores.
create policy "administradores_visivel_para_admin" on administradores
  for select using (
    exists (select 1 from administradores a where a.auth_user_id = auth.uid())
  );

-- Documentos: cliente só vê os documentos vinculados ao seu próprio cliente_id.
create policy "documentos_cliente_ve_os_seus" on documentos
  for select using (
    cliente_id in (select id from clientes where auth_user_id = auth.uid())
  );

-- Documentos: só administradores podem inserir, editar ou excluir.
create policy "documentos_admin_gerencia_tudo" on documentos
  for all using (
    exists (select 1 from administradores a where a.auth_user_id = auth.uid())
  );

-- Documento_arquivos: cliente só vê arquivos de documentos que são dele.
create policy "arquivos_cliente_ve_os_seus" on documento_arquivos
  for select using (
    documento_id in (
      select d.id from documentos d
      join clientes c on c.id = d.cliente_id
      where c.auth_user_id = auth.uid()
    )
  );

-- Documento_arquivos: só administradores podem inserir, editar ou excluir.
create policy "arquivos_admin_gerencia_tudo" on documento_arquivos
  for all using (
    exists (select 1 from administradores a where a.auth_user_id = auth.uid())
  );

-- ============================================================================
-- Storage — bucket para os arquivos
-- ============================================================================
-- Crie o bucket "documentos" pela interface (Storage > New bucket > privado,
-- NÃO marcar "Public"), ou descomente e rode a linha abaixo:
-- insert into storage.buckets (id, name, public) values ('documentos', 'documentos', false)
-- on conflict (id) do nothing;
--
-- Um bucket privado sozinho não basta: sem policy nenhuma, ninguém autenticado
-- consegue ler os arquivos por conta própria (só o service_role do backend).
-- Convenção de caminho esperada: {cliente_id}/{documento_id}/{arquivo_id}-{nome}
-- — é o (storage.foldername(name))[1] abaixo que lê esse primeiro pedaço do
-- caminho e compara com o cliente logado.

-- Cliente só lê arquivos dentro da própria pasta (primeiro nível = cliente_id).
create policy "storage_cliente_ve_os_seus" on storage.objects
  for select using (
    bucket_id = 'documentos'
    and (storage.foldername(name))[1] = (
      select id::text from clientes where auth_user_id = auth.uid()
    )
  );

-- Administradores podem ler, subir, substituir e remover qualquer arquivo do bucket.
create policy "storage_admin_gerencia_tudo" on storage.objects
  for all using (
    bucket_id = 'documentos'
    and exists (select 1 from administradores a where a.auth_user_id = auth.uid())
  );

-- ============================================================================
-- Migração: clientes podem enviar seus próprios documentos (não-boleto)
-- ============================================================================
-- Contexto: até aqui só administradores inseriam em "documentos" e
-- "documento_arquivos" (RLS "for all" restrita a admin). Esta migração ADICIONA
-- policies novas de INSERT para clientes — não altera nem remove nenhuma
-- policy existente, então o fluxo administrativo continua idêntico (policies
-- permissivas do mesmo comando são combinadas com OR, então isso é puramente
-- aditivo).
--
-- Regra de negócio inegociável: "apenas o administrativo gerencia boletos".
-- Cliente nunca pode criar (ou anexar arquivo a) um documento de categoria
-- 'boleto-honorarios' ou 'boleto-imposto'. Essa exclusão é feita via RLS
-- (barreira de autorização) — o trigger enforce_boleto_vencimento sozinho NÃO
-- bloqueia isso: ele só exige que os campos existam quando a categoria é
-- boleto, não valida QUEM pode usar aquela categoria.
-- ============================================================================

-- ---------- Coluna "origem": quem originou o documento ----------
-- Por que uma coluna nova em vez de só inferir de criado_por is null: uma
-- coluna explícita é auto-documentada e não quebra se um fluxo futuro
-- (ex: admin cadastrando em nome do cliente) mexer na nulidade de criado_por
-- por outro motivo.
alter table documentos
  add column if not exists origem text;

update documentos
  set origem = case when criado_por is not null then 'admin' else 'cliente' end
  where origem is null;

alter table documentos
  alter column origem set default 'cliente',
  alter column origem set not null;

alter table documentos
  add constraint documentos_origem_valida check (origem in ('admin', 'cliente'));

alter table documentos
  add constraint documentos_origem_consistente check (
    (criado_por is not null and origem = 'admin')
    or (criado_por is null and origem = 'cliente')
  );

-- Deriva origem a partir de criado_por (nunca confia no que o chamador manda) —
-- assim o app do cliente nem precisa enviar essa coluna, e ninguém consegue
-- mandar origem='admin' junto do insert pra se passar por administrador.
create or replace function definir_origem_documento()
returns trigger as $$
begin
  new.origem := case when new.criado_por is not null then 'admin' else 'cliente' end;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_definir_origem_documento on documentos;
create trigger trg_definir_origem_documento
  before insert or update on documentos
  for each row execute function definir_origem_documento();

-- ---------- RLS: cliente pode INSERIR documento próprio, não-boleto ----------
create policy "documentos_cliente_insere_nao_boleto" on documentos
  for insert
  with check (
    cliente_id in (select id from clientes where auth_user_id = auth.uid())
    and categoria_id not in (
      select id from categorias where slug in ('boleto-honorarios', 'boleto-imposto')
    )
    and criado_por is null
  );

-- ---------- RLS: cliente pode INSERIR arquivo só no seu próprio documento
--                 não-boleto (proteção extra: sem isso, cliente poderia
--                 anexar arquivo a um boleto que o admin já criou pra ele) ----------
create policy "arquivos_cliente_insere_nos_seus_documentos" on documento_arquivos
  for insert
  with check (
    documento_id in (
      select d.id
      from documentos d
      join clientes c on c.id = d.cliente_id
      where c.auth_user_id = auth.uid()
        and d.categoria_id not in (
          select id from categorias where slug in ('boleto-honorarios', 'boleto-imposto')
        )
    )
  );

-- ---------- Storage: cliente pode SUBIR arquivo só na própria pasta ----------
create policy "storage_cliente_envia_para_propria_pasta" on storage.objects
  for insert
  with check (
    bucket_id = 'documentos'
    and (storage.foldername(name))[1] = (
      select id::text from clientes where auth_user_id = auth.uid()
    )
  );

-- ============================================================================
-- Migração: users como fonte única de identidade/permissão (RBAC real)
-- ============================================================================
-- Contexto: antes desta migração, "clientes" e "administradores" eram cada
-- uma sua própria fonte de identidade (auth_user_id, nome, email, ativo
-- direto na tabela). Passamos a ter uma tabela "users" única — é nela que o
-- login e o RLS se baseiam — e "clientes"/"administradores" encolhem pra
-- guardar só dado de perfil (CPF/CNPJ, nível), referenciando users.id.
-- clientes/administradores estavam vazias em produção — é DDL puro, sem
-- necessidade de backfill de dado real.
--
-- Regra de negócio inegociável: um usuário só acessa o sistema se existir
-- TANTO no Supabase Auth QUANTO em "users" — não basta um dos dois.
-- ============================================================================

-- ---------- Tabela nova: users ----------
create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null unique references auth.users(id),
  nome text not null,
  email text not null,
  tipo text not null check (tipo in ('administrador', 'cliente')),
  status text not null default 'ativo' check (status in ('ativo', 'inativo')),
  primeiro_acesso boolean not null default true, -- força troca de senha temporária no primeiro login
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- IMPORTANTE: enable, nunca "force". "force row level security" quebraria a
-- isenção de dono da qual is_admin()/current_cliente_id() dependem (ver abaixo).
alter table users enable row level security;

-- Derruba as policies antigas que referenciam auth_user_id ANTES de remover
-- a coluna (dependência de coluna impede o drop enquanto elas existirem).
drop policy if exists "categorias_escrita_admin" on categorias;
drop policy if exists "clientes_ve_proprio_cadastro" on clientes;
drop policy if exists "clientes_admin_gerencia_tudo" on clientes;
drop policy if exists "administradores_visivel_para_admin" on administradores;
drop policy if exists "documentos_cliente_ve_os_seus" on documentos;
drop policy if exists "documentos_admin_gerencia_tudo" on documentos;
drop policy if exists "documentos_cliente_insere_nao_boleto" on documentos;
drop policy if exists "arquivos_cliente_ve_os_seus" on documento_arquivos;
drop policy if exists "arquivos_admin_gerencia_tudo" on documento_arquivos;
drop policy if exists "arquivos_cliente_insere_nos_seus_documentos" on documento_arquivos;
drop policy if exists "storage_cliente_ve_os_seus" on storage.objects;
drop policy if exists "storage_admin_gerencia_tudo" on storage.objects;
drop policy if exists "storage_cliente_envia_para_propria_pasta" on storage.objects;

-- ---------- Encolhe clientes/administradores pra tabelas de detalhe ----------
-- Todo FK que aponta PARA clientes.id/administradores.id (documentos.cliente_id,
-- documentos.criado_por) fica intocado — só as colunas de identidade saem daqui.
alter table clientes
  drop column if exists auth_user_id,
  drop column if exists nome,
  drop column if exists email,
  drop column if exists ativo,
  add column if not exists user_id uuid references users(id);
alter table clientes alter column user_id set not null;
alter table clientes add constraint clientes_user_id_key unique (user_id);

alter table administradores
  drop column if exists auth_user_id,
  drop column if exists nome,
  drop column if exists email,
  drop column if exists ativo,
  add column if not exists user_id uuid references users(id);
alter table administradores alter column user_id set not null;
alter table administradores add constraint administradores_user_id_key unique (user_id);

-- ---------- Funções auxiliares ----------
-- security definer é OBRIGATÓRIO aqui, não estilístico: sem ele, a consulta
-- interna a users/clientes rodaria com o papel de quem chamou a função,
-- reaplicando o RLS dessas mesmas tabelas e recursando infinitamente na
-- própria policy que chamou a função (stack depth limit exceeded). Com
-- security definer, a função roda como o DONO da função — que também é dono
-- de users/clientes aqui — e donos são isentos de RLS automaticamente
-- (contanto que ninguém rode "force row level security" nessas tabelas —
-- NUNCA adicionar isso "por segurança extra", quebraria a isenção).
-- set search_path = '' evita a classe de vulnerabilidade mais comum desse
-- tipo de função (alguém criar um objeto que resolve antes do pretendido na
-- busca de schema, rodando código arbitrário com o privilégio elevado).
create or replace function is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.users
    where auth_user_id = auth.uid()
      and tipo = 'administrador'
      and status = 'ativo'
  );
$$;
revoke all on function is_admin() from public;
grant execute on function is_admin() to authenticated;

-- Inclui "and u.tipo = 'cliente'" — sem esse filtro, se um user
-- tipo='administrador' algum dia também tivesse uma linha em clientes
-- vinculada, esta função devolveria o id dela mesmo sendo um admin, furando
-- o isolamento cliente-scoped em toda policy que usa current_cliente_id().
create or replace function current_cliente_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select c.id from public.clientes c
  join public.users u on u.id = c.user_id
  where u.auth_user_id = auth.uid()
    and u.status = 'ativo'
    and u.tipo = 'cliente'
$$;
revoke all on function current_cliente_id() from public;
grant execute on function current_cliente_id() to authenticated;

-- ---------- RPC: marcar_primeiro_acesso_concluido ----------
-- Única forma de gravar em "users" pelo app — chamada pela tela de
-- primeiro acesso depois que o usuário troca a senha temporária.
create or replace function marcar_primeiro_acesso_concluido()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.users
     set primeiro_acesso = false,
         updated_at = now()
   where auth_user_id = auth.uid();
end;
$$;
revoke all on function marcar_primeiro_acesso_concluido() from public;
grant execute on function marcar_primeiro_acesso_concluido() to authenticated;

-- ---------- RLS em users ----------
create policy "usuarios_ve_proprio_registro" on users
  for select
  using (auth_user_id = auth.uid());

create policy "usuarios_admin_ve_tudo" on users
  for select
  using (is_admin());

-- Sem policy de INSERT/UPDATE geral/DELETE: criação de usuário é fora de
-- banda (Dashboard do Supabase), de propósito, e a única escrita permitida é
-- via marcar_primeiro_acesso_concluido() acima. Um PATCH direto em /users
-- vindo de um frontend comprometido não casa com nenhuma policy e afeta 0
-- linhas. Se um dia precisar de admin ativar/desativar usuário pelo app, NÃO
-- criar uma policy ampla "for all using (is_admin())" aqui — isso deixaria
-- reescrever "tipo" de qualquer usuário via PATCH. Preferir uma RPC estreita
-- dedicada (ex: admin_definir_status_usuario(target_user_id, novo_status)
-- com security definer, validando o valor e checando is_admin() por dentro).

-- ---------- Policies recriadas ----------
create policy "categorias_escrita_admin" on categorias
  for all using (is_admin()) with check (is_admin());

create policy "clientes_ve_proprio_cadastro" on clientes
  for select using (id = current_cliente_id());

create policy "clientes_admin_gerencia_tudo" on clientes
  for all using (is_admin()) with check (is_admin());

create policy "administradores_visivel_para_admin" on administradores
  for select using (is_admin());

create policy "documentos_cliente_ve_os_seus" on documentos
  for select using (cliente_id = current_cliente_id());

create policy "documentos_admin_gerencia_tudo" on documentos
  for all using (is_admin()) with check (is_admin());

create policy "documentos_cliente_insere_nao_boleto" on documentos
  for insert
  with check (
    cliente_id = current_cliente_id()
    and categoria_id not in (
      select id from categorias where slug in ('boleto-honorarios', 'boleto-imposto')
    )
    and criado_por is null
  );

create policy "arquivos_cliente_ve_os_seus" on documento_arquivos
  for select
  using (documento_id in (select id from documentos where cliente_id = current_cliente_id()));

create policy "arquivos_admin_gerencia_tudo" on documento_arquivos
  for all using (is_admin()) with check (is_admin());

create policy "arquivos_cliente_insere_nos_seus_documentos" on documento_arquivos
  for insert
  with check (
    documento_id in (
      select d.id from documentos d
      where d.cliente_id = current_cliente_id()
        and d.categoria_id not in (
          select id from categorias where slug in ('boleto-honorarios', 'boleto-imposto')
        )
    )
  );

create policy "storage_cliente_ve_os_seus" on storage.objects
  for select
  using (bucket_id = 'documentos' and (storage.foldername(name))[1] = current_cliente_id()::text);

create policy "storage_admin_gerencia_tudo" on storage.objects
  for all
  using (bucket_id = 'documentos' and is_admin())
  with check (bucket_id = 'documentos' and is_admin());

create policy "storage_cliente_envia_para_propria_pasta" on storage.objects
  for insert
  with check (bucket_id = 'documentos' and (storage.foldername(name))[1] = current_cliente_id()::text);

-- ============================================================================
-- Migração: clientes ganha pessoa física/jurídica (tipo_pessoa, nome,
-- sobrenome, razão social, nome fantasia, CPF, CNPJ) + status de cliente
-- ============================================================================
-- Contexto: a migração anterior (users como fonte única) tirou nome/email de
-- clientes mas nunca devolveu um jeito de guardar os dados que distinguem
-- pessoa física de pessoa jurídica — isso volta aqui, junto com a RPC que
-- ativa/desativa o acesso de um cliente ao portal (admin_definir_status_cliente),
-- que faltava neste arquivo apesar de estar em uso desde a Fase 3 (aba
-- Clientes real). "documento" (a coluna genérica "CPF ou CNPJ" da tabela
-- original) sai de circulação — cpf e cnpj passam a ser colunas próprias,
-- cada uma validada e única só dentro do seu tipo de pessoa.
-- ============================================================================

alter table clientes
  drop column if exists documento,
  add column if not exists tipo_pessoa text,
  add column if not exists nome text,
  add column if not exists sobrenome text,
  add column if not exists razao_social text,
  add column if not exists nome_fantasia text,
  add column if not exists cpf text,
  add column if not exists cnpj text;

update clientes set tipo_pessoa = 'fisica' where tipo_pessoa is null;
alter table clientes alter column tipo_pessoa set not null;

alter table clientes
  add constraint clientes_tipo_pessoa_check check (tipo_pessoa in ('fisica', 'juridica')),
  add constraint clientes_nome_consistente check (
    (tipo_pessoa = 'fisica' and nome is not null and razao_social is null)
    or (tipo_pessoa = 'juridica' and razao_social is not null and nome is null)
  ),
  add constraint clientes_doc_consistente check (
    (tipo_pessoa = 'fisica' and cpf is not null and cnpj is null)
    or (tipo_pessoa = 'juridica' and cnpj is not null and cpf is null)
  );

-- Único só dentro de quem tem CPF/CNPJ preenchido (parcial) — não dá pra usar
-- "unique" direto porque cpf/cnpj ficam null pra quem é do outro tipo de
-- pessoa, e "unique" comum trataria vários nulls como duplicata só em alguns
-- bancos (Postgres na real já ignora NULL em unique, mas o índice parcial
-- deixa a intenção explícita e mais rápido de consultar).
create unique index if not exists clientes_cpf_key on clientes(cpf) where cpf is not null;
create unique index if not exists clientes_cnpj_key on clientes(cnpj) where cnpj is not null;

-- ---------- RPC admin_atualizar_cliente (primeira versão, só PF/PJ) ----------
create function public.admin_atualizar_cliente(
  p_cliente_id uuid, p_tipo_pessoa text, p_nome text, p_sobrenome text,
  p_razao_social text, p_nome_fantasia text, p_cpf text, p_cnpj text,
  p_email text, p_telefone text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_nome_completo text;
begin
  if not public.is_admin() then
    raise exception 'Apenas administradores podem editar clientes';
  end if;
  if p_tipo_pessoa not in ('fisica', 'juridica') then
    raise exception 'Tipo de pessoa inválido: %', p_tipo_pessoa;
  end if;

  select user_id into v_user_id from public.clientes where id = p_cliente_id;
  if v_user_id is null then
    raise exception 'Cliente não encontrado';
  end if;

  v_nome_completo := case
    when p_tipo_pessoa = 'fisica' then trim(p_nome || ' ' || coalesce(p_sobrenome, ''))
    else p_razao_social
  end;

  update public.users
     set nome = v_nome_completo, email = p_email, updated_at = now()
   where id = v_user_id;

  update public.clientes
     set tipo_pessoa = p_tipo_pessoa,
         nome = case when p_tipo_pessoa = 'fisica' then p_nome else null end,
         sobrenome = case when p_tipo_pessoa = 'fisica' then p_sobrenome else null end,
         razao_social = case when p_tipo_pessoa = 'juridica' then p_razao_social else null end,
         nome_fantasia = case when p_tipo_pessoa = 'juridica' then p_nome_fantasia else null end,
         cpf = case when p_tipo_pessoa = 'fisica' then p_cpf else null end,
         cnpj = case when p_tipo_pessoa = 'juridica' then p_cnpj else null end,
         telefone = nullif(trim(p_telefone), ''),
         updated_at = now()
   where id = p_cliente_id;
end;
$$;

revoke all on function public.admin_atualizar_cliente(uuid, text, text, text, text, text, text, text, text, text) from public;
revoke execute on function public.admin_atualizar_cliente(uuid, text, text, text, text, text, text, text, text, text) from anon;
grant execute on function public.admin_atualizar_cliente(uuid, text, text, text, text, text, text, text, text, text) to authenticated;

-- ---------- RPC admin_definir_status_cliente (ativar/desativar acesso) ----------
create or replace function public.admin_definir_status_cliente(p_cliente_id uuid, p_novo_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Apenas administradores podem alterar status de clientes';
  end if;
  if p_novo_status not in ('ativo', 'inativo') then
    raise exception 'Status inválido: %', p_novo_status;
  end if;

  select user_id into v_user_id from public.clientes where id = p_cliente_id;
  if v_user_id is null then
    raise exception 'Cliente não encontrado';
  end if;

  update public.users
     set status = p_novo_status, updated_at = now()
   where id = v_user_id;
end;
$$;

revoke all on function public.admin_definir_status_cliente(uuid, text) from public;
revoke execute on function public.admin_definir_status_cliente(uuid, text) from anon;
grant execute on function public.admin_definir_status_cliente(uuid, text) to authenticated;

-- ============================================================================
-- Migração: categorias dinâmicas (quem pode anexar, recorrência) + fluxo de
-- aprovação de documentos (pendente/enviado/em análise/aprovado/rejeitado)
-- ============================================================================
-- Contexto: até aqui, "é boleto?" era decidido comparando categoria.slug
-- contra um array fixo ('boleto-honorarios','boleto-imposto'), repetido com
-- pequenas variações em várias telas e nas duas policies de RLS abaixo. Isso
-- vira um campo real (quem_pode_anexar), e ganha também recorrência
-- (documento que o cliente precisa reenviar todo mês/quinzena/semana/ano) e
-- um status de revisão de verdade — coisas que "status" (pago/não-pago)
-- nunca representou, porque aquilo é sobre pagamento de boleto, não sobre
-- aprovação de documento.
-- ============================================================================

alter table categorias
  add column if not exists descricao text,
  add column if not exists quem_pode_anexar text not null default 'ambos',
  add column if not exists recorrente boolean not null default false,
  add column if not exists frequencia text not null default 'sob_demanda',
  add column if not exists ativa boolean not null default true;

alter table categorias
  add constraint categorias_quem_pode_anexar_valido
    check (quem_pode_anexar in ('administrador', 'cliente', 'ambos'));

alter table categorias
  add constraint categorias_frequencia_valida
    check (frequencia in ('mensal', 'quinzenal', 'semanal', 'anual', 'sob_demanda'));

-- recorrente=false sempre implica frequencia='sob_demanda' — não dá pra uma
-- categoria ficar "recorrente" sem dizer de quanto em quanto tempo, nem
-- "não recorrente" com uma frequência de verdade sobrando no dado.
alter table categorias
  add constraint categorias_recorrencia_consistente
    check (
      (recorrente = false and frequencia = 'sob_demanda')
      or (recorrente = true and frequencia in ('mensal', 'quinzenal', 'semanal', 'anual'))
    );

-- Backfill: só a partir daqui "apenas administrador" é um dado real — antes
-- disso só existia via slug hardcoded em código + RLS.
update categorias
  set quem_pode_anexar = 'administrador'
  where slug in ('boleto-honorarios', 'boleto-imposto');

alter table documentos
  add column if not exists status_revisao text not null default 'enviado',
  add column if not exists motivo_rejeicao text,
  add column if not exists revisado_em timestamptz,
  add column if not exists revisado_por uuid references administradores(id),
  add column if not exists periodo_referencia text;

alter table documentos
  add constraint documentos_status_revisao_valido
    check (status_revisao in ('enviado', 'em_analise', 'aprovado', 'rejeitado'));

-- "Pendente" nunca é uma linha gravada aqui — é sempre calculado no app a
-- partir da AUSÊNCIA de um documento pra aquela categoria+período. Não tem
-- cron/worker nesse projeto (protótipo estático + Supabase), então "pendente"
-- só pode ser um cálculo em tempo de leitura, nunca algo que precisa ser
-- gerado antecipadamente.
--
-- Reenvio depois de rejeitado = um documentos NOVO (insert), nunca um update
-- da linha rejeitada — preserva o histórico completo e significa que
-- cliente nunca precisa de policy de UPDATE (continua só INSERT+SELECT).

-- periodo_referencia é SEMPRE calculado aqui dentro, nunca aceito do que o
-- chamador mandar no insert — mesmo motivo do trigger definir_origem_documento
-- acima: um período adulterado (ou só um relógio errado no navegador do
-- cliente) poderia marcar uma obrigação futura como já resolvida.
create or replace function definir_periodo_referencia()
returns trigger as $$
declare
  cat public.categorias%rowtype;
  agora timestamp;
begin
  select * into cat from public.categorias where id = new.categoria_id;
  agora := now() at time zone 'America/Sao_Paulo';

  if cat.recorrente then
    new.periodo_referencia := case cat.frequencia
      when 'mensal' then to_char(agora, 'YYYY-MM')
      when 'anual' then to_char(agora, 'YYYY')
      -- IYYY (ano ISO), não YYYY: perto do fim de dezembro a semana ISO pode
      -- já pertencer ao ano seguinte, e YYYY-IW quebraria a ordenação.
      when 'semanal' then to_char(agora, 'IYYY-IW')
      when 'quinzenal' then to_char(agora, 'YYYY-MM') || '-Q' ||
        (case when extract(day from agora) <= 15 then '1' else '2' end)
      else null
    end;
  else
    new.periodo_referencia := null;
  end if;

  return new;
end;
$$ language plpgsql set search_path = '';

drop trigger if exists trg_definir_periodo_referencia on documentos;
create trigger trg_definir_periodo_referencia
  before insert on documentos
  for each row execute function definir_periodo_referencia();

-- ---------- Seed: categorias do grupo "Documentos Mensais" ----------
-- "Notas Fiscais" já existia como categoria padrão — não duplica, só passa a
-- fazer parte do grupo recorrente mensal.
update categorias
  set grupo = 'Documentos Mensais',
      recorrente = true,
      frequencia = 'mensal',
      obrigatoria = true,
      quem_pode_anexar = 'ambos'
  where slug = 'notas-fiscais';

insert into categorias (slug, nome, grupo, icone, cor, ordem, obrigatoria, recorrente, frequencia, quem_pode_anexar, tipos_arquivo_aceitos, tamanho_maximo_mb)
values
  ('extrato-bancario', 'Extrato Bancário', 'Documentos Mensais', 'doc', 'teal', 20, true, true, 'mensal', 'ambos', array['PDF'], 15),
  ('relatorio-maquininha', 'Relatório da Maquininha', 'Documentos Mensais', 'chart', 'teal', 21, true, true, 'mensal', 'ambos', array['PDF'], 15),
  ('comprovantes-pagamento', 'Comprovantes de Pagamentos', 'Documentos Mensais', 'doc', 'teal', 22, false, true, 'mensal', 'ambos', array['PDF'], 15)
on conflict (slug) do nothing;

-- Backfill de periodo_referencia pros documentos que já existiam ANTES da
-- categoria deles virar recorrente (ex: uma Nota Fiscal enviada este mês,
-- antes desta migration) — calculado a partir de created_at (quando o envio
-- de fato aconteceu), não de "agora".
update documentos d
set periodo_referencia = case c.frequencia
  when 'mensal' then to_char(d.created_at at time zone 'America/Sao_Paulo', 'YYYY-MM')
  when 'anual' then to_char(d.created_at at time zone 'America/Sao_Paulo', 'YYYY')
  when 'semanal' then to_char(d.created_at at time zone 'America/Sao_Paulo', 'IYYY-IW')
  when 'quinzenal' then to_char(d.created_at at time zone 'America/Sao_Paulo', 'YYYY-MM') || '-Q' ||
    (case when extract(day from d.created_at at time zone 'America/Sao_Paulo') <= 15 then '1' else '2' end)
  else null
end
from categorias c
where c.id = d.categoria_id and c.recorrente and d.periodo_referencia is null;

-- ---------- RLS: troca a checagem hardcoded de slug por quem_pode_anexar ----------
drop policy if exists "documentos_cliente_insere_nao_boleto" on documentos;
create policy "documentos_cliente_insere_permitido" on documentos
  for insert
  with check (
    cliente_id = current_cliente_id()
    and criado_por is null
    and categoria_id in (
      select id from categorias
      where quem_pode_anexar in ('cliente', 'ambos') and ativa
    )
  );

drop policy if exists "arquivos_cliente_insere_nos_seus_documentos" on documento_arquivos;
create policy "arquivos_cliente_insere_nos_seus_documentos" on documento_arquivos
  for insert
  with check (
    documento_id in (
      select d.id from documentos d
      where d.cliente_id = current_cliente_id()
        and d.categoria_id in (
          select id from categorias
          where quem_pode_anexar in ('cliente', 'ambos') and ativa
        )
    )
  );

-- ============================================================================
-- Migração: obrigatoriedade só em "Documentos da Empresa"/"Contrato" +
-- data_validade (alerta de documento ausente/vencendo/vencido)
-- ============================================================================
-- Pedido explícito: os únicos documentos obrigatórios pra todo cliente devem
-- ser esses dois — tudo que era obrigatório antes por outro motivo (boleto de
-- honorários, Cartão CNPJ, categorias recorrentes de Documentos Mensais)
-- deixa de ser (continuam existindo e podendo ser enviadas normalmente, só
-- não geram mais alerta de "ausente").
update categorias set obrigatoria = false where slug <> 'empresa' and slug <> 'contrato';
update categorias set obrigatoria = true where slug in ('empresa', 'contrato');

-- data_validade: quando o PRÓPRIO documento (ex: um Contrato) deixa de valer
-- e precisa ser renovado — conceito deliberadamente separado de
-- data_vencimento (que é só de boleto, e o trigger enforce_boleto_vencimento
-- proíbe em qualquer outra categoria). Nullable, sem trigger: é o admin quem
-- define isso manualmente ao aprovar um documento.
alter table documentos
  add column if not exists data_validade date;

-- ============================================================================
-- Migração: endereço obrigatório no cadastro de cliente
-- ============================================================================
-- Rua, número, cidade e estado são o mínimo exigido; CEP, complemento e
-- bairro ficam opcionais. Colunas planas (não jsonb), mesma convenção do
-- resto da tabela clientes.
alter table clientes
  add column if not exists endereco_cep text,
  add column if not exists endereco_rua text,
  add column if not exists endereco_numero text,
  add column if not exists endereco_complemento text,
  add column if not exists endereco_bairro text,
  add column if not exists endereco_cidade text,
  add column if not exists endereco_estado text;

update clientes set
  endereco_rua = coalesce(endereco_rua, 'Não informado'),
  endereco_numero = coalesce(endereco_numero, 'S/N'),
  endereco_cidade = coalesce(endereco_cidade, 'Não informado'),
  endereco_estado = coalesce(endereco_estado, 'SP')
where endereco_rua is null or endereco_numero is null or endereco_cidade is null or endereco_estado is null;

alter table clientes
  alter column endereco_rua set not null,
  alter column endereco_numero set not null,
  alter column endereco_cidade set not null,
  alter column endereco_estado set not null;

alter table clientes
  add constraint clientes_endereco_estado_valido check (
    endereco_estado in ('AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO')
  );

-- ---------- RPC admin_atualizar_cliente: nova assinatura com endereço ----------
-- Assinatura muda (novos parâmetros) — drop explícito antes do create,
-- senão o Postgres cria uma função sobrecarregada nova em vez de substituir.
drop function if exists public.admin_atualizar_cliente(uuid, text, text, text, text, text, text, text, text, text);

create function public.admin_atualizar_cliente(
  p_cliente_id uuid, p_tipo_pessoa text, p_nome text, p_sobrenome text,
  p_razao_social text, p_nome_fantasia text, p_cpf text, p_cnpj text,
  p_email text, p_telefone text,
  p_endereco_cep text, p_endereco_rua text, p_endereco_numero text,
  p_endereco_complemento text, p_endereco_bairro text, p_endereco_cidade text, p_endereco_estado text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_nome_completo text;
begin
  if not public.is_admin() then
    raise exception 'Apenas administradores podem editar clientes';
  end if;
  if p_tipo_pessoa not in ('fisica', 'juridica') then
    raise exception 'Tipo de pessoa inválido: %', p_tipo_pessoa;
  end if;

  -- Mesma regra de negócio da Edge Function admin-criar-cliente: rua,
  -- número, cidade e estado são obrigatórios pra qualquer cliente — nunca
  -- confiar só na validação que já rodou no admin.html.
  if coalesce(trim(p_endereco_rua), '') = '' then
    raise exception 'Endereço: rua é obrigatória';
  end if;
  if coalesce(trim(p_endereco_numero), '') = '' then
    raise exception 'Endereço: número é obrigatório';
  end if;
  if coalesce(trim(p_endereco_cidade), '') = '' then
    raise exception 'Endereço: cidade é obrigatória';
  end if;
  if upper(coalesce(p_endereco_estado, '')) not in ('AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO') then
    raise exception 'Endereço: estado inválido';
  end if;

  select user_id into v_user_id from public.clientes where id = p_cliente_id;
  if v_user_id is null then
    raise exception 'Cliente não encontrado';
  end if;

  v_nome_completo := case
    when p_tipo_pessoa = 'fisica' then trim(p_nome || ' ' || coalesce(p_sobrenome, ''))
    else p_razao_social
  end;

  update public.users
     set nome = v_nome_completo, email = p_email, updated_at = now()
   where id = v_user_id;

  update public.clientes
     set tipo_pessoa = p_tipo_pessoa,
         nome = case when p_tipo_pessoa = 'fisica' then p_nome else null end,
         sobrenome = case when p_tipo_pessoa = 'fisica' then p_sobrenome else null end,
         razao_social = case when p_tipo_pessoa = 'juridica' then p_razao_social else null end,
         nome_fantasia = case when p_tipo_pessoa = 'juridica' then p_nome_fantasia else null end,
         cpf = case when p_tipo_pessoa = 'fisica' then p_cpf else null end,
         cnpj = case when p_tipo_pessoa = 'juridica' then p_cnpj else null end,
         telefone = p_telefone,
         endereco_cep = nullif(trim(p_endereco_cep), ''),
         endereco_rua = p_endereco_rua,
         endereco_numero = p_endereco_numero,
         endereco_complemento = nullif(trim(p_endereco_complemento), ''),
         endereco_bairro = nullif(trim(p_endereco_bairro), ''),
         endereco_cidade = p_endereco_cidade,
         endereco_estado = upper(p_endereco_estado),
         updated_at = now()
   where id = p_cliente_id;
end;
$$;

-- O projeto tem uma default privilege que concede EXECUTE a "anon" em toda
-- função nova criada no schema public — "revoke all ... from public" não
-- alcança isso (é um grant direto pro role anon, não herdado de PUBLIC),
-- por isso o revoke explícito de anon logo abaixo.
revoke all on function public.admin_atualizar_cliente(uuid, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text) from public;
revoke execute on function public.admin_atualizar_cliente(uuid, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text) from anon;
grant execute on function public.admin_atualizar_cliente(uuid, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text) to authenticated;

-- ============================================================================
-- Migração: bairro passa a ser obrigatório no endereço do cliente
-- ============================================================================
-- Backfill primeiro: os clientes de teste tinham cidade = 'Não informado',
-- que não bate com nenhum município real do IBGE — Cidade virou um select
-- carregado da API do IBGE (lado admin.html), então esse valor ficaria órfão
-- (não apareceria selecionado na lista). Troca pra "São Paulo" (nome real,
-- já que o estado desses testes é SP) + bairro "Centro".
update clientes set
  endereco_bairro = coalesce(endereco_bairro, 'Centro'),
  endereco_cidade = case when endereco_cidade = 'Não informado' then 'São Paulo' else endereco_cidade end
where endereco_bairro is null or endereco_cidade = 'Não informado';

alter table clientes
  alter column endereco_bairro set not null;

-- admin_atualizar_cliente: bairro deixa de ser nullif(...) e passa a validar
-- como os outros campos obrigatórios do endereço (mesmo esquema de create-
-- or-replace, sem mudar a assinatura desta vez — só o corpo da função).
create or replace function public.admin_atualizar_cliente(
  p_cliente_id uuid, p_tipo_pessoa text, p_nome text, p_sobrenome text,
  p_razao_social text, p_nome_fantasia text, p_cpf text, p_cnpj text,
  p_email text, p_telefone text,
  p_endereco_cep text, p_endereco_rua text, p_endereco_numero text,
  p_endereco_complemento text, p_endereco_bairro text, p_endereco_cidade text, p_endereco_estado text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_nome_completo text;
begin
  if not public.is_admin() then
    raise exception 'Apenas administradores podem editar clientes';
  end if;
  if p_tipo_pessoa not in ('fisica', 'juridica') then
    raise exception 'Tipo de pessoa inválido: %', p_tipo_pessoa;
  end if;

  if coalesce(trim(p_endereco_rua), '') = '' then
    raise exception 'Endereço: rua é obrigatória';
  end if;
  if coalesce(trim(p_endereco_numero), '') = '' then
    raise exception 'Endereço: número é obrigatório';
  end if;
  if coalesce(trim(p_endereco_bairro), '') = '' then
    raise exception 'Endereço: bairro é obrigatório';
  end if;
  if coalesce(trim(p_endereco_cidade), '') = '' then
    raise exception 'Endereço: cidade é obrigatória';
  end if;
  if upper(coalesce(p_endereco_estado, '')) not in ('AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO') then
    raise exception 'Endereço: estado inválido';
  end if;

  select user_id into v_user_id from public.clientes where id = p_cliente_id;
  if v_user_id is null then
    raise exception 'Cliente não encontrado';
  end if;

  v_nome_completo := case
    when p_tipo_pessoa = 'fisica' then trim(p_nome || ' ' || coalesce(p_sobrenome, ''))
    else p_razao_social
  end;

  update public.users
     set nome = v_nome_completo, email = p_email, updated_at = now()
   where id = v_user_id;

  update public.clientes
     set tipo_pessoa = p_tipo_pessoa,
         nome = case when p_tipo_pessoa = 'fisica' then p_nome else null end,
         sobrenome = case when p_tipo_pessoa = 'fisica' then p_sobrenome else null end,
         razao_social = case when p_tipo_pessoa = 'juridica' then p_razao_social else null end,
         nome_fantasia = case when p_tipo_pessoa = 'juridica' then p_nome_fantasia else null end,
         cpf = case when p_tipo_pessoa = 'fisica' then p_cpf else null end,
         cnpj = case when p_tipo_pessoa = 'juridica' then p_cnpj else null end,
         telefone = p_telefone,
         endereco_cep = nullif(trim(p_endereco_cep), ''),
         endereco_rua = p_endereco_rua,
         endereco_numero = p_endereco_numero,
         endereco_complemento = nullif(trim(p_endereco_complemento), ''),
         endereco_bairro = p_endereco_bairro,
         endereco_cidade = p_endereco_cidade,
         endereco_estado = upper(p_endereco_estado),
         updated_at = now()
   where id = p_cliente_id;
end;
$$;

-- ============================================================================
-- Migração: telefone e CEP passam a ser obrigatórios no cadastro de cliente
-- ============================================================================
update clientes set telefone = coalesce(telefone, '11999990000') where telefone is null;
update clientes set endereco_cep = coalesce(endereco_cep, '01000000') where endereco_cep is null;

alter table clientes
  alter column telefone set not null,
  alter column endereco_cep set not null;

-- CEP não tem dígito verificador (ao contrário de CPF/CNPJ) — só uma forma
-- válida (8 dígitos, sem máscara). Telefone continua sem CHECK aqui de
-- propósito, mesmo motivo de CPF/CNPJ não terem: a validação real (DDD
-- válido, formato de celular) já existe e é mais completa no código (JS +
-- Edge Function/RPC) do que uma regex conseguiria expressar no banco.
alter table clientes
  add constraint clientes_endereco_cep_formato check (endereco_cep ~ '^[0-9]{8}$');

-- admin_atualizar_cliente: telefone e CEP deixam de aceitar vazio/null —
-- mesma assinatura, só muda o corpo.
create or replace function public.admin_atualizar_cliente(
  p_cliente_id uuid, p_tipo_pessoa text, p_nome text, p_sobrenome text,
  p_razao_social text, p_nome_fantasia text, p_cpf text, p_cnpj text,
  p_email text, p_telefone text,
  p_endereco_cep text, p_endereco_rua text, p_endereco_numero text,
  p_endereco_complemento text, p_endereco_bairro text, p_endereco_cidade text, p_endereco_estado text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_nome_completo text;
begin
  if not public.is_admin() then
    raise exception 'Apenas administradores podem editar clientes';
  end if;
  if p_tipo_pessoa not in ('fisica', 'juridica') then
    raise exception 'Tipo de pessoa inválido: %', p_tipo_pessoa;
  end if;

  if coalesce(trim(p_telefone), '') = '' then
    raise exception 'Telefone é obrigatório';
  end if;
  if coalesce(trim(p_endereco_cep), '') = '' then
    raise exception 'Endereço: CEP é obrigatório';
  end if;
  if coalesce(trim(p_endereco_rua), '') = '' then
    raise exception 'Endereço: rua é obrigatória';
  end if;
  if coalesce(trim(p_endereco_numero), '') = '' then
    raise exception 'Endereço: número é obrigatório';
  end if;
  if coalesce(trim(p_endereco_bairro), '') = '' then
    raise exception 'Endereço: bairro é obrigatório';
  end if;
  if coalesce(trim(p_endereco_cidade), '') = '' then
    raise exception 'Endereço: cidade é obrigatória';
  end if;
  if upper(coalesce(p_endereco_estado, '')) not in ('AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO') then
    raise exception 'Endereço: estado inválido';
  end if;

  select user_id into v_user_id from public.clientes where id = p_cliente_id;
  if v_user_id is null then
    raise exception 'Cliente não encontrado';
  end if;

  v_nome_completo := case
    when p_tipo_pessoa = 'fisica' then trim(p_nome || ' ' || coalesce(p_sobrenome, ''))
    else p_razao_social
  end;

  update public.users
     set nome = v_nome_completo, email = p_email, updated_at = now()
   where id = v_user_id;

  update public.clientes
     set tipo_pessoa = p_tipo_pessoa,
         nome = case when p_tipo_pessoa = 'fisica' then p_nome else null end,
         sobrenome = case when p_tipo_pessoa = 'fisica' then p_sobrenome else null end,
         razao_social = case when p_tipo_pessoa = 'juridica' then p_razao_social else null end,
         nome_fantasia = case when p_tipo_pessoa = 'juridica' then p_nome_fantasia else null end,
         cpf = case when p_tipo_pessoa = 'fisica' then p_cpf else null end,
         cnpj = case when p_tipo_pessoa = 'juridica' then p_cnpj else null end,
         telefone = p_telefone,
         endereco_cep = p_endereco_cep,
         endereco_rua = p_endereco_rua,
         endereco_numero = p_endereco_numero,
         endereco_complemento = nullif(trim(p_endereco_complemento), ''),
         endereco_bairro = p_endereco_bairro,
         endereco_cidade = p_endereco_cidade,
         endereco_estado = upper(p_endereco_estado),
         updated_at = now()
   where id = p_cliente_id;
end;
$$;

-- ============================================================================
-- Migração: correções da auditoria de segurança/produção — proprietário vs
-- administrador, proteção de categoria padrão, unificação da detecção de
-- boleto, motivo de rejeição obrigatório no banco, blindagem contra nome de
-- arquivo malicioso/malformado, e-mail não muda mais silenciosamente na
-- edição de cliente, índices que faltavam, RLS reavaliando auth.uid()/
-- auth.role() por linha
-- ============================================================================
-- Contexto: uma auditoria completa do fluxo de cliente e de documentos achou,
-- entre outras coisas, um XSS armazenado real (nome de arquivo enviado pelo
-- cliente era injetado sem escape no innerHTML do painel administrativo — a
-- correção principal foi no front-end, escapando/usando textContent em vez de
-- innerHTML; o que está aqui é a blindagem correspondente no banco) e que
-- "proprietário" existia como rótulo em administradores.nivel mas nunca era
-- de fato aplicado em nenhuma regra de permissão.
-- ============================================================================

-- ---------- 1) proprietário vs administrador (categorias) ----------
create or replace function public.is_proprietario()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.users u
    join public.administradores a on a.user_id = u.id
    where u.auth_user_id = auth.uid()
      and u.tipo = 'administrador'
      and u.status = 'ativo'
      and a.nivel = 'proprietario'
  );
$$;

-- Função nova (não "or replace" de uma já existente) — o Supabase concede
-- EXECUTE pra PUBLIC por padrão em funções novas no schema public, e "anon"
-- herda de PUBLIC. Revoga de PUBLIC (não bastaria revogar só de "anon") e
-- regrante só pra authenticated, no mesmo padrão de is_admin().
revoke execute on function public.is_proprietario() from public;
grant execute on function public.is_proprietario() to authenticated;

drop policy if exists "categorias_escrita_admin" on categorias;

create policy "categorias_insere_proprietario" on categorias
  for insert
  with check (is_proprietario());

create policy "categorias_atualiza_proprietario" on categorias
  for update
  using (is_proprietario())
  with check (is_proprietario());

create policy "categorias_exclui_proprietario" on categorias
  for delete
  using (is_proprietario());

-- ---------- 2) categoria padrão nunca pode ser excluída (agora de verdade) ----------
create or replace function public.impedir_exclusao_categoria_padrao()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.padrao then
    raise exception 'Categoria padrão "%" não pode ser excluída', old.nome;
  end if;
  return old;
end;
$$;

drop trigger if exists trg_impedir_exclusao_categoria_padrao on categorias;
create trigger trg_impedir_exclusao_categoria_padrao
  before delete on categorias
  for each row execute function public.impedir_exclusao_categoria_padrao();

-- ---------- 3) "é boleto?" vira um campo explícito, não duas definições diferentes ----------
-- Antes disso, a tela decidia "é boleto" olhando quem_pode_anexar==='administrador'
-- e o gatilho abaixo decidia olhando o slug — uma categoria administrador-only
-- nova que não fosse literalmente um dos dois boletos quebrava a tela.
alter table categorias add column if not exists eh_boleto boolean not null default false;
update categorias set eh_boleto = true where slug in ('boleto-honorarios', 'boleto-imposto');

create or replace function public.enforce_boleto_vencimento()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_categoria_nome text;
  v_eh_boleto boolean;
begin
  select nome, eh_boleto into v_categoria_nome, v_eh_boleto
  from public.categorias where id = new.categoria_id;

  if v_eh_boleto then
    if new.data_vencimento is null then
      raise exception 'Boletos (categoria %) precisam de data_vencimento', v_categoria_nome;
    end if;
    if new.status is null or new.status not in ('pago', 'nao_pago') then
      raise exception 'Boletos (categoria %) precisam de status "pago" ou "nao_pago"', v_categoria_nome;
    end if;
  else
    if new.data_vencimento is not null then
      raise exception 'Documentos da categoria % não podem ter data_vencimento (só boletos têm vencimento)', v_categoria_nome;
    end if;
    if new.status is not null then
      raise exception 'Documentos da categoria % não podem ter status de pagamento (só boletos têm)', v_categoria_nome;
    end if;
  end if;

  return new;
end;
$$;

-- ---------- 4) motivo de rejeição obrigatório também no banco ----------
alter table documentos add constraint documentos_motivo_rejeicao_obrigatorio
  check (status_revisao != 'rejeitado' or motivo_rejeicao is not null);

-- ---------- 5) defesa em profundidade contra nome de arquivo malicioso/malformado ----------
-- A correção real do XSS foi escapar na renderização (front-end) — isso aqui
-- só impede que um nome de arquivo absurdo (controle de caractere, tamanho
-- desproporcional) chegue a ser gravado.
alter table documentos add constraint documentos_nome_seguro
  check (char_length(nome) between 1 and 255 and nome !~ '[\x00-\x1F\x7F]');

alter table documento_arquivos add constraint documento_arquivos_nome_original_seguro
  check (char_length(nome_original) between 1 and 255 and nome_original !~ '[\x00-\x1F\x7F]');

alter table documento_arquivos add constraint documento_arquivos_tipo_arquivo_seguro
  check (char_length(tipo_arquivo) between 1 and 20 and tipo_arquivo !~ '[\x00-\x1F\x7F]');

-- ---------- 6) editar cliente nunca mais muda e-mail por essa via ----------
-- O campo de e-mail já vinha desabilitado na tela de edição, mas isso é só um
-- atributo HTML — quem chamasse a RPC direto (console do navegador) conseguia
-- mudar o e-mail exibido sem tocar no e-mail de login real do Supabase Auth,
-- desalinhando os dois. A RPC agora ignora p_email numa edição — o e-mail só
-- é definido na criação (Edge Function). Corpo muda, assinatura continua igual.
create or replace function public.admin_atualizar_cliente(
  p_cliente_id uuid, p_tipo_pessoa text, p_nome text, p_sobrenome text,
  p_razao_social text, p_nome_fantasia text, p_cpf text, p_cnpj text,
  p_email text, p_telefone text,
  p_endereco_cep text, p_endereco_rua text, p_endereco_numero text,
  p_endereco_complemento text, p_endereco_bairro text, p_endereco_cidade text, p_endereco_estado text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_nome_completo text;
begin
  if not public.is_admin() then
    raise exception 'Apenas administradores podem editar clientes';
  end if;
  if p_tipo_pessoa not in ('fisica', 'juridica') then
    raise exception 'Tipo de pessoa inválido: %', p_tipo_pessoa;
  end if;

  if coalesce(trim(p_telefone), '') = '' then
    raise exception 'Telefone é obrigatório';
  end if;
  if coalesce(trim(p_endereco_cep), '') = '' then
    raise exception 'Endereço: CEP é obrigatório';
  end if;
  if coalesce(trim(p_endereco_rua), '') = '' then
    raise exception 'Endereço: rua é obrigatória';
  end if;
  if coalesce(trim(p_endereco_numero), '') = '' then
    raise exception 'Endereço: número é obrigatório';
  end if;
  if coalesce(trim(p_endereco_bairro), '') = '' then
    raise exception 'Endereço: bairro é obrigatório';
  end if;
  if coalesce(trim(p_endereco_cidade), '') = '' then
    raise exception 'Endereço: cidade é obrigatória';
  end if;
  if upper(coalesce(p_endereco_estado, '')) not in ('AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO') then
    raise exception 'Endereço: estado inválido';
  end if;

  select user_id into v_user_id from public.clientes where id = p_cliente_id;
  if v_user_id is null then
    raise exception 'Cliente não encontrado';
  end if;

  v_nome_completo := case
    when p_tipo_pessoa = 'fisica' then trim(p_nome || ' ' || coalesce(p_sobrenome, ''))
    else p_razao_social
  end;

  update public.users
     set nome = v_nome_completo, updated_at = now()
   where id = v_user_id;

  update public.clientes
     set tipo_pessoa = p_tipo_pessoa,
         nome = case when p_tipo_pessoa = 'fisica' then p_nome else null end,
         sobrenome = case when p_tipo_pessoa = 'fisica' then p_sobrenome else null end,
         razao_social = case when p_tipo_pessoa = 'juridica' then p_razao_social else null end,
         nome_fantasia = case when p_tipo_pessoa = 'juridica' then p_nome_fantasia else null end,
         cpf = case when p_tipo_pessoa = 'fisica' then p_cpf else null end,
         cnpj = case when p_tipo_pessoa = 'juridica' then p_cnpj else null end,
         telefone = p_telefone,
         endereco_cep = p_endereco_cep,
         endereco_rua = p_endereco_rua,
         endereco_numero = p_endereco_numero,
         endereco_complemento = nullif(trim(p_endereco_complemento), ''),
         endereco_bairro = p_endereco_bairro,
         endereco_cidade = p_endereco_cidade,
         endereco_estado = upper(p_endereco_estado),
         updated_at = now()
   where id = p_cliente_id;
end;
$$;

-- ---------- 7) índices que faltavam (FKs usadas em filtro/join no admin) ----------
create index if not exists idx_documentos_criado_por on documentos(criado_por);
create index if not exists idx_documentos_revisado_por on documentos(revisado_por);

-- ---------- 8) RLS reavaliando auth.uid()/auth.role() por linha (perf em escala) ----------
drop policy if exists "categorias_leitura_geral" on categorias;
create policy "categorias_leitura_geral" on categorias
  for select
  using ((select auth.role()) = 'authenticated');

drop policy if exists "usuarios_ve_proprio_registro" on users;
create policy "usuarios_ve_proprio_registro" on users
  for select
  using (auth_user_id = (select auth.uid()));

drop policy if exists "configuracoes_empresa_leitura_geral" on configuracoes_empresa;
create policy "configuracoes_empresa_leitura_geral" on configuracoes_empresa
  for select
  using ((select auth.role()) = 'authenticated');

-- ---------- 9) Exclusão permanente de usuários (hard delete) + validação de arquivo no banco ----------
-- Antes, excluir um administrador que já criou/revisou algum documento
-- falhava com violação de FK (NO ACTION) — na prática, a funcionalidade não
-- existia pra nenhum admin com histórico real de uso. Trocado pra SET NULL:
-- o documento sobrevive intacto (nada órfão), só perde a referência de
-- "quem enviou/revisou", aceitável ao excluir a conta.
alter table documentos drop constraint documentos_criado_por_fkey;
alter table documentos add constraint documentos_criado_por_fkey
  foreign key (criado_por) references administradores(id) on delete set null;

alter table documentos drop constraint documentos_revisado_por_fkey;
alter table documentos add constraint documentos_revisado_por_fkey
  foreign key (revisado_por) references administradores(id) on delete set null;

-- Trava de segurança direto no banco: nunca permite excluir o último
-- administrador de nível 'proprietario' (o sistema ficaria sem ninguém
-- capaz de gerenciar categorias/outros administradores).
create or replace function impedir_exclusao_ultimo_proprietario()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.nivel = 'proprietario' and (
    select count(*) from administradores where nivel = 'proprietario'
  ) <= 1 then
    raise exception 'Não é possível excluir o único administrador proprietário do sistema.';
  end if;
  return old;
end;
$$;

create trigger trg_impedir_exclusao_ultimo_proprietario
  before delete on administradores
  for each row execute function impedir_exclusao_ultimo_proprietario();

-- Gap real encontrado numa auditoria: tipo e tamanho de arquivo só eram
-- validados no JS (validarArquivoParaCategoria em app.js) — nada impedia um
-- cliente tecnicamente capaz de chamar a API do Supabase direto (contornando
-- a tela) de subir um arquivo de tipo/tamanho fora do permitido pra
-- categoria. Agora documento_arquivos valida contra as regras reais da
-- categoria (via documentos.categoria_id) no próprio banco, na inserção E
-- na atualização — o front continua com o mesmo aviso amigável de antes
-- (mais rápido, sem round-trip), mas deixa de ser a única barreira.
create or replace function validar_arquivo_documento()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tipos_aceitos text[];
  v_tamanho_maximo_mb integer;
begin
  select c.tipos_arquivo_aceitos, c.tamanho_maximo_mb
    into v_tipos_aceitos, v_tamanho_maximo_mb
  from documentos d
  join categorias c on c.id = d.categoria_id
  where d.id = new.documento_id;

  if v_tipos_aceitos is not null and array_length(v_tipos_aceitos, 1) > 0
     and upper(new.tipo_arquivo) <> all (v_tipos_aceitos) then
    raise exception 'Tipo de arquivo "%" não é aceito nesta categoria.', new.tipo_arquivo;
  end if;

  if new.tamanho_bytes is not null and v_tamanho_maximo_mb is not null
     and new.tamanho_bytes > (v_tamanho_maximo_mb::bigint * 1024 * 1024) then
    raise exception 'Arquivo maior que o permitido nesta categoria (máx. % MB).', v_tamanho_maximo_mb;
  end if;

  return new;
end;
$$;

create trigger trg_validar_arquivo_documento
  before insert or update on documento_arquivos
  for each row execute function validar_arquivo_documento();

revoke execute on function impedir_exclusao_ultimo_proprietario() from public;
revoke execute on function validar_arquivo_documento() from public;

-- ---------- 10) Nova categoria: Folha de Pagamento ----------
-- Documento mensal recorrente, preparado e entregue pelo escritório de
-- contabilidade pro cliente (mesmo padrão de boleto: quem_pode_anexar =
-- 'administrador') — a folha é calculada pelo contador com base na equipe
-- do cliente, não é algo que o cliente já tem em mãos pra anexar.
insert into categorias (slug, nome, grupo, icone, cor, ordem, padrao, obrigatoria, tipos_arquivo_aceitos, tamanho_maximo_mb, quem_pode_anexar, recorrente, frequencia, ativa, eh_boleto)
values ('folha-pagamento', 'Folha de Pagamento', 'Documentos Mensais', 'doc', 'navy', 23, false, false, array['PDF'], 10, 'administrador', true, 'mensal', true, false)
on conflict (slug) do nothing;

-- ---------- 11) RLS de categorias: cliente só vê categorias ativas ----------
-- Antes, "categorias_leitura_geral" liberava SELECT pra QUALQUER usuário
-- autenticado (admin ou cliente) em TODAS as linhas, incluindo categorias
-- desativadas (ativa=false) — um cliente chamando a API do Supabase direto
-- (sem passar pela tela) conseguia listar nome/ícone/regras de categorias
-- que nunca deveriam aparecer pra ele. Agora: administrador continua vendo
-- tudo (precisa, pra gerenciar até categoria desativada); cliente só vê
-- categorias com ativa=true — nem a linha existe pra ele se desativada.
drop policy if exists "categorias_leitura_geral" on categorias;

create policy "categorias_leitura_admin" on categorias
  for select
  using (is_admin());

create policy "categorias_leitura_cliente" on categorias
  for select
  using (current_cliente_id() is not null and ativa = true);

-- ---------- 12) Visibilidade de documento por cliente (interno vs visível) ----------
-- Controle explícito, por documento, de "isso é interno ou o cliente pode
-- ver": até agora um documento existia pro cliente sempre que cliente_id
-- batia — não havia como o administrador marcar algo como uso interno (ex:
-- rascunho, anotação, documento em revisão) sem ele aparecer na hora no
-- painel do cliente. Default true preserva o comportamento de todos os
-- documentos já existentes (nenhum vira "invisível" retroativamente).
alter table documentos add column visivel_cliente boolean not null default true;

-- A categoria continua sendo a camada de permissão SUPERIOR: mesmo um
-- documento com visivel_cliente=true não aparece se a própria categoria
-- estiver desativada — enforcement 100% aqui na RLS, não no frontend.
drop policy if exists "documentos_cliente_ve_os_seus" on documentos;
create policy "documentos_cliente_ve_os_seus" on documentos
  for select
  using (
    cliente_id = current_cliente_id()
    and visivel_cliente = true
    and categoria_id in (select id from categorias where ativa = true)
  );

drop policy if exists "arquivos_cliente_ve_os_seus" on documento_arquivos;
create policy "arquivos_cliente_ve_os_seus" on documento_arquivos
  for select
  using (
    documento_id in (
      select d.id from documentos d
      join categorias c on c.id = d.categoria_id
      where d.cliente_id = current_cliente_id()
        and d.visivel_cliente = true
        and c.ativa = true
    )
  );

-- ============================================================================
-- Tabela: configuracoes_empresa (documentação retroativa)
-- ============================================================================
-- Esta tabela já existia em produção (usada por admin.html na aba
-- "Perfil da empresa" desde antes deste arquivo cobrir essa parte do
-- schema) mas nunca tinha sido registrada aqui — uma auditoria de
-- segurança revisando "toda tabela tem RLS?" não conseguiu confirmar isso
-- só lendo o repositório, porque faltava exatamente esta seção. Consultado
-- direto no banco: RLS está ativo e as policies já são as corretas (leitura
-- geral autenticada, escrita só admin) — nada mudou no banco aqui, é só
-- documentação alcançando a realidade.
create table if not exists configuracoes_empresa (
  id uuid primary key default gen_random_uuid(),
  nome text,
  nome_fantasia text,
  email_contato text,
  telefone text,
  endereco text,
  dias_antecedencia_alerta integer not null default 7,
  alerta_boletos_ativo boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table configuracoes_empresa enable row level security;

create policy "configuracoes_empresa_leitura_geral" on configuracoes_empresa
  for select
  using ((select auth.role()) = 'authenticated');

create policy "configuracoes_empresa_escrita_admin" on configuracoes_empresa
  for all using (is_admin()) with check (is_admin());

-- ============================================================================
-- Migração: correções da auditoria de segurança (rate limiting + EXECUTE
-- desnecessário revelado pelo linter do Supabase)
-- ============================================================================
-- Contexto: uma auditoria de segurança contra os 10 furos mais comuns em
-- apps feitos com IA achou, entre outras coisas, que duas funções
-- SECURITY DEFINER usadas SÓ como gatilho (nunca deveriam ser chamáveis
-- direto pela API) estavam com EXECUTE concedido a anon/authenticated —
-- sobra da concessão padrão que o Supabase aplica a toda função nova no
-- schema public, nunca revogada porque ninguém tinha motivo de suspeitar
-- até o advisor de segurança apontar. Um gatilho não precisa de EXECUTE
-- concedido pra rodar (roda com o dono da função automaticamente).
revoke execute on function public.impedir_exclusao_ultimo_proprietario() from public, anon, authenticated;
revoke execute on function public.validar_arquivo_documento() from public, anon, authenticated;

-- Suporte pro rate limiting das 4 Edge Functions administrativas (criar
-- cliente, excluir cliente, convidar administrador, excluir administrador)
-- — nenhuma delas tinha qualquer limite próprio contra uma sessão de admin
-- comprometida (ou script em loop) repetindo a chamada sem parar. Não
-- existe cron/worker nesse projeto (protótipo estático + Supabase), então
-- a limpeza de linha expirada acontece de carona em cada chamada.
create table if not exists rate_limit_contadores (
  chave text primary key,
  contagem integer not null default 1,
  expira_em timestamptz not null
);

-- RLS ativado com ZERO policy pra anon/authenticated de propósito — só
-- service_role (as próprias Edge Functions) toca nessa tabela; ninguém
-- conseguiria ler ou escrever aqui via API pública mesmo que tentasse.
alter table rate_limit_contadores enable row level security;
revoke all on rate_limit_contadores from anon, authenticated;

-- ---------- Histórico do cliente: eventos sem timestamp próprio ----------
-- "Documento enviado/aprovado/rejeitado" e "boleto pago" já são derivados
-- direto de documentos.created_at/revisado_em/pago_em na tela — não
-- precisam de tabela própria. Só "status alterado" (ativo/inativo) e
-- "dados cadastrais editados" não deixavam NENHUM rastro até aqui; esta
-- tabela cobre só esses dois, não é uma auditoria genérica do sistema.
-- Inserção feita no admin.html, direto depois do sucesso das RPCs
-- admin_definir_status_cliente/admin_atualizar_cliente (mesmo padrão
-- "grava só depois que a ação principal confirmou" do resto do painel).
create table if not exists eventos_cliente (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references clientes(id) on delete cascade,
  tipo text not null check (tipo = any (array['status_alterado', 'dados_editados'])),
  descricao text not null,
  ator text,
  created_at timestamptz not null default now()
);

create index if not exists idx_eventos_cliente_cliente_id on eventos_cliente(cliente_id);

alter table eventos_cliente enable row level security;

-- Só administradores leem/escrevem — mesmo is_admin() já usado em outras
-- tabelas administrativas deste projeto.
create policy eventos_cliente_leitura_admin on eventos_cliente
  for select
  to authenticated
  using (is_admin());

create policy eventos_cliente_escrita_admin on eventos_cliente
  for insert
  to authenticated
  with check (is_admin());

-- ---------- 11) Auditoria da tela Financeiro: documentos.updated_at nunca
-- era atualizado em nenhum UPDATE (ficava congelado na data de criação pra
-- sempre, mesmo depois de marcar boleto como pago ou reanalisar um
-- documento) — mesmo padrão de trigger simples já usado neste schema
-- (definir_origem_documento, definir_periodo_referencia). ----------
create or replace function atualizar_updated_at_documentos()
returns trigger as $$
begin
  new.updated_at := now();
  return new;
end;
$$ language plpgsql set search_path = '';

drop trigger if exists trg_atualizar_updated_at_documentos on documentos;
create trigger trg_atualizar_updated_at_documentos
  before update on documentos
  for each row execute function atualizar_updated_at_documentos();

-- ---------- 12) Realtime no painel administrativo ----------
-- Painel admin passa a usar Supabase Realtime pra sincronizar entre sessões
-- sem F5. RLS já existente (is_admin() etc.) protege quem recebe cada
-- evento — inscrever na publicação não abre nenhuma policy nova.
alter publication supabase_realtime add table
  categorias, clientes, documentos, administradores, configuracoes_empresa, eventos_cliente;

-- ---------- 13) Fundação de auditoria real: quem criou/editou o quê ----------
-- Antes desta migration, clientes não guardava quem criou o cadastro, e
-- eventos_cliente só guardava uma frase genérica ("Dados cadastrais
-- atualizados") com um "ator" texto livre inserido pelo próprio browser
-- DEPOIS da RPC retornar sucesso — nunca resolvido no servidor, sem diff
-- por campo. Esta migration move a gravação do evento pra dentro das RPCs
-- (SECURITY DEFINER, mesma transação do UPDATE) e adiciona colunas pra
-- registrar o campo alterado + valor anterior/novo.

alter table clientes
  add column if not exists criado_por uuid references administradores(id) on delete set null;
-- null nas linhas existentes antes desta migration — não dá pra descobrir
-- retroativamente quem criou; a UI admite "origem desconhecida" em vez de
-- inventar um nome.
create index if not exists idx_clientes_criado_por on clientes(criado_por);

alter table eventos_cliente
  add column if not exists campo text,
  add column if not exists valor_anterior text,
  add column if not exists valor_novo text,
  add column if not exists ator_admin_id uuid references administradores(id) on delete set null;
create index if not exists idx_eventos_cliente_ator_admin_id on eventos_cliente(ator_admin_id);

alter table eventos_cliente drop constraint eventos_cliente_tipo_check;
alter table eventos_cliente add constraint eventos_cliente_tipo_check
  check (tipo = any (array['status_alterado', 'dados_editados', 'cliente_criado']));

-- admin_atual(): quem está autenticado agora, resolvido no servidor.
-- Reaproveitada por admin_atualizar_cliente/admin_definir_status_cliente
-- abaixo e pela Edge Function admin-criar-cliente (via callerClient.rpc).
create or replace function public.admin_atual()
returns table(id uuid, nome text)
language sql
stable
security definer
set search_path = ''
as $$
  select a.id, u.nome
  from public.administradores a
  join public.users u on u.id = a.user_id
  where u.auth_user_id = auth.uid();
$$;
revoke all on function public.admin_atual() from public;
revoke execute on function public.admin_atual() from anon;
grant execute on function public.admin_atual() to authenticated;

-- admin_atualizar_cliente: agora grava o diff por campo, na mesma transação.
create or replace function public.admin_atualizar_cliente(
  p_cliente_id uuid, p_tipo_pessoa text, p_nome text, p_sobrenome text,
  p_razao_social text, p_nome_fantasia text, p_cpf text, p_cnpj text,
  p_email text, p_telefone text,
  p_endereco_cep text, p_endereco_rua text, p_endereco_numero text,
  p_endereco_complemento text, p_endereco_bairro text, p_endereco_cidade text, p_endereco_estado text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.clientes;
  v_admin_id uuid;
  v_admin_nome text;
  v_nome_completo text;
  v_novo_nome text; v_novo_sobrenome text; v_nova_razao text; v_nova_fantasia text;
  v_novo_cpf text; v_novo_cnpj text; v_novo_complemento text; v_novo_estado text;
begin
  if not public.is_admin() then
    raise exception 'Apenas administradores podem editar clientes';
  end if;
  if p_tipo_pessoa not in ('fisica', 'juridica') then
    raise exception 'Tipo de pessoa inválido: %', p_tipo_pessoa;
  end if;

  if coalesce(trim(p_telefone), '') = '' then
    raise exception 'Telefone é obrigatório';
  end if;
  if coalesce(trim(p_endereco_cep), '') = '' then
    raise exception 'Endereço: CEP é obrigatório';
  end if;
  if coalesce(trim(p_endereco_rua), '') = '' then
    raise exception 'Endereço: rua é obrigatória';
  end if;
  if coalesce(trim(p_endereco_numero), '') = '' then
    raise exception 'Endereço: número é obrigatório';
  end if;
  if coalesce(trim(p_endereco_bairro), '') = '' then
    raise exception 'Endereço: bairro é obrigatório';
  end if;
  if coalesce(trim(p_endereco_cidade), '') = '' then
    raise exception 'Endereço: cidade é obrigatória';
  end if;
  if upper(coalesce(p_endereco_estado, '')) not in ('AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO') then
    raise exception 'Endereço: estado inválido';
  end if;

  select * into v_old from public.clientes where id = p_cliente_id;
  if v_old.id is null then
    raise exception 'Cliente não encontrado';
  end if;

  select a.id, u.nome into v_admin_id, v_admin_nome
  from public.administradores a join public.users u on u.id = a.user_id
  where u.auth_user_id = auth.uid();

  v_novo_nome := case when p_tipo_pessoa = 'fisica' then p_nome else null end;
  v_novo_sobrenome := case when p_tipo_pessoa = 'fisica' then p_sobrenome else null end;
  v_nova_razao := case when p_tipo_pessoa = 'juridica' then p_razao_social else null end;
  v_nova_fantasia := case when p_tipo_pessoa = 'juridica' then p_nome_fantasia else null end;
  v_novo_cpf := case when p_tipo_pessoa = 'fisica' then p_cpf else null end;
  v_novo_cnpj := case when p_tipo_pessoa = 'juridica' then p_cnpj else null end;
  v_novo_complemento := nullif(trim(p_endereco_complemento), '');
  v_novo_estado := upper(p_endereco_estado);

  v_nome_completo := case
    when p_tipo_pessoa = 'fisica' then trim(p_nome || ' ' || coalesce(p_sobrenome, ''))
    else p_razao_social
  end;

  update public.users
     set nome = v_nome_completo, updated_at = now()
   where id = v_old.user_id;

  update public.clientes
     set tipo_pessoa = p_tipo_pessoa,
         nome = v_novo_nome,
         sobrenome = v_novo_sobrenome,
         razao_social = v_nova_razao,
         nome_fantasia = v_nova_fantasia,
         cpf = v_novo_cpf,
         cnpj = v_novo_cnpj,
         telefone = p_telefone,
         endereco_cep = p_endereco_cep,
         endereco_rua = p_endereco_rua,
         endereco_numero = p_endereco_numero,
         endereco_complemento = v_novo_complemento,
         endereco_bairro = p_endereco_bairro,
         endereco_cidade = p_endereco_cidade,
         endereco_estado = v_novo_estado,
         updated_at = now()
   where id = p_cliente_id;

  -- Uma linha de evento por campo realmente alterado (não por chamada) —
  -- "is distinct from" trata null corretamente (null vs null não é diff).
  if v_old.tipo_pessoa is distinct from p_tipo_pessoa then
    insert into public.eventos_cliente (cliente_id, tipo, descricao, ator, ator_admin_id, campo, valor_anterior, valor_novo)
    values (p_cliente_id, 'dados_editados', 'Dados cadastrais atualizados', v_admin_nome, v_admin_id, 'tipo_pessoa', v_old.tipo_pessoa, p_tipo_pessoa);
  end if;
  if v_old.nome is distinct from v_novo_nome then
    insert into public.eventos_cliente (cliente_id, tipo, descricao, ator, ator_admin_id, campo, valor_anterior, valor_novo)
    values (p_cliente_id, 'dados_editados', 'Dados cadastrais atualizados', v_admin_nome, v_admin_id, 'nome', v_old.nome, v_novo_nome);
  end if;
  if v_old.sobrenome is distinct from v_novo_sobrenome then
    insert into public.eventos_cliente (cliente_id, tipo, descricao, ator, ator_admin_id, campo, valor_anterior, valor_novo)
    values (p_cliente_id, 'dados_editados', 'Dados cadastrais atualizados', v_admin_nome, v_admin_id, 'sobrenome', v_old.sobrenome, v_novo_sobrenome);
  end if;
  if v_old.razao_social is distinct from v_nova_razao then
    insert into public.eventos_cliente (cliente_id, tipo, descricao, ator, ator_admin_id, campo, valor_anterior, valor_novo)
    values (p_cliente_id, 'dados_editados', 'Dados cadastrais atualizados', v_admin_nome, v_admin_id, 'razao_social', v_old.razao_social, v_nova_razao);
  end if;
  if v_old.nome_fantasia is distinct from v_nova_fantasia then
    insert into public.eventos_cliente (cliente_id, tipo, descricao, ator, ator_admin_id, campo, valor_anterior, valor_novo)
    values (p_cliente_id, 'dados_editados', 'Dados cadastrais atualizados', v_admin_nome, v_admin_id, 'nome_fantasia', v_old.nome_fantasia, v_nova_fantasia);
  end if;
  if v_old.cpf is distinct from v_novo_cpf then
    insert into public.eventos_cliente (cliente_id, tipo, descricao, ator, ator_admin_id, campo, valor_anterior, valor_novo)
    values (p_cliente_id, 'dados_editados', 'Dados cadastrais atualizados', v_admin_nome, v_admin_id, 'cpf', v_old.cpf, v_novo_cpf);
  end if;
  if v_old.cnpj is distinct from v_novo_cnpj then
    insert into public.eventos_cliente (cliente_id, tipo, descricao, ator, ator_admin_id, campo, valor_anterior, valor_novo)
    values (p_cliente_id, 'dados_editados', 'Dados cadastrais atualizados', v_admin_nome, v_admin_id, 'cnpj', v_old.cnpj, v_novo_cnpj);
  end if;
  if v_old.telefone is distinct from p_telefone then
    insert into public.eventos_cliente (cliente_id, tipo, descricao, ator, ator_admin_id, campo, valor_anterior, valor_novo)
    values (p_cliente_id, 'dados_editados', 'Dados cadastrais atualizados', v_admin_nome, v_admin_id, 'telefone', v_old.telefone, p_telefone);
  end if;
  if v_old.endereco_cep is distinct from p_endereco_cep then
    insert into public.eventos_cliente (cliente_id, tipo, descricao, ator, ator_admin_id, campo, valor_anterior, valor_novo)
    values (p_cliente_id, 'dados_editados', 'Dados cadastrais atualizados', v_admin_nome, v_admin_id, 'endereco_cep', v_old.endereco_cep, p_endereco_cep);
  end if;
  if v_old.endereco_rua is distinct from p_endereco_rua then
    insert into public.eventos_cliente (cliente_id, tipo, descricao, ator, ator_admin_id, campo, valor_anterior, valor_novo)
    values (p_cliente_id, 'dados_editados', 'Dados cadastrais atualizados', v_admin_nome, v_admin_id, 'endereco_rua', v_old.endereco_rua, p_endereco_rua);
  end if;
  if v_old.endereco_numero is distinct from p_endereco_numero then
    insert into public.eventos_cliente (cliente_id, tipo, descricao, ator, ator_admin_id, campo, valor_anterior, valor_novo)
    values (p_cliente_id, 'dados_editados', 'Dados cadastrais atualizados', v_admin_nome, v_admin_id, 'endereco_numero', v_old.endereco_numero, p_endereco_numero);
  end if;
  if v_old.endereco_complemento is distinct from v_novo_complemento then
    insert into public.eventos_cliente (cliente_id, tipo, descricao, ator, ator_admin_id, campo, valor_anterior, valor_novo)
    values (p_cliente_id, 'dados_editados', 'Dados cadastrais atualizados', v_admin_nome, v_admin_id, 'endereco_complemento', v_old.endereco_complemento, v_novo_complemento);
  end if;
  if v_old.endereco_bairro is distinct from p_endereco_bairro then
    insert into public.eventos_cliente (cliente_id, tipo, descricao, ator, ator_admin_id, campo, valor_anterior, valor_novo)
    values (p_cliente_id, 'dados_editados', 'Dados cadastrais atualizados', v_admin_nome, v_admin_id, 'endereco_bairro', v_old.endereco_bairro, p_endereco_bairro);
  end if;
  if v_old.endereco_cidade is distinct from p_endereco_cidade then
    insert into public.eventos_cliente (cliente_id, tipo, descricao, ator, ator_admin_id, campo, valor_anterior, valor_novo)
    values (p_cliente_id, 'dados_editados', 'Dados cadastrais atualizados', v_admin_nome, v_admin_id, 'endereco_cidade', v_old.endereco_cidade, p_endereco_cidade);
  end if;
  if v_old.endereco_estado is distinct from v_novo_estado then
    insert into public.eventos_cliente (cliente_id, tipo, descricao, ator, ator_admin_id, campo, valor_anterior, valor_novo)
    values (p_cliente_id, 'dados_editados', 'Dados cadastrais atualizados', v_admin_nome, v_admin_id, 'endereco_estado', v_old.endereco_estado, v_novo_estado);
  end if;
end;
$$;

revoke all on function public.admin_atualizar_cliente(uuid, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text) from public;
revoke execute on function public.admin_atualizar_cliente(uuid, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text) from anon;
grant execute on function public.admin_atualizar_cliente(uuid, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text) to authenticated;

-- admin_definir_status_cliente: agora grava o evento ela mesma.
create or replace function public.admin_definir_status_cliente(p_cliente_id uuid, p_novo_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_admin_id uuid;
  v_admin_nome text;
begin
  if not public.is_admin() then
    raise exception 'Apenas administradores podem alterar status de clientes';
  end if;
  if p_novo_status not in ('ativo', 'inativo') then
    raise exception 'Status inválido: %', p_novo_status;
  end if;

  select user_id into v_user_id from public.clientes where id = p_cliente_id;
  if v_user_id is null then
    raise exception 'Cliente não encontrado';
  end if;

  select a.id, u.nome into v_admin_id, v_admin_nome
  from public.administradores a join public.users u on u.id = a.user_id
  where u.auth_user_id = auth.uid();

  update public.users
     set status = p_novo_status, updated_at = now()
   where id = v_user_id;

  insert into public.eventos_cliente (cliente_id, tipo, descricao, ator, ator_admin_id)
  values (p_cliente_id, 'status_alterado', 'Status alterado para ' || (case when p_novo_status = 'ativo' then 'Ativo' else 'Inativo' end), v_admin_nome, v_admin_id);
end;
$$;

revoke all on function public.admin_definir_status_cliente(uuid, text) from public;
revoke execute on function public.admin_definir_status_cliente(uuid, text) from anon;
grant execute on function public.admin_definir_status_cliente(uuid, text) to authenticated;

-- ---------- 14) Retenção de 90 dias em eventos_cliente ----------
-- Escopada estritamente a eventos_cliente (log interno de auditoria do
-- painel) — nunca clientes/documentos/boletos, que continuam pra sempre.
-- Não há exigência legal/contábil conhecida que obrigue guardar esse log
-- específico por mais tempo (não é documento fiscal, é histórico de
-- alterações no cadastro dentro do painel).
create extension if not exists pg_cron;

create or replace function public.limpar_eventos_cliente_antigos()
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.eventos_cliente where created_at < now() - interval '90 days';
$$;
-- Roda só via pg_cron, nunca via PostgREST.
revoke all on function public.limpar_eventos_cliente_antigos() from public;
revoke execute on function public.limpar_eventos_cliente_antigos() from anon;
revoke execute on function public.limpar_eventos_cliente_antigos() from authenticated;

select cron.schedule(
  'limpar-eventos-cliente-antigos',
  '0 3 * * *',
  $$select public.limpar_eventos_cliente_antigos()$$
);

-- ---------- 15) Auditoria real do status do boleto ----------
-- Marcar um boleto como pago/não pago era um UPDATE direto do navegador,
-- sem nenhum registro de quem fez. Nível "leve" confirmado: só a última
-- troca (quem + quando), mesmo padrão de revisado_por/revisado_em.
alter table documentos
  add column if not exists status_alterado_por uuid references administradores(id) on delete set null,
  add column if not exists status_alterado_em timestamptz;
create index if not exists idx_documentos_status_alterado_por on documentos(status_alterado_por);

-- Fecha a fresta real encontrada na investigação: o gatilho já garantia
-- data_vencimento/status nulos em categoria não-boleto, mas não garantia
-- valor nulo (nem as 2 colunas novas acima).
create or replace function public.enforce_boleto_vencimento()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_categoria_nome text;
  v_eh_boleto boolean;
begin
  select nome, eh_boleto into v_categoria_nome, v_eh_boleto
  from public.categorias where id = new.categoria_id;

  if v_eh_boleto then
    if new.data_vencimento is null then
      raise exception 'Boletos (categoria %) precisam de data_vencimento', v_categoria_nome;
    end if;
    if new.status is null or new.status not in ('pago', 'nao_pago') then
      raise exception 'Boletos (categoria %) precisam de status "pago" ou "nao_pago"', v_categoria_nome;
    end if;
    -- Bug real encontrado auditando o fluxo ponta a ponta (2026-08-13):
    -- valor nunca foi exigido aqui, então um boleto podia ser gravado com
    -- valor NULL — o documento existia e aparecia na lista, mas
    -- Number(null)||0 no front fazia ele valer 0 em toda soma, sumindo dos
    -- KPIs sem erro nenhum avisando ninguém.
    if new.valor is null or new.valor <= 0 then
      raise exception 'Boletos (categoria %) precisam de um valor maior que zero', v_categoria_nome;
    end if;
  else
    if new.data_vencimento is not null then
      raise exception 'Documentos da categoria % não podem ter data_vencimento (só boletos têm vencimento)', v_categoria_nome;
    end if;
    if new.status is not null then
      raise exception 'Documentos da categoria % não podem ter status de pagamento (só boletos têm)', v_categoria_nome;
    end if;
    if new.valor is not null then
      raise exception 'Documentos da categoria % não podem ter valor (só boletos têm valor financeiro)', v_categoria_nome;
    end if;
    if new.status_alterado_por is not null or new.status_alterado_em is not null then
      raise exception 'Documentos da categoria % não podem ter alteração de status de pagamento', v_categoria_nome;
    end if;
  end if;

  return new;
end;
$$;

-- admin_definir_status_boleto: mesmo esqueleto de admin_definir_status_cliente.
create or replace function public.admin_definir_status_boleto(p_documento_id uuid, p_novo_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_eh_boleto boolean;
  v_admin_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Apenas administradores podem alterar status de boleto';
  end if;
  if p_novo_status not in ('pago', 'nao_pago') then
    raise exception 'Status inválido: %', p_novo_status;
  end if;

  select c.eh_boleto into v_eh_boleto
  from public.documentos d join public.categorias c on c.id = d.categoria_id
  where d.id = p_documento_id;
  if v_eh_boleto is null then
    raise exception 'Documento não encontrado';
  end if;
  if not v_eh_boleto then
    raise exception 'Documento não é um boleto';
  end if;

  select a.id into v_admin_id
  from public.administradores a join public.users u on u.id = a.user_id
  where u.auth_user_id = auth.uid();

  update public.documentos
     set status = p_novo_status,
         pago_em = case when p_novo_status = 'pago' then now() else null end,
         status_alterado_por = v_admin_id,
         status_alterado_em = now()
   where id = p_documento_id;
end;
$$;

revoke all on function public.admin_definir_status_boleto(uuid, text) from public;
revoke execute on function public.admin_definir_status_boleto(uuid, text) from anon;

-- ---------- categorias.tipo_financeiro ----------
-- Raiz de um bug real: "Receita mensal" e "Impostos pagos" (Visão geral +
-- Financeiro) identificavam a categoria certa comparando o SLUG fixo
-- ("boleto-honorarios" / "boleto-imposto") em vez de um dado estrutural.
-- Uma 3ª categoria de boleto criada pela Lorena (eh_boleto=true) nunca
-- entrava em nenhum dos dois KPIs porque nenhum slug hardcoded batia com
-- ela. eh_boleto sozinho não resolve: diz "isso tem valor/vencimento/
-- status", mas não diz se esse dinheiro é receita do escritório ou imposto
-- pago em nome do cliente — são buckets contábeis diferentes, não dá pra
-- inferir automaticamente.
alter table categorias add column if not exists tipo_financeiro text;

alter table categorias
  add constraint categorias_tipo_financeiro_valido
  check (tipo_financeiro is null or tipo_financeiro in ('receita', 'imposto'));

update categorias set tipo_financeiro = 'receita' where slug = 'boleto-honorarios';
update categorias set tipo_financeiro = 'imposto' where slug = 'boleto-imposto';

-- Falha fechado: se eh_boleto=true, tipo_financeiro é obrigatório — nunca
-- mais dá pra criar/editar uma categoria de boleto "muda" (sem dizer se é
-- receita ou imposto) e ela silenciosamente não aparecer em KPI nenhum.
alter table categorias
  add constraint categorias_boleto_exige_tipo_financeiro
  check (not eh_boleto or tipo_financeiro is not null);
grant execute on function public.admin_definir_status_boleto(uuid, text) to authenticated;

-- ---------- categorias.tamanho_maximo_mb: remove o limite obrigatório ----------
-- Pedido explícito: a Lorena achou que um limite de tamanho de arquivo por
-- categoria atrapalhava a experiência do usuário — quer deixar ilimitado.
-- O gatilho validar_arquivo_documento() já tratava tamanho_maximo_mb IS NULL
-- como "sem limite" (só o tipo de arquivo aceito continuava validado); só
-- faltava a coluna permitir NULL. Todas as categorias existentes (não só as
-- novas) ficam sem limite.
alter table categorias alter column tamanho_maximo_mb drop not null;
alter table categorias alter column tamanho_maximo_mb drop default;
update categorias set tamanho_maximo_mb = null;
