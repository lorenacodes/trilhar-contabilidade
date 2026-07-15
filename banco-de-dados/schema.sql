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
