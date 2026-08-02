-- Multi-device cloud identity for production Postgres (Neon)
alter table if exists user_price_alerts
  add column if not exists account_key text;

create index if not exists user_price_alerts_account_key_idx
  on user_price_alerts (account_key);

create index if not exists user_price_alerts_user_id_idx
  on user_price_alerts (user_id);
