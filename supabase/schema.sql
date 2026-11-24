-- Hamerslag: database. Plak dit in Supabase → SQL Editor → Run.
-- Alleen ingelogde gebruikers (jij) mogen lezen. Alleen de motor (service key) schrijft.

create table if not exists traders (
  id text primary key,
  name text not null,
  role text,
  style text,
  look jsonb,
  active boolean default true,
  joined_at timestamptz default now(),
  left_at timestamptz,
  left_reason text,
  goed int default 0,
  fout int default 0,
  voor int default 0,
  tegen int default 0,
  bronnen int default 0,
  model text default 'haiku'   -- haiku | sonnet | opus | fable: het brein waarmee deze trader stemt
);
alter table traders add column if not exists model text default 'haiku';
alter table traders add column if not exists geschrapt int default 0;  -- bijdragen geschrapt door de bronnencheck

create table if not exists rounds (
  id bigserial primary key,
  no int,
  started_at timestamptz default now(),
  finished_at timestamptz,
  status text,            -- bezig | klaar | fout
  phase text,             -- analyse | voorstel | debat | stemming | klaar | fout
  proposal jsonb,
  outcome text,           -- UITGEVOERD | AFGEWEZEN | HUISREGEL | GEEN VOORSTEL
  votes_for int,
  trade jsonb,
  spoed jsonb,            -- gevuld bij een spoedzitting (nieuwsreflex)
  error text
);
alter table rounds add column if not exists spoed jsonb;
alter table rounds add column if not exists aanleiding jsonb;  -- waarom deze zitting begon (zittingscheck)

create table if not exists sources (
  round_id bigint references rounds(id) on delete cascade,
  id text,
  kind text,
  publisher text,
  title text,
  url text,
  published_at timestamptz,
  data jsonb,
  primary key (round_id, id)
);

create table if not exists messages (
  id bigserial primary key,
  round_id bigint references rounds(id) on delete cascade,
  seq int,
  phase text,             -- systeem | voorstel | debat | stem | uitslag
  trader_id text,
  text text,
  sources text[] default '{}',
  action jsonb,
  created_at timestamptz default now()
);
create index if not exists messages_round on messages(round_id, seq);

create table if not exists trades (
  id bigserial primary key,
  round_id bigint references rounds(id) on delete set null,
  t timestamptz default now(),
  actie text, asset text,
  bedrag numeric, prijs numeric, qty numeric, fee numeric,
  votes_for int
);

create table if not exists snapshots (
  t timestamptz primary key default now(),
  value numeric, cash numeric, bench numeric
);

create table if not exists market (
  symbol text primary key,
  name text, kind text,
  price numeric, chg1h numeric, chg24h numeric, chg7d numeric,
  rsi numeric, trend text, rank int,
  source text, url text,
  updated_at timestamptz,
  history jsonb
);
alter table market add column if not exists rank int;
alter table market add column if not exists cat text;   -- vastgoed, obligatie, grondstof, europa, ...

create table if not exists voorzittingen (   -- elk uur: de uurcheck en (als er iets gebeurt) de voorzitting
  id bigserial primary key,
  t timestamptz default now(),
  aanleiding jsonb,        -- wat er gebeurde (koers, nieuws, vangnet, beurs open, stilte)
  kansen jsonb,            -- kansen met score 1-10 volgens de voorzitter en de agendacommissie
  besluit text,            -- RUSTIG | GEEN_ZITTING | ZITTING
  reden text,
  model text               -- met welk AI-model de voorzitting besliste
);
alter table voorzittingen add column if not exists model text;

create table if not exists headlines (
  id bigserial primary key,
  round_id bigint references rounds(id) on delete set null,
  title text, publisher text, url text unique,
  published_at timestamptz, category text, importance int default 0
);

create table if not exists state (
  id int primary key default 1,
  cash numeric,
  positions jsonb default '{}',
  start_value numeric,
  bench jsonb,
  started_at timestamptz,
  pending jsonb default '[]',
  last_rotation text,
  updated_at timestamptz default now()
);
alter table state add column if not exists data jsonb;   -- de hele toestand van de motor (cash, posities, kosten, dividendpot, ...)

-- Beveiliging: lezen alleen voor ingelogde gebruikers
do $$
declare t text;
begin
  foreach t in array array['traders','rounds','sources','messages','trades','snapshots','market','headlines','state','voorzittingen'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "lezen ingelogd" on %I', t);
    execute format('create policy "lezen ingelogd" on %I for select to authenticated using (true)', t);
  end loop;
end $$;

-- Rechten (nieuwe Supabase-projecten geven tabellen niet meer automatisch vrij aan de API):
-- de motor (service_role) mag alles, ingelogde gebruikers (de app) alleen lezen, anonieme bezoekers niets.
grant usage on schema public to authenticated, service_role;
grant select on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

-- Live meekijken: de app krijgt nieuwe berichten en rondes direct binnen
do $$
begin
  begin alter publication supabase_realtime add table messages; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table rounds; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table market; exception when duplicate_object then null; end;
end $$;

-- Vragen van de eigenaar aan de zaal ("moeten we in goud investeren?").
-- De app (ingelogd) mag een vraag toevoegen en lezen; de motor (service_role) pakt hem op.
create table if not exists verzoeken (
  id bigint generated always as identity primary key,
  t timestamptz not null default now(),
  vraag text not null check (char_length(vraag) between 3 and 300),
  status text not null default 'wacht' check (status in ('wacht','gestart','klaar','fout','geweigerd')),
  assets text[],
  reden text,
  round_no int,
  uitkomst text,
  behandeld_at timestamptz
);
alter table verzoeken enable row level security;
drop policy if exists "verzoeken lezen" on verzoeken;
create policy "verzoeken lezen" on verzoeken for select to authenticated using (true);
drop policy if exists "verzoeken toevoegen" on verzoeken;
create policy "verzoeken toevoegen" on verzoeken for insert to authenticated with check (status = 'wacht' and round_no is null and behandeld_at is null);
grant select, insert on verzoeken to authenticated;
grant all on verzoeken to service_role;
