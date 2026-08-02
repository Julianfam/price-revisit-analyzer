-- Trial → subscription state (per authenticated user).

create table if not exists user_subscriptions (
  user_id text primary key,
  plan text not null default 'free',
  status text not null default 'none',
  trial_started_at bigint,
  trial_ends_at bigint,
  pro_started_at bigint,
  pro_ends_at bigint,
  analyses_today int not null default 0,
  analyses_day text,
  updated_at timestamptz not null default now()
);

create index if not exists user_subscriptions_status_idx
  on user_subscriptions (status);
