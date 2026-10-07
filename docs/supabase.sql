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
