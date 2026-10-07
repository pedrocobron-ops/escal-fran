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

create or replace function public.escala_put(p_codigo text, p_data jsonb)
returns timestamptz
language plpgsql security definer set search_path = escala_ceo, public as $$
declare ts timestamptz;
begin
  if p_codigo is null or length(p_codigo) < 8 then
    raise exception 'codigo invalido';
  end if;
  if pg_column_size(p_data) > 8 * 1024 * 1024 then
    raise exception 'escala grande demais';
  end if;
  insert into escala_ceo.escalas (codigo, data, updated_at) values (p_codigo, p_data, now())
  on conflict (codigo) do update set data = excluded.data, updated_at = now()
  returning updated_at into ts;
  return ts;
end;
$$;

revoke all on function public.escala_get(text) from public;
revoke all on function public.escala_version(text) from public;
revoke all on function public.escala_put(text, jsonb) from public;
grant execute on function public.escala_get(text) to anon;
grant execute on function public.escala_version(text) to anon;
grant execute on function public.escala_put(text, jsonb) to anon;
