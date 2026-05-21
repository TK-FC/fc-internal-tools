# AI Project Dashboard: Build Plan

**Status as of 19 May 2026:** Sessions 1–7 complete. Live at https://tk-fc.github.io/fc-internal-tools/. Auto-deploys on push to `main`. Sam can add, edit, archive, and now access the dashboard from anywhere with a @foodiecoaches.com Google account. Every mutation is logged to `audit_log`. Soft delete only — nothing is ever hard-deleted.

---

## What's done

### Session 1 (complete)

- Real project data loaded: 10 projects, 42 modules, mapped from Sam's FC AI projects list
- New category "General AI Chatbots" holds the four big assistants: PA AI, Operations AI, Numbers AI, Marketing AI
- Stages quick-fire corrected against current reality (not guesses). Lots dropped to Ideation, Menu AI moved to Released, TK's Marketing Snapshot moved to Finalisation
- PA AI flipped from auto rollup to manual: Released so the parent stops displaying as Ideation
- Owner names: Sam on most things, Tim on the two Marketing items (Marketing AI, TK's Marketing Snapshot)

### UI improvements during Session 1

- Category group headers are now collapsible. Click chevron or header bar to toggle. In-memory state only (no persistence until backend lands).
- Stage colour system added so stages are distinguishable at a glance:
  - Ideation: grey #888888
  - Building: yellow #FFD23F (brand)
  - Finalisation: amber #FFB547
  - Released: green #7DD87D
- Module preview strip on project cards now shows module stages (was showing health, which is `none` for everything right now)

### Carried forward from the initial UI prototype

- React UI in `ai-dashboard.jsx`
- Three-level navigation: All Projects, Project, Module
- Dark theme with yellow #FFD23F accent
- Health filter shortcuts (Online / Issues click-to-filter)
- Group by Category or Stage
- Stage pipeline with AUTO (rollup) and MANUAL modes
- Module-level health indicators
- Mobile responsive

### Session 2 (complete)

- Three SQL files produced, ready to paste into Supabase in order:
  - `01_schema.sql`: 5 tables, constraints, triggers, indexes
  - `02_seed.sql`: 10 projects + 42 modules loaded from MOCK_PROJECTS
  - `03_rls.sql`: RLS on with public read, writes locked to service_role
- Supabase plan confirmed: Free tier. 500 MB / 50k MAU is overkill for this dashboard. Daily Worker cron from Session 4 will prevent the 1-week inactivity pause.
- RLS confirmed: stays on the whole way through. Session 2 has public-read policies; Session 5 swaps them for auth-gated ones (now done).

### Schema decisions made during Session 2

- **Single `items` table** for projects + modules. `parent_id IS NULL` = project, set = module. Project-only and module-only columns are nullable. Two CHECK constraints enforce the contract.
- **UUIDs not string IDs.** The `p1` / `p1m1` style from MOCK_PROJECTS is dropped. Supabase generates UUIDs automatically.
- **`brief` (project) and `module_brief` (module) are separate columns.** Both existed in MOCK_PROJECTS but they're different things — kept distinct to make the type contract obvious.
- **`health_status` lives on `items`** as the latest snapshot. `health_checks` is the append-only history table. Worker writes to both.
- **`sort_order` column on items and tasks** so display order is stable and matches the seed.
- **Trigger on `tasks`** enforces `module_id` actually points to an item where `type = 'module'`.
- **`stage_mode` required on projects** via CHECK. Modules don't have one — they just have a stage.

### Session 3 (complete)

- React now fetches live from Supabase. `MOCK_PROJECTS` deleted from the codebase.
- Three files in play:
  - `src/lib/supabase.js`: Supabase client singleton, reads `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` from `.env.local`
  - `src/lib/fetchProjects.js`: queries `items` table sorted by `sort_order`, splits rows by `type`, attaches modules to parents by `parent_id`, maps snake_case columns to the camelCase shape the UI expects
  - `src/App.jsx` (renamed from `ai-dashboard.jsx`): now state-driven, fetches on mount via `useEffect`
- Loading + error states added to the UI:
  - Yellow spinner during initial fetch
  - Red error card with "Try again" button if fetch fails
  - Graceful "project no longer exists" fallback if a deep-linked project gets deleted between fetches
  - Header timestamp now shows real last-fetched time (was hardcoded)
- Refresh button is wired up — actually re-fetches now instead of the fake 1.2s spinner.

### Local dev environment set up (Session 3, one-off)

- Node.js LTS, Git for Windows, VS Code, GitHub Desktop installed
- Vite + React project scaffolded at `C:\...\fc-internal-tools\`
- npm packages installed: `@supabase/supabase-js`, `lucide-react`
- GitHub repo `fc-internal-tools` created (private), connected to local folder
- `.env.local` configured with Supabase URL + anon key (gitignored)
- Verified end-to-end: `npm run dev` → `localhost:5173` → dashboard loads real data from Supabase

### Session 3 gotchas worth remembering

- **Trailing slash on `VITE_SUPABASE_URL` breaks everything.** Error reads as "Invalid path specified in request URL". The Supabase client appends `/rest/v1/...` itself.
- **Vite only reads `.env.local` on startup.** Any change to env vars requires `Ctrl+C` + `npm run dev` again. Browser refresh alone won't pick it up.
- **Column name assumptions in `fetchProjects.js` mappers were correct.** If anything displays oddly later, that's the first place to check — `mapProject` and `mapModule` are the only spots where DB column names appear.

### Session 4 (complete)

- Cloudflare Worker `fc-health-worker` deployed at `https://fc-health-worker.tim-475.workers.dev`. Lives in `/worker` inside the same repo so frontend + Worker stay in sync.
- **Cron:** runs daily at 21:00 UTC = 7am AEST. Schedule survives Sydney DST because Brisbane (Sam's TZ) doesn't observe it.
- **Manual endpoint:** `POST /check` (optional `?item_id=<uuid>` to check one). Gated by shared secret in Session 4; replaced with Supabase JWT verification in Session 5.
- **Health check dispatch:** URL-sniffing decides strategy. `/webhook/` or `/webhook-test/` in path → n8n POST. `hook.<region>.make.com` → Make POST. Everything else → plain GET. 2xx/3xx = green, 4xx = amber, 5xx/timeout/404 = red. 5s timeout, all checks in parallel.
- **Persistence:** every check inserts a row into `health_checks` and updates `items.health_status` / `last_health_check` / `last_error`. Service_role key bypasses RLS — only the Worker has it.
- **React wiring:** `src/lib/worker.js` client. `ModuleDetail` "Check now" button calls the Worker, shows result inline, and triggers a `loadProjects()` refetch so the new health flows through every pill in the UI.
- Verified end-to-end with a temporary `httpbin.org/status/200` endpoint on one module — green pill appeared, status saved to DB.

### Session 4 gotchas worth remembering

- **PowerShell `curl` is an alias for `Invoke-WebRequest` and breaks `-H` syntax.** Use `curl.exe` to get real curl. (Affects all the testing commands in `worker/README.md`.)
- **`wrangler secret put SECRET_NAME` takes only the key.** Value is entered at the prompt that follows, and it stays hidden as you paste it. Don't put both on one line.
- **`wrangler dev` needs `worker/.dev.vars` for local testing.** Production secrets set via `wrangler secret put` are NOT readable locally. The `.dev.vars` file must contain the same secrets, gitignored.
- **All worker config files must sit at `worker/` root, not inside `worker/src/`.** Only `index.js` belongs in `src/`. The wrangler.toml, package.json, .gitignore live one level up.
- **`worker.js` (the React client, not the Worker itself) goes in `src/lib/`** next to `fetchProjects.js` and `supabase.js`.

### Session 5 (complete)

- **Google OAuth wired up.** OAuth client created in Google Cloud Console under a new `fc-internal-tools` project. Consent screen set to "Internal" so only @foodiecoaches.com Workspace accounts can even reach the sign-in flow. Client ID + secret pasted into Supabase Auth → Providers → Google.
- **Sign-in is restricted to @foodiecoaches.com via three layers**, belt-and-braces:
  1. Google's "Internal" Workspace setting blocks non-Workspace accounts at Google
  2. `hd=foodiecoaches.com` queryParam in the React `signInWithOAuth` call passes the restriction through to Google as a hosted-domain hint
  3. Worker server-side `endsWith('@foodiecoaches.com')` check on the JWT email claim
- **`04_rls_authed.sql` shipped.** Run after `03_rls.sql` to swap the policies:
  - Drops the public-read policies on `items`, `tasks`, `health_checks`
  - Adds `is_allowed()` SQL function that checks the JWT email against `access_allowlist` (active = true). Function is `SECURITY DEFINER STABLE` so it can read the allowlist even though the calling user has no direct SELECT on it.
  - Recreates read policies on `items`, `tasks`, `health_checks` gated by `is_allowed()`
  - Adds a `self read access_allowlist` policy so the React app can check its own status (returns the row matching the signed-in email, or nothing)
  - Seeds `samuel.robertson@foodiecoaches.com` and `tim@foodiecoaches.com`
- **React auth wiring:**
  - `src/lib/supabase.js`: auth re-enabled. `persistSession: true`, `autoRefreshToken: true`, `detectSessionInUrl: true`, `flowType: 'pkce'`
  - `src/lib/useAuth.js` (new): single source of truth for auth state. Returns `status`, `user`, `session`, `signIn`, `signOut`, `error`. Four states: `loading`, `signed-out`, `signed-in-allowed`, `signed-in-pending`. Allowlist check is a normal Supabase query against `access_allowlist`, RLS enforces row-level visibility.
  - `src/components/LoginScreen.jsx` (new): two screens in one file — `LoginScreen` (signed-out) and `PendingAccessScreen` (signed-in but not on allowlist). Both share a centred-card shell that matches the dashboard theme.
  - `src/App.jsx`: top-level `AIDashboard` now switches on auth status and renders one of three things — loading spinner, login screen, pending screen, or the dashboard (split out into a `Dashboard` component). Header gained a user chip (Google avatar) with a sign-out button.
- **Worker auth swapped from shared secret to JWT.** `worker/src/index.js`:
  - Old `x-worker-secret` header check is gone. `WORKER_SECRET` deleted from Cloudflare and `.env.local`.
  - New `authenticate()` function reads `Authorization: Bearer <jwt>`, verifies the HS256 signature against `SUPABASE_JWT_SECRET` using Web Crypto (no external deps), checks `exp`/`nbf`, then validates the email domain and allowlist membership via service_role.
  - `SUPABASE_JWT_SECRET` added as a wrangler secret. CORS allow-list updated to include `Authorization` header.
  - **Session 7 update:** swapped from HS256+shared-secret to ES256 verified via Supabase JWKS. `SUPABASE_JWT_SECRET` is no longer used and can be deleted.
- **React Worker client** (`src/lib/worker.js`): now pulls the live Supabase session before each call and forwards `Authorization: Bearer <access_token>`. Throws a clear "Not signed in" error if there's no session. `VITE_WORKER_SECRET` removed from `.env.local`.

### Session 5 gotchas worth remembering

- **VS Code's "unsaved file" dot is easy to miss.** New files can show as written-to-disk in the editor tab but actually be empty/stale. Hot-reload then fails with "module does not provide an export named X". Fix: **Save All** (Ctrl+K, S) before assuming the code is wrong.
- **Google OAuth redirect URI must match exactly.** Trailing slashes count, http vs https counts. Copy-paste from Supabase Studio → Auth → Providers → Google to Google Cloud Console → OAuth client → Authorized redirect URIs. Don't retype.
- **Three different Supabase keys, don't mix them up.** `anon` key for the React client. `service_role` key for the Worker's database access. `JWT secret` for verifying JWTs in the Worker. All three live in Supabase Studio → Project Settings → API. The JWT secret is at the bottom under "JWT Settings".
- **"Allow new users to sign up"** in Supabase Auth settings must stay ON. It controls whether Supabase will create `auth.users` rows on first sign-in. With this OFF, even allowlisted users can't get a session created. Access control happens at the allowlist layer, not this toggle.
- **`hd=foodiecoaches.com` is a hint, not a wall.** Determined attackers can strip it. The real walls are (a) the "Internal" Workspace setting on the OAuth consent screen and (b) the server-side domain check in the Worker.
- **`is_allowed()` runs in `STABLE SECURITY DEFINER`** mode. Without `SECURITY DEFINER` it can't read `access_allowlist` (RLS would block it). Without `STABLE` it can't be cached within a request and would re-run on every row.

### Session 6 (complete)

- **Worker grew CRUD endpoints.** Service_role stays the only writer (per the locked-in decision). Eight new routes on `fc-health-worker`, all JWT-auth'd, all writing one row to `audit_log` per mutation:
  - `POST /projects`, `PATCH /projects/:id`, `DELETE /projects/:id`, `POST /projects/:id/restore`
  - `POST /modules`, `PATCH /modules/:id`, `DELETE /modules/:id`, `POST /modules/:id/restore`
- **Field whitelisting.** The Worker has hardcoded sets of writable fields per type (`PROJECT_WRITABLE`, `MODULE_WRITABLE`). Anything else in the request body is silently dropped — keeps `health_status`, `last_health_check`, `created_at` etc. safe from being overwritten by the UI.
- **Audit log writes are unskippable.** Every create/update/archive/restore writes one row to `audit_log` server-side. Updates record a before/after diff in the `details` JSONB (only changed fields, not the whole row). Archives record the cascaded flag if it was a project. Failure to write audit doesn't fail the user request — it logs to Worker console and continues.
- **Soft delete with cascade.** `05_archive.sql` adds an `archived` boolean to `items` plus a partial index on the not-archived set. DELETE on a project flips `archived = true` on the project AND all its child modules in one go. Restore only touches the parent (some children might've been individually archived before).
- **`fetchProjects.js` filters archived rows by default.** Optional `{ includeArchived: true }` flag brings them back. Health-check cron in the Worker also skips archived items.
- **React edit UI: one `EditModal.jsx` component handles both project and module forms.** Modal locks body scroll, closes on ESC or backdrop click, autofocuses the name input. Project form has all the fields including wishlist (inline add/remove with Enter-to-add). Module form has name, stage, brief, endpoint. Both have an Archive button with inline confirmation in the footer (no separate dialog).
- **Entry points in the UI:**
  - "New project" button on the main view, next to "Show archived"
  - "Edit" pill button on the project detail page header
  - "Add module" button to the right of the Modules section header on the project detail page
  - "Edit" pill on the module detail page
  - "Restore" button replaces "Edit" when the item is archived
- **"Show archived" toggle** lives next to "New project" on the main view. Header shows the count of archived projects. When on, archived projects render dimmed (opacity 0.55) with an "Archived" badge and a Restore button on the card.
- **Wishlist bug fix.** The old `fetchProjects.js` mapper was hardcoding `wishList: []` regardless of what was in the DB. The new mapper actually reads the JSONB column. Projects with seeded wishlist data will now display it.

### Session 6 gotchas worth remembering

- **CORS preflight needs PATCH and DELETE in the methods list.** Easy to miss — the old `/check` only used POST. Updated `corsHeaders()` to list GET, POST, PATCH, DELETE, OPTIONS.
- **`Prefer: return=representation` is needed if you want the row back from Supabase REST.** Without it the response is empty and the audit_log diff can't be built. Use `Prefer: return=minimal` only when you don't need the row (e.g. health check persistence).
- **`return=representation` responses are always an array.** `(await res.json())[0]` to get the row. Forgot this once during dev — Worker returned `{ item: [{...}] }` instead of `{ item: {...} }` and the UI silently rendered nothing.
- **Don't try to PATCH `type` or `id`.** They're not in the writable sets. If you do, the request succeeds with no effect on those fields and the audit_log diff will be empty.
- **Cascade is one-way.** Archive a project → modules cascade. Restore a project → modules stay archived. Intentional but easy to forget.

### Session 7 (complete)

- **Live URL:** https://tk-fc.github.io/fc-internal-tools/. Auto-deploys on every push to `main` via GitHub Actions.
- **One repo, not two.** Frontend and worker both live in `fc-internal-tools` (root = React, `/worker` = Cloudflare Worker). An empty `fc-ai-dashboard` repo got created mid-session by accident and was deleted.
- **Worker auth upgraded from HS256 to ES256.** Worker now verifies the JWT against Supabase's published JWKS instead of the shared `SUPABASE_JWT_SECRET`. The old secret can be deleted (`npx wrangler secret delete SUPABASE_JWT_SECRET` from `worker/`).
- **Worker CORS tightened** from `*` to an origin allowlist: `https://tk-fc.github.io` + `http://localhost:5173`. Methods include GET, POST, PATCH, DELETE, OPTIONS.
- **Vite + Pages config:**
  - `--base=/fc-internal-tools/` baked into the `build` and `preview` scripts in `package.json`. (Vite 8 wasn't honouring `base` from `vite.config.js` — moved to CLI flag instead. Comment in `vite.config.js` flags this.)
  - `public/404.html` redirects unknown paths back to the app root so SPA navigation works on Pages
- **GitHub Actions deploy workflow** at `.github/workflows/deploy.yml`. Builds with `npm ci` + `npm run build`, uploads `dist/` as a Pages artifact, deploys via `actions/deploy-pages@v4`. Triggers on push to `main` or manual dispatch.
- **GitHub repo secrets** (required for the build step):
  - `VITE_SUPABASE_URL`
  - `VITE_SUPABASE_ANON_KEY`
  - `VITE_WORKER_URL`
- **Pages source** set to "GitHub Actions" (not "Deploy from a branch")
- **Google OAuth:** added `https://tk-fc.github.io` to Authorized JavaScript origins
- **Supabase URL config:**
  - Site URL: `https://tk-fc.github.io/fc-internal-tools/`
  - Additional Redirect URLs: `https://tk-fc.github.io/fc-internal-tools/**` plus `http://localhost:5173/**` retained for dev
- **Smoke test passed:** load, Google sign-in, edit project, edit module, new project, archive/restore, refresh persistence, SPA fallback — all green against the live URL.
- **Team brief drafted** for FC staff explaining where it is, how to sign in, what it does, and that it's an internal tool.

### Session 7 gotchas worth remembering

- **Vite 8 ignored `base` from `vite.config.js`.** Worked fine from the CLI flag. Hours of "why are the paths still bare `/assets/`" until the CLI flag confirmed it. Solution: keep `--base=/fc-internal-tools/` in the `package.json` scripts. Don't trust `vite.config.js` for it.
- **Notepad/editor "did the save actually save" trap.** `type package.json` from PowerShell is the fastest way to confirm what's actually on disk vs what the editor thinks is saved.
- **The build action's Node 20 deprecation warnings are non-blocking.** Bump `actions/*` versions later if needed — not before June 2026.
- **GitHub Pages source must be "GitHub Actions", not "Deploy from a branch".** The latter is the old method and won't work with the workflow file.
- **Supabase Site URL needs the trailing slash.** Redirect allowlist patterns use `/**`, not `/*` (single asterisk only matches one segment).

## What's NOT done

- No edit UI for **tasks**. Tasks were pushed to Session 6b — they have a different interaction pattern (inline checklist) than projects and modules. Module-level task lists still come back from the fetch but can only be edited in Supabase Studio.
- Per-project endpoints, monthly costs, calls counts are still placeholders in the seed for most rows. Sam can now add real values via the Edit form instead of Supabase Studio. **Modules still need real endpoints** for the daily cron to do anything useful — until then it reports `checked: 0`.
- `audit_log` writes ARE happening now (Session 6) but there's no UI to view the log. Query it in Supabase Studio for now.
- No "view archived modules inside an active project" UI. If a project has some archived modules, they're hidden on the detail page even when "Show archived" is on. (The toggle only filters at the project level.) Revisit if this gets annoying.
- `SUPABASE_JWT_SECRET` still exists in Cloudflare as an unused wrangler secret. Housekeeping — delete with `npx wrangler secret delete SUPABASE_JWT_SECRET` from `worker/`.
- GitHub Actions workflow uses `actions/*` versions on Node 20. They'll need bumping before September 2026.

---

## Remaining work: one session per item

Run each in a fresh chat inside the Project. Keep sessions focused. Don't combine.

### Session 6b: Task editing (optional, do when needed)
**What:** Inline task CRUD on the module detail page. Checkbox to toggle done, click-to-edit, add at bottom, drag-to-reorder. Worker routes: `POST /modules/:id/tasks`, `PATCH /tasks/:id`, `DELETE /tasks/:id`. Audit log writes for each.
**Outcome:** Sam can manage module-level checklists without Supabase Studio.

### Session 8: Real module endpoints + health-check unlock (when ready)
**What:** Add real URLs to each module's endpoint field, one project at a time. Confirm the daily cron picks them up. Iterate on health-check strategy if any module's URL needs a custom check type.
**Outcome:** The health dashboard actually monitors something.

---

## Decisions already locked in (don't re-litigate)

- **Stack:** React + Supabase + Cloudflare Worker + GitHub Pages
- **Repo:** one repo (`fc-internal-tools`), React at root, Worker in `/worker`
- **Live URL:** https://tk-fc.github.io/fc-internal-tools/
- **Deploy:** GitHub Actions on push to `main`
- **Supabase plan:** Free tier. Daily Worker cron prevents inactivity pause.
- **Auth:** Google OAuth restricted to @foodiecoaches.com + Supabase allowlist table (now live)
- **Worker JWT verification:** ES256 via Supabase JWKS (Session 7 upgrade from HS256)
- **Nesting:** Two levels max (project > module > task)
- **Stage rollup:** Mix. Per-project setting (auto or manual)
- **Health checks:** API key valid + endpoint responds, per-module
- **Theme:** Dark + yellow #FFD23F
- **Categories (extensible):** General AI Chatbots, Internal Ops, Numbers, Marketing. People exists in the list but is currently empty.
- **Stages:** Ideation > Building > Finalisation > Released
- **Stage colours:** Ideation #888888, Building #FFD23F, Finalisation #FFB547, Released #7DD87D
- **Stage editing pattern:** full form in Session 6. No quick-click on pipeline.
- **Category groups:** collapsible. In-memory state for now, no persistence until backend lands.
- **RLS:** stays on the whole way through. Reads gated by `is_allowed()`. Writes always go through service_role (Worker).
- **Allowlist:** `active = false` is the soft-revoke mechanism. Don't delete rows — flip the flag so the audit trail stays intact.
- **IDs:** UUIDs everywhere. No string IDs like `p1` / `p1m1`.
- **Schema shape:** projects + modules in one `items` table with nullable type-specific columns and CHECK constraints.
- **Writes (Session 6 decision):** all writes go through Worker endpoints using service_role. No direct Supabase writes from React. Keeps audit logging server-side and unskippable.
- **Delete UX (Session 6 decision):** soft delete only. `archived` boolean on `items`. Archive cascades down (project → modules). Restore does not cascade.
- **Field whitelisting:** the Worker has hardcoded sets of writable fields per type. Adding a new field means updating both the Supabase schema AND the `PROJECT_WRITABLE` / `MODULE_WRITABLE` sets in `worker/src/index.js`.
- **Vite base path:** set via `--base=/fc-internal-tools/` CLI flag in `package.json` scripts, not in `vite.config.js` (Vite 8 didn't honour it from the config file).

## Decisions still open

- Brand fonts. Yellow placeholder confirmed but other brand assets not specified.
- Health check method per endpoint type (custom API vs n8n webhook vs Claude/OpenAI direct vs Make.com). Confirm when endpoints are added.
- Whether to track API costs automatically or just record manually.
- Whether to add usage analytics beyond the basic "calls this month" counter.
- Whether to drop the empty People category or keep it for future use.
- Marketing AI shows Released at project level while every module is Ideation. Confirmed intentional for now (TK has a live version, modules represent FC's rebuild). Worth revisiting when the rebuild progresses.
- Whether to build an audit_log viewer in the dashboard (needs new RLS read policy or a Worker endpoint). Skip until someone actually wants to read the log without opening Supabase Studio.
- Whether to widen access beyond Sam — add other FC staff to the allowlist as roles formalise.
