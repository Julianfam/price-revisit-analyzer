# Price Revisit Analyzer

Trading analyzer: price revisit stats, probabilistic scenarios, alerts, Quantum Agent, freemium.

## Deploy (Vercel)

1. Connect this repo to Vercel (or `vercel deploy`).
2. Set env vars from `.env.example` (especially `DATABASE_URL` for Postgres alert sync).
3. Build: `npm run build` (Nitro → Vercel preset).

## Local

```bash
npm install
npm run dev
```

App binds `0.0.0.0:8080`.
