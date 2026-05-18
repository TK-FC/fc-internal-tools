# fc-health-worker

Cloudflare Worker that runs health checks on every dashboard item with an endpoint.

## What it does

- **Daily at 7am AEST** (cron): pings every module endpoint, logs the result to `health_checks`, updates the item's `health_status` / `last_health_check` / `last_error`.
- **On-demand**: the dashboard's "Check now" button hits `POST /check?item_id=<uuid>` to re-check one module immediately.

Bypasses RLS via the Supabase service_role key. Service key never touches the browser.

## One-time setup

From the `worker/` folder:

```bash
npm install
npx wrangler login
```

### Set production secrets

```bash
npx wrangler secret put SUPABASE_URL
# paste: https://xxxxx.supabase.co   (NO trailing slash)

npx wrangler secret put SUPABASE_SERVICE_KEY
# paste: service_role key from Supabase → Project Settings → API

npx wrangler secret put WORKER_SECRET
# paste: any long random string. Generate one with:
#   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

The same `WORKER_SECRET` also goes in the React app's `.env.local`:

```
VITE_WORKER_URL=https://fc-health-worker.<your-subdomain>.workers.dev
VITE_WORKER_SECRET=<same value as above>
```

> The secret in `VITE_WORKER_SECRET` is visible in the browser bundle. That's fine for now — it just stops random internet traffic from triggering checks. Session 5 swaps this for OAuth tokens and the secret becomes server-side only.

### Set local dev secrets

Create `worker/.dev.vars` (gitignored):

```
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_SERVICE_KEY=eyJ...
WORKER_SECRET=<same random string>
```

## Deploy

```bash
npx wrangler deploy
```

Wrangler prints the public URL — copy that into the React app's `VITE_WORKER_URL`.

## Test it

**Manual check, all items:**
```bash
curl -X POST https://fc-health-worker.<sub>.workers.dev/check \
  -H "x-worker-secret: <WORKER_SECRET>"
```

**Manual check, single item:**
```bash
curl -X POST "https://fc-health-worker.<sub>.workers.dev/check?item_id=<uuid>" \
  -H "x-worker-secret: <WORKER_SECRET>"
```

**Trigger the cron locally:**
```bash
npm run test:cron
# then in another terminal:
curl "http://localhost:8787/__scheduled?cron=0+21+*+*+*"
```

**Watch production logs:**
```bash
npm run tail
```

## How health is decided

Strategy is picked from the endpoint URL shape (see `pickStrategy` in `src/index.js`):

| URL contains | Strategy | Green | Amber | Red |
|---|---|---|---|---|
| `/webhook/` or `/webhook-test/` (n8n) | POST with `{healthcheck: true}` payload | 2xx/3xx | 4xx (not 404) | 5xx, 404, timeout |
| `hook.<region>.make.com` | POST with `{healthcheck: true}` payload | 2xx/3xx | 4xx (not 404) | 5xx, 404, timeout |
| Anything else | GET | 2xx/3xx | 4xx | 5xx, timeout |

Timeout per check: 5 seconds. Checks run in parallel so the whole batch finishes well inside the Worker CPU limit.

## Adding a new endpoint type later

Two places to touch in `src/index.js`:

1. Add a new `ping<Type>` function next to `pingHttpGet` and `pingWebhookPost`.
2. Add a branch to `pickStrategy` that returns it.

If URL-sniffing becomes unreliable (e.g. n8n self-hosted on a custom domain), add a `health_check_type` column to `items` and dispatch on that instead.

## Side benefit

The daily cron query against Supabase keeps the Free-tier project from auto-pausing after 7 days of inactivity. Don't disable the cron without setting up an alternative pinger.