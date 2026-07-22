# Directory Runner

Area × keyword company search against the Google Places API (New), deployable
to Vercel. Static HTML/JS frontend + small Python serverless functions,
gated behind a login, saving every extraction to a shared, per-user-tagged
directory.

## How it's built (and why)

- **Frontend** (`index.html`, `style.css`, `app.js`) owns the whole loop:
  it walks every area × keyword pair, calls `/api/search` once per pair,
  aggregates + dedupes results, applies the shop/pharmacy exclude filter,
  and builds the CSV — all in the browser.
- **`api/search.py`** is a Vercel Python function that runs *one*
  area+keyword search (with pagination) and returns the raw hits. Keeping
  each call scoped to one pair means it always finishes well inside
  Vercel's function time limit, no matter how big your area/keyword matrix
  is — the frontend just calls it many times in sequence.
- **`middleware.js`** gates every request — static files and `/api/*` alike
  — behind HTTP Basic Auth, checked against an `APP_USERS` environment
  variable. Nothing in the app is reachable without valid credentials.
- **`api/save.py` / `api/history.py`** persist and read back every extracted
  company (tagged with the logged-in username, city, industry, and
  timestamp) via Upstash Redis, so the directory accumulates across runs
  and across users.
- Your Google API key is typed into the page and sent from your browser to
  your own `/api/search` function on your own domain. It's never committed
  to the repo or stored anywhere.

## Deploy

1. Push this folder to a GitHub repo (or run `vercel` from inside it with
   the [Vercel CLI](https://vercel.com/docs/cli) — no repo needed).
2. Import the repo at [vercel.com/new](https://vercel.com/new), or run:
   ```
   npm i -g vercel
   vercel
   ```
3. Framework preset: "Other". Vercel installs `package.json` dependencies
   automatically (needed for the middleware) — no other build step.
4. Add the environment variables below, then deploy/redeploy.
5. Once deployed you'll get a URL like `https://your-app.vercel.app`.

## Set up login

In your Vercel project → **Settings → Environment Variables**, add:

| Name | Value |
|---|---|
| `APP_USERS` | A JSON object of `"username": "password"` pairs, e.g. `{"alice":"correct-horse","bob":"battery-staple"}` |

Redeploy after adding it (env var changes need a redeploy to take effect).
Anyone hitting the site gets the browser's native Basic Auth prompt; the
username they enter is what gets stamped onto every row they extract.
To add/remove/rotate a user, just edit `APP_USERS` and redeploy — no code
changes needed. If `APP_USERS` is unset or empty, the app refuses all
requests rather than opening up.

## Set up storage (the shared directory)

Extracted companies are saved to Redis so they persist across runs and
users:

1. In the Vercel dashboard, go to **Storage → Marketplace Database
   Integrations → Upstash for Redis**, and connect a database to this
   project (there's a free tier).
2. This automatically injects `UPSTASH_REDIS_REST_URL` and
   `UPSTASH_REDIS_REST_TOKEN` as environment variables — no manual copying
   needed.
3. Redeploy. The "Directory history" panel and the auto-save after each run
   will start working; before this step, runs still work but you'll see a
   "storage isn't configured" message instead of a save confirmation.

Every save call appends one entry per company (`company_name`,
`extracted_by`, `city`, `industry`, `extracted_at`) to a Redis list, capped
at the most recent 5,000 entries.

## Get a Google Maps API key

1. In [Google Cloud Console](https://console.cloud.google.com/), create or
   pick a project, then enable **Places API (New)**.
2. Create an API key under **APIs & Services → Credentials**.
3. Restrict it:
   - **Application restriction**: HTTP referrers → add
     `https://your-app.vercel.app/*` (and `http://localhost:*` if you want
     to test locally).
   - **API restriction**: limit to "Places API (New)".
4. Billing must be enabled on the project — Places Text Search is a paid
   API past the free monthly credit.

Note: since the key is sent to *your* `/api/search` function (not straight
to Google from the browser), the HTTP-referrer restriction protects the
key from being lifted out of your page's source, but your deployed
function itself has no additional access control. Don't publish the URL
publicly unless that's intended, or add your own auth in `api/search.py`
if you want to lock it down further.

## Local development

```
npm i -g vercel
vercel dev
```

This serves the static files and runs `api/search.py` on
`http://localhost:3000`.

## Files

```
index.html       UI markup
style.css        Visual design
app.js           Orchestration: keyword generation, matrix progress, save/history, CSV export
middleware.js     Site-wide HTTP Basic Auth gate (reads APP_USERS)
package.json      Declares the middleware's @vercel/functions dependency
api/search.py     Serverless function: one area+keyword Places search
api/whoami.py     Reports the logged-in username to the frontend
api/save.py       Persists an extraction batch to Redis, tagged by username
api/history.py    Reads back the saved directory history
vercel.json       Runtime config
```
