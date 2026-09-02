# WiFi Voucher MVP

Reliable hosted SaaS for MikroTik hotspot owners to generate prepaid WiFi vouchers **remotely**.

**Core promise:** We only create vouchers when the router is reachable. Fail loudly. Never leave orphan codes.

## Gap we fill
- Cheaper & simpler than MikroTicket (~$13/mo)
- Fully hosted (no self-hosting like Mikhmon)
- Especially strong **remote access** handling for East African ISP conditions (dynamic IP, CGNAT risk)

## Tech stack
| Layer | Choice |
|-------|--------|
| Backend | Node.js + Fastify |
| Database + Auth | Supabase (Postgres + Auth) |
| Hosting | Render |
| Router API | Built-in minimal RouterOS client (zero extra deps) |
| Payments (MVP) | Cash only — manual admin toggle |

## Features in this MVP
1. Owner auth (Supabase)
2. Router connection + mandatory live test + one-click re-test
3. Profiles (time / data / both + optional code prefix)
4. Voucher generation (only if router reachable)
5. Export (screen + TXT + CSV + Print/PDF)
6. Soft daily limit (500/day)
7. Manual subscription management (cash)
8. Mobile-friendly dashboard

## Quick start

### 1. Supabase
1. Create a project at https://supabase.com
2. Run the entire contents of `supabase/schema.sql` in the SQL Editor
3. Copy Project URL + `anon` key + `service_role` key

### 2. Environment
```bash
cp .env.example .env
```
Fill in:
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `ENCRYPTION_KEY` → generate with:
  ```bash
  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  ```
- `ADMIN_SECRET` → long random string for cash subscription admin
- `TRIAL_DAYS=14`

### 3. Frontend config
Edit `public/config.js`:
```js
window.SUPABASE_URL = 'https://xxxx.supabase.co';
window.SUPABASE_ANON_KEY = 'eyJ...';
```

### 4. Run locally
```bash
npm install
npm run dev
```
Open http://localhost:3000

### 5. Deploy on Render
1. New Web Service → connect repo (or upload)
2. Build: `npm install`
3. Start: `npm start`
4. Add all env vars from `.env`
5. Health check path: `/health`

## Admin (cash payments)
After an owner pays you cash/MoMo:

```bash
curl -X PATCH https://your-app.onrender.com/admin/owners/<OWNER_UUID>/subscription \
  -H "X-Admin-Secret: YOUR_ADMIN_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"status":"active"}'
```

List owners:
```bash
curl https://your-app.onrender.com/admin/owners \
  -H "X-Admin-Secret: YOUR_ADMIN_SECRET"
```

## Critical derisk (do this first)
Before onboarding real customers, test from a Render-hosted instance:

1. Enable MikroTik API (`/ip service set api disabled=no`)
2. Create a limited API user
3. Port-forward 8728 (or use a public IP / DDNS)
4. Call `POST /routers/test` with real credentials

If connection is unreliable because of CGNAT → switch architecture to a “phone-home” agent script on the router (outbound only). The current code is structured so that swap is possible later.

## Security notes
- Router passwords encrypted at rest (AES-256-GCM)
- Never logged
- Service role key stays on the backend only
- Credentials only decrypted in memory for the short-lived API call

## Out of scope for v1
Thermal printing, QR codes, multi-staff, analytics dashboards, captive portal editor, Flutterwave.
