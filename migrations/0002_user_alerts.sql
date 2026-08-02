-- Per-user price alerts + settings for Price Revisit Analyzer.
-- user_id is TEXT (Better Auth ids / 'dev-user'), not UUID.

create table if not exists user_price_alerts (
  id text primary key,
  user_id text not null,
  symbol text not null,
  yahoo_symbol text not null,
  target_price double precision not null,
  tick double precision not null,
  entry_price double precision not null,
  created_at bigint not null,
  active boolean not null default true,
  hit_at bigint,
  hit_price double precision,
  live_price double precision,
  live_at bigint,
  needs_leave_first boolean not null default false,
  has_left_target boolean not null default false,
  updated_at timestamptz not null default now()
);

create index if not exists user_price_alerts_user_idx
  on user_price_alerts (user_id);

create index if not exists user_price_alerts_user_active_idx
  on user_price_alerts (user_id, active);

create table if not exists user_settings (
  user_id text primary key,
  lang text not null default 'es',
  last_symbol text,
  last_interval text,
  last_range text,
  last_window text,
  updated_at timestamptz not null default now()
);
