-- Players are a nickname plus a secret token kept on their device.
create table players (
  id uuid primary key default gen_random_uuid(),
  nickname text not null,
  secret_hash text not null,
  created_at timestamptz not null default now(),
  total_metres double precision not null default 0,
  total_deaths integer not null default 0,
  total_clears integer not null default 0,
  total_attempts integer not null default 0
);
create unique index players_nickname_key on players (lower(nickname));

-- One play-through in one mode. The server is the source of truth for level,
-- lives and lives used; the game syncs to it.
create table runs (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references players (id) on delete cascade,
  mode text not null check (mode in ('survival', 'marathon')),
  version text not null,                       -- level generator version (js/levels.js VERSION)
  status text not null default 'active' check (status in ('active', 'over', 'won', 'abandoned')),
  level integer not null default 1 check (level between 1 and 100),
  lives integer not null default 3,            -- survival only
  lives_used integer not null default 0,       -- marathon score
  metres double precision not null default 0,
  ticks bigint not null default 0,             -- verified play time, in 1/240 s
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  ended_at timestamptz
);
create index runs_board_idx on runs (mode, version, status);
create index runs_player_idx on runs (player_id, mode, status);

-- One try at one level. The hop inputs are kept so any result can be re-checked.
create table attempts (
  id bigserial primary key,
  run_id uuid not null references runs (id) on delete cascade,
  level integer not null,
  status text not null default 'open' check (status in ('open', 'clear', 'death', 'quit', 'abandoned')),
  verified boolean,                            -- false: claimed a clear the replay didn't reproduce
  lenient boolean not null default false,      -- clear only reproduced with hazards shrunk slightly
  lane0 integer,
  inputs jsonb,
  end_tick integer,
  metres double precision,
  cause text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
create index attempts_run_idx on attempts (run_id, id);

-- Running totals per level, for the toughest-levels board.
create table level_stats (
  version text not null,
  level integer not null,
  attempts bigint not null default 0,
  deaths bigint not null default 0,
  clears bigint not null default 0,
  primary key (version, level)
);
