-- Escala CEO: sincronização entre aparelhos (Supabase).
-- Os dados ficam no schema escala_ceo (um schema por cliente dentro do projeto
-- "clientes-basicos"). O app só acessa pelas três funções abaixo, no schema public,
-- com a chave pública (anon): ninguém lista nem lê a tabela sem saber o código.

create schema if not exists escala_ceo;
revoke all on schema escala_ceo from anon, authenticated;

create table if not exists escala_ceo.escalas (
  codigo text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table escala_ceo.escalas enable row level security;
revoke all on table escala_ceo.escalas from anon, authenticated;

create or replace function public.escala_get(p_codigo text)
returns table (data jsonb, updated_at timestamptz)
language sql security definer set search_path = escala_ceo, public as $$
  select e.data, e.updated_at from escala_ceo.escalas e where e.codigo = p_codigo;
$$;

create or replace function public.escala_version(p_codigo text)
returns timestamptz
language sql security definer set search_path = escala_ceo, public as $$
  select e.updated_at from escala_ceo.escalas e where e.codigo = p_codigo;
$$;

-- Grava a escala. Com p_expected, só grava se a nuvem ainda estiver naquela versão
-- (senão devolve o erro "conflito", e o app pergunta à pessoa qual versão vale).
-- Limite de 50 códigos por schema: a chave pública é pública, e isso impede encher o banco.
drop function if exists public.escala_put(text, jsonb);
create or replace function public.escala_put(p_codigo text, p_data jsonb, p_expected timestamptz default null)
returns timestamptz
language plpgsql security definer set search_path = escala_ceo, public as $$
declare
  ts timestamptz;
  atual timestamptz;
begin
  if p_codigo is null or length(p_codigo) < 8 then
    raise exception 'codigo invalido';
  end if;
  if pg_column_size(p_data) > 8 * 1024 * 1024 then
    raise exception 'escala grande demais';
  end if;
  select e.updated_at into atual from escala_ceo.escalas e where e.codigo = p_codigo for update;
  if atual is null then
    if (select count(*) from escala_ceo.escalas) >= 50 then
      raise exception 'limite de escalas atingido';
    end if;
  elsif p_expected is not null and atual <> p_expected then
    raise exception 'conflito: a nuvem tem uma versao mais nova';
  end if;
  insert into escala_ceo.escalas (codigo, data, updated_at) values (p_codigo, p_data, now())
  on conflict (codigo) do update set data = excluded.data, updated_at = now()
  returning updated_at into ts;
  return ts;
end;
$$;

revoke all on function public.escala_get(text) from public;
revoke all on function public.escala_version(text) from public;
revoke all on function public.escala_put(text, jsonb, timestamptz) from public;
grant execute on function public.escala_get(text) to anon;
grant execute on function public.escala_version(text) to anon;
grant execute on function public.escala_put(text, jsonb, timestamptz) to anon;

-- ---------------------------------------------------------------------------
-- Cléo (assistente): contagem de chamadas por código e por dia.
-- A função roda só com a service role (dentro da Edge Function "cleo").
-- ---------------------------------------------------------------------------
create table if not exists escala_ceo.cleo_uso (
  codigo text not null,
  dia date not null,
  chamadas integer not null default 0,
  primary key (codigo, dia)
);
alter table escala_ceo.cleo_uso enable row level security;

create or replace function public.cleo_autoriza(p_codigo text, p_limite integer default 300)
returns jsonb
language plpgsql
security definer
set search_path = escala_ceo, public
as $$
declare
  v_n integer;
begin
  if not exists (select 1 from escala_ceo.escalas where codigo = p_codigo) then
    return jsonb_build_object('ok', false, 'motivo', 'codigo');
  end if;
  insert into escala_ceo.cleo_uso (codigo, dia, chamadas)
  values (p_codigo, current_date, 1)
  on conflict (codigo, dia) do update set chamadas = escala_ceo.cleo_uso.chamadas + 1
  returning chamadas into v_n;
  if v_n > p_limite then
    return jsonb_build_object('ok', false, 'motivo', 'limite', 'restantes', 0);
  end if;
  return jsonb_build_object('ok', true, 'restantes', p_limite - v_n);
end;
$$;

revoke all on function public.cleo_autoriza(text, integer) from public, anon, authenticated;
grant execute on function public.cleo_autoriza(text, integer) to service_role;

-- ---------------------------------------------------------------------------
-- Login (Supabase Auth): uma escala por conta. A linha da conta usa o código
-- 'user:<uuid>', que as funções antigas (por código) se recusam a tocar.
-- O cadastro aberto fica desligado no painel: só entram contas criadas lá.
-- ---------------------------------------------------------------------------
create or replace function public.escala_get(p_codigo text)
returns table (data jsonb, updated_at timestamptz)
language sql security definer set search_path = escala_ceo, public as $$
  select e.data, e.updated_at from escala_ceo.escalas e where e.codigo = p_codigo and e.codigo not like 'user:%';
$$;

create or replace function public.escala_version(p_codigo text)
returns timestamptz
language sql security definer set search_path = escala_ceo, public as $$
  select e.updated_at from escala_ceo.escalas e where e.codigo = p_codigo and e.codigo not like 'user:%';
$$;

create or replace function public.escala_put(p_codigo text, p_data jsonb, p_expected timestamptz default null)
returns timestamptz
language plpgsql security definer set search_path = escala_ceo, public as $$
declare
  ts timestamptz;
  atual timestamptz;
begin
  if p_codigo is null or length(p_codigo) < 8 or p_codigo like 'user:%' then
    raise exception 'codigo invalido';
  end if;
  if pg_column_size(p_data) > 8 * 1024 * 1024 then
    raise exception 'escala grande demais';
  end if;
  select e.updated_at into atual from escala_ceo.escalas e where e.codigo = p_codigo for update;
  if atual is null then
    if (select count(*) from escala_ceo.escalas) >= 50 then
      raise exception 'limite de escalas atingido';
    end if;
  elsif p_expected is not null and atual <> p_expected then
    raise exception 'conflito: a nuvem tem uma versao mais nova';
  end if;
  insert into escala_ceo.escalas (codigo, data, updated_at) values (p_codigo, p_data, now())
  on conflict (codigo) do update set data = excluded.data, updated_at = now()
  returning updated_at into ts;
  return ts;
end;
$$;

create or replace function public.minha_escala_get()
returns table (data jsonb, updated_at timestamptz)
language sql security definer set search_path = escala_ceo, public as $$
  select e.data, e.updated_at from escala_ceo.escalas e where auth.uid() is not null and e.codigo = 'user:' || auth.uid()::text;
$$;

create or replace function public.minha_escala_version()
returns timestamptz
language sql security definer set search_path = escala_ceo, public as $$
  select e.updated_at from escala_ceo.escalas e where auth.uid() is not null and e.codigo = 'user:' || auth.uid()::text;
$$;

create or replace function public.minha_escala_put(p_data jsonb, p_expected timestamptz default null)
returns timestamptz
language plpgsql security definer set search_path = escala_ceo, public as $$
declare
  ts timestamptz;
  atual timestamptz;
  chave text;
begin
  if auth.uid() is null then
    raise exception 'sem login';
  end if;
  if pg_column_size(p_data) > 8 * 1024 * 1024 then
    raise exception 'escala grande demais';
  end if;
  chave := 'user:' || auth.uid()::text;
  select e.updated_at into atual from escala_ceo.escalas e where e.codigo = chave for update;
  if atual is not null and p_expected is not null and atual <> p_expected then
    raise exception 'conflito: a nuvem tem uma versao mais nova';
  end if;
  insert into escala_ceo.escalas (codigo, data, updated_at) values (chave, p_data, now())
  on conflict (codigo) do update set data = excluded.data, updated_at = now()
  returning updated_at into ts;
  return ts;
end;
$$;

-- Traz a escala de um código antigo para a conta, quando a conta ainda não tem escala.
-- O código continua existindo (nada é apagado). Devolve o updated_at da conta, ou null
-- se o código não existe.
create or replace function public.minha_escala_importar_codigo(p_codigo text)
returns timestamptz
language plpgsql security definer set search_path = escala_ceo, public as $$
declare
  ts timestamptz;
  chave text;
  origem escala_ceo.escalas%rowtype;
begin
  if auth.uid() is null then
    raise exception 'sem login';
  end if;
  if p_codigo is null or p_codigo like 'user:%' then
    return null;
  end if;
  select * into origem from escala_ceo.escalas e where e.codigo = p_codigo;
  if origem.codigo is null then
    return null;
  end if;
  chave := 'user:' || auth.uid()::text;
  if exists (select 1 from escala_ceo.escalas e where e.codigo = chave) then
    select e.updated_at into ts from escala_ceo.escalas e where e.codigo = chave;
    return ts;
  end if;
  insert into escala_ceo.escalas (codigo, data, updated_at) values (chave, origem.data, now())
  returning updated_at into ts;
  return ts;
end;
$$;

revoke all on function public.minha_escala_get() from public, anon;
revoke all on function public.minha_escala_version() from public, anon;
revoke all on function public.minha_escala_put(jsonb, timestamptz) from public, anon;
revoke all on function public.minha_escala_importar_codigo(text) from public, anon;
grant execute on function public.minha_escala_get() to authenticated;
grant execute on function public.minha_escala_version() to authenticated;
grant execute on function public.minha_escala_put(jsonb, timestamptz) to authenticated;
grant execute on function public.minha_escala_importar_codigo(text) to authenticated;

-- Cléo por conta: limite diário por usuário e a conversa guardada na conta.
create or replace function public.cleo_autoriza_usuario(p_user uuid, p_limite integer default 300)
returns jsonb
language plpgsql security definer set search_path = escala_ceo, public as $$
declare
  v_n integer;
begin
  if p_user is null then
    return jsonb_build_object('ok', false, 'motivo', 'login');
  end if;
  insert into escala_ceo.cleo_uso (codigo, dia, chamadas)
  values ('user:' || p_user::text, current_date, 1)
  on conflict (codigo, dia) do update set chamadas = escala_ceo.cleo_uso.chamadas + 1
  returning chamadas into v_n;
  if v_n > p_limite then
    return jsonb_build_object('ok', false, 'motivo', 'limite', 'restantes', 0);
  end if;
  return jsonb_build_object('ok', true, 'restantes', p_limite - v_n);
end;
$$;
revoke all on function public.cleo_autoriza_usuario(uuid, integer) from public, anon, authenticated;
grant execute on function public.cleo_autoriza_usuario(uuid, integer) to service_role;

create table if not exists escala_ceo.cleo_conversas (
  user_id uuid primary key references auth.users (id) on delete cascade,
  messages jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);
alter table escala_ceo.cleo_conversas enable row level security;

create or replace function public.cleo_conversa_get()
returns jsonb
language sql security definer set search_path = escala_ceo, public as $$
  select c.messages from escala_ceo.cleo_conversas c where auth.uid() is not null and c.user_id = auth.uid();
$$;

create or replace function public.cleo_conversa_put(p_messages jsonb)
returns void
language plpgsql security definer set search_path = escala_ceo, public as $$
begin
  if auth.uid() is null then
    raise exception 'sem login';
  end if;
  if pg_column_size(p_messages) > 512 * 1024 then
    raise exception 'conversa grande demais';
  end if;
  insert into escala_ceo.cleo_conversas (user_id, messages, updated_at) values (auth.uid(), p_messages, now())
  on conflict (user_id) do update set messages = excluded.messages, updated_at = now();
end;
$$;
revoke all on function public.cleo_conversa_get() from public, anon;
revoke all on function public.cleo_conversa_put(jsonb) from public, anon;
grant execute on function public.cleo_conversa_get() to authenticated;
grant execute on function public.cleo_conversa_put(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Manter o projeto gratuito ativo: o workflow keepalive grava aqui todo dia.
-- ---------------------------------------------------------------------------
create table if not exists escala_ceo.manter_ativo (
  id integer primary key default 1,
  em timestamptz not null default now(),
  vezes bigint not null default 0
);
alter table escala_ceo.manter_ativo enable row level security;

create or replace function public.manter_ativo()
returns timestamptz
language sql security definer set search_path = escala_ceo, public as $$
  insert into escala_ceo.manter_ativo (id, em, vezes) values (1, now(), 1)
  on conflict (id) do update set em = now(), vezes = escala_ceo.manter_ativo.vezes + 1
  returning em;
$$;
revoke all on function public.manter_ativo() from public;
grant execute on function public.manter_ativo() to anon;

-- ---------------------------------------------------------------------------
-- 27/10/2026, depois da perda de dados: histórico de versões e gravação segura.
-- Toda gravação guarda a versão anterior em escala_ceo.escalas_versoes, e
-- minha_escala_put só substitui uma escala existente se disser qual versão
-- está substituindo (senão "conflito": o app pergunta qual vale).
-- ---------------------------------------------------------------------------
create table if not exists escala_ceo.escalas_versoes (
  id bigserial primary key,
  codigo text not null,
  data jsonb not null,
  updated_at timestamptz not null,
  guardada_em timestamptz not null default now()
);
create index if not exists escalas_versoes_codigo on escala_ceo.escalas_versoes (codigo, guardada_em desc);
alter table escala_ceo.escalas_versoes enable row level security;

create or replace function escala_ceo.guarda_versao() returns trigger
language plpgsql security definer set search_path = escala_ceo, public as $$
begin
  if old.data is distinct from new.data then
    insert into escala_ceo.escalas_versoes (codigo, data, updated_at) values (old.codigo, old.data, old.updated_at);
  end if;
  return new;
end;
$$;
create or replace trigger guarda_versao before update on escala_ceo.escalas for each row execute function escala_ceo.guarda_versao();

create or replace function public.minha_escala_put(p_data jsonb, p_expected timestamptz default null)
returns timestamptz
language plpgsql security definer set search_path = escala_ceo, public as $$
declare
  ts timestamptz;
  atual timestamptz;
  chave text;
begin
  if auth.uid() is null then
    raise exception 'sem login';
  end if;
  if pg_column_size(p_data) > 8 * 1024 * 1024 then
    raise exception 'escala grande demais';
  end if;
  chave := 'user:' || auth.uid()::text;
  select e.updated_at into atual from escala_ceo.escalas e where e.codigo = chave for update;
  if atual is not null and (p_expected is null or atual <> p_expected) then
    raise exception 'conflito: a nuvem tem uma versao mais nova';
  end if;
  insert into escala_ceo.escalas (codigo, data, updated_at) values (chave, p_data, now())
  on conflict (codigo) do update set data = excluded.data, updated_at = now()
  returning updated_at into ts;
  return ts;
end;
$$;

create or replace function public.minhas_versoes()
returns table (id bigint, updated_at timestamptz, guardada_em timestamptz, ausencias int, trocas int, extras int, semana int, dia int)
language sql security definer set search_path = escala_ceo, public as $$
  select v.id, v.updated_at, v.guardada_em,
    jsonb_array_length(coalesce(v.data->'absences','[]')), jsonb_array_length(coalesce(v.data->'shiftChanges','[]')),
    jsonb_array_length(coalesce(v.data->'extraShifts','[]')), jsonb_array_length(coalesce(v.data->'weekOverrides','[]')),
    jsonb_array_length(coalesce(v.data->'dayOverrides','[]'))
  from escala_ceo.escalas_versoes v
  where auth.uid() is not null and v.codigo = 'user:' || auth.uid()::text
  order by v.guardada_em desc limit 100;
$$;
create or replace function public.minha_versao(p_id bigint)
returns jsonb
language sql security definer set search_path = escala_ceo, public as $$
  select v.data from escala_ceo.escalas_versoes v where auth.uid() is not null and v.id = p_id and v.codigo = 'user:' || auth.uid()::text;
$$;
revoke all on function public.minhas_versoes() from public, anon;
revoke all on function public.minha_versao(bigint) from public, anon;
grant execute on function public.minhas_versoes() to authenticated;
grant execute on function public.minha_versao(bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- Backup diário fora do Supabase (workflow backup.yml): a escala sai criptografada
-- com esta chave pública. A chave privada fica fora do sistema (docs/BACKUP.md).
-- ---------------------------------------------------------------------------
create or replace function public.backup_cifrado()
returns text
language plpgsql security definer set search_path = escala_ceo, extensions, public as $$
declare
  conteudo jsonb;
begin
  perform public.manter_ativo();
  select jsonb_build_object(
    'gerado_em', now(),
    'escalas', coalesce(jsonb_agg(jsonb_build_object('conta', e.codigo, 'email', u.email, 'updated_at', e.updated_at, 'data', e.data) order by e.codigo), '[]'::jsonb)
  ) into conteudo
  from escala_ceo.escalas e
  left join auth.users u on e.codigo = 'user:' || u.id::text
  where e.codigo like 'user:%';
  return armor(pgp_pub_encrypt(conteudo::text, dearmor($k$
-----BEGIN PGP PUBLIC KEY BLOCK-----

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
AVb7iwUzXoDl+6lQngb7p1/qF2txYAiiYHg=
=MKN5
-----END PGP PUBLIC KEY BLOCK-----
$k$)));
end;
$$;
revoke all on function public.backup_cifrado() from public;
grant execute on function public.backup_cifrado() to anon;
