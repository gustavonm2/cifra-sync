-- =====================================================================
-- Cifra Sync — biblioteca na nuvem (músicas, estilos, playlists, andamento)
--
-- Como aplicar: Supabase → SQL Editor → New query → cole este arquivo → Run.
-- É seguro rodar de novo (usa IF NOT EXISTS / CREATE OR REPLACE).
-- Se a tabela songs já existia sem a coluna `simplified`, o ALTER abaixo a cria.
--
-- Acesso sem login: cada biblioteca tem um CÓDIGO SECRETO (UUID) gerado no
-- aparelho e enviado no cabeçalho `x-library-id`. O banco (RLS) só entrega e
-- só aceita linhas cujo library_id é igual a esse código. Quem não souber o
-- código não lista nem altera nada. Não é uma conta: quem tiver o código entra.
-- =====================================================================

-- Código da biblioteca da requisição (cabeçalho x-library-id) ou NULL se ausente/inválido.
create or replace function public.current_library()
returns uuid
language sql
stable
set search_path = ''
as $$
  select case
    when h ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then h::uuid
    else null
  end
  from (
    select (nullif(pg_catalog.current_setting('request.headers', true), '')::json ->> 'x-library-id') as h
  ) t
$$;

-- ---------- músicas ----------
create table if not exists public.songs (
  id          uuid primary key,
  library_id  uuid not null,
  title       text not null default ''  check (char_length(title)  <= 200),
  artist      text not null default ''  check (char_length(artist) <= 200),
  genre       text not null default ''  check (char_length(genre)  <= 60),   -- estilo: Sertanejo, MPB, Rock…
  text        text not null default ''  check (char_length(text)   <= 100000), -- cifra + letra, como colada
  transpose   smallint not null default 0 check (transpose between -11 and 11),
  speed       numeric(5,2) not null default 2.5 check (speed between 0.25 and 10), -- segundos por acorde
  simplified  boolean not null default false,                                    -- acordes simplificados (tríades do campo harmônico)
  holds       jsonb not null default '{}'::jsonb check (jsonb_typeof(holds) = 'object'), -- { "índice do acorde": multiplicador }
  timing      jsonb check (timing is null or jsonb_typeof(timing) = 'object'),      -- andamento gravado: { base, durations: [s|null…] }
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  unique (library_id, id)
);

-- ---------- playlists ----------
create table if not exists public.playlists (
  id          uuid primary key,
  library_id  uuid not null,
  name        text not null check (char_length(name) between 1 and 100),
  genre       text not null default '' check (char_length(genre) <= 60),
  song_ids    uuid[] not null default '{}'::uuid[] check (coalesce(array_length(song_ids, 1), 0) <= 500), -- músicas, em ordem
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  unique (library_id, id)
);

alter table public.songs add column if not exists simplified boolean not null default false;

create index if not exists songs_library_updated_idx     on public.songs     (library_id, updated_at);
create index if not exists playlists_library_updated_idx on public.playlists (library_id, updated_at);

-- ---------- atualiza updated_at e impede trocar de biblioteca ----------
create or replace function public.touch_row()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := pg_catalog.now();
  new.library_id := old.library_id;
  new.created_at := old.created_at;
  return new;
end;
$$;

drop trigger if exists songs_touch on public.songs;
create trigger songs_touch before update on public.songs
  for each row execute function public.touch_row();

drop trigger if exists playlists_touch on public.playlists;
create trigger playlists_touch before update on public.playlists
  for each row execute function public.touch_row();

-- ---------- segurança por linha ----------
alter table public.songs     enable row level security;
alter table public.playlists enable row level security;

drop policy if exists songs_by_library on public.songs;
create policy songs_by_library on public.songs
  for all to anon, authenticated
  using      (library_id = (select public.current_library()))
  with check (library_id = (select public.current_library()));

drop policy if exists playlists_by_library on public.playlists;
create policy playlists_by_library on public.playlists
  for all to anon, authenticated
  using      (library_id = (select public.current_library()))
  with check (library_id = (select public.current_library()));

grant select, insert, update, delete on public.songs, public.playlists to anon, authenticated;
