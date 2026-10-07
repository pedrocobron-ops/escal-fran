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
