# Deployment Guide (Vercel + Supabase)

## 1) Vercel project setup

1. Import this repo into Vercel.
2. Framework preset: **Next.js**.
3. Root directory: repository root (`/`).
4. Build command: `npm run build` (already in `vercel.json`).
5. Install command: `npm install`.

## 2) Environment variables (Vercel)

Add these in **Project Settings -> Environment Variables** for Preview + Production:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `NEXT_PUBLIC_APP_URL` (production domain)
- `SUPABASE_SERVICE_ROLE_KEY` (server only)
- `INTEGRATION_API_KEY` (optional, recommended for external API access)
- `NEXT_TELEMETRY_DISABLED=1` (optional)

Use `.env.production.example` as the template.

## 3) Supabase production setup checklist

### Database and auth

- Create a dedicated production Supabase project.
- Apply migrations (see section 4).
- Ensure Auth provider settings are production-ready.
- Add redirect URLs:
  - `https://<your-domain>/login`
  - any additional callback URLs you use.

### Security

- Keep `SUPABASE_SERVICE_ROLE_KEY` only in server environments.
- Do not expose service-role keys in browser code.
- Enable/verify RLS policies for production tables.
- Rotate `INTEGRATION_API_KEY` periodically if enabled.

### Realtime

Enable replication/publication for:

- `public.orders`
- `public.order_items`

Without this, POS/Kitchen/Dashboard realtime listeners will not receive updates.

## 4) Database migration scripts

This repo includes `scripts/run-migrations-prod.sh`, which applies SQL in deployment order.

### Run migrations

```bash
export DATABASE_URL='postgresql://<user>:<pass>@<host>:5432/postgres?sslmode=require'
npm run migrate:prod
```

### What it runs

1. `sql/production_pos_schema.sql`
2. `supabase/phase1_pos_schema_compat.sql`
3. `supabase/phase1_1_workflow.sql`
4. `supabase/phase1_2_operations.sql`
5. `sql/performance_indexes.sql` (orders/payments/order_items indexes)
6. `sql/accounting_audit.sql` (audit table + trigger/service logging)
7. `sql/pos_rpc_functions.sql`
8. `sql/multi_branch_roles.sql`
9. `sql/security_rls_audit.sql` (RLS + branch isolation + audit logs)

## 5) Pre-deploy verification

Run locally (or CI) before promoting:

```bash
npm run deploy:check
```

Then verify in Vercel Preview:

- Login and role-gated routes
- QR order -> kitchen -> payment -> dashboard
- `/api/v1/health`
- realtime behavior across tabs/screens

