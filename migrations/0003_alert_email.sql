-- Email subscription for price-alert hits + delivery outbox.

alter table user_settings
  add column if not exists alert_email text,
  add column if not exists email_alerts_enabled boolean not null default false;

create table if not exists alert_email_outbox (
  id text primary key,
  email text not null,
  user_id text,
  symbol text not null,
  target_price double precision not null,
  hit_price double precision,
  hit_at bigint not null,
  subject text not null,
  body text not null,
  status text not null default 'queued',
  created_at timestamptz not null default now()
);

create index if not exists alert_email_outbox_email_idx
  on alert_email_outbox (email, created_at desc);
