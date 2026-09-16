# check-gcp-logger

Local desktop app for browsing GCP Cloud Functions logs. Multi-select functions, filter by severity / time / free text, expand any entry to see the full JSON payload.

## What it does

- Auto-discovers deployed Cloud Functions (gen1 + gen2) in a GCP project.
- Lets you pick one or many to inspect at once.
- Builds a Cloud Logging filter from the UI controls and queries the API.
- Renders results in a table; row-click expands to a JSON tree.
- Copy-as-`gcloud` button for any filter combo (so you can paste the same query into a terminal).

## Stack

- **Server**: Node + Express + `@google-cloud/logging` + `@google-cloud/functions`. Reads ADC credentials.
- **Web**: Vite + React + Tailwind CSS.
- **Auth**: Application Default Credentials (no service account JSON to manage).

## One-time setup

```bash
# 1. Authenticate gcloud for ADC (only needed once per machine)
gcloud auth application-default login

# 2. Configure the project + region
cp .env.example .env
# edit .env if motenasu-develop / asia-northeast1 aren't right

# 3. Install dependencies for root, server, and web
npm run install:all
```

## Run — pick one

### Option A: `npm run dev` (hot reload, two ports)

```bash
npm run dev
```

Opens:
- Server on http://localhost:4000
- Web on http://localhost:5173 (auto-opens in browser)

Vite proxies `/api/*` from the web port to the server, so no CORS dance. Use this when you're working on the app itself.

### Option B: Docker + ngrok (one container, shareable URL)

Production-style: web is built into a static bundle, the Express server serves it on a single port, and an `ngrok` sidecar exposes that port to the public internet so you can share the log viewer with teammates.

Prereqs:
1. Docker Desktop installed and running.
2. ngrok auth token — sign up at https://dashboard.ngrok.com/get-started/your-authtoken (free tier is fine).
3. ADC credentials on the host (from `gcloud auth application-default login` — same as Option A).

```bash
# 1. Fill in NGROK_AUTHTOKEN in .env
# 2. Build + run both containers
npm run docker:up

# 3. Find your public URL — open the ngrok dashboard:
#    http://localhost:4040
#    (the "Tunnels" section shows the public https://… URL pointing at the app)

# Stream logs from both containers
npm run docker:logs

# Stop everything
npm run docker:down

# Rebuild after server/ or web/ changes
npm run docker:rebuild
```

What runs where:
- App container on port `4000` — serves the React SPA + the `/api/*` backend.
- ngrok container on port `4040` — local dashboard showing the tunnel URL.
- ngrok creates a public `https://*.ngrok-free.app` URL (rotates each restart on free tier).

#### ADC auth inside the container

The compose file mounts your local ADC credential file into the app container so the `@google-cloud/*` libraries authenticate the same way they do outside Docker. Auto-detected locations:

| Platform | Path used |
|---|---|
| Windows | `%APPDATA%\gcloud\application_default_credentials.json` |
| macOS / Linux | `$HOME/.config/gcloud/application_default_credentials.json` |

If your gcloud config lives somewhere non-standard, set `GCLOUD_ADC_FILE` in `.env` to the absolute path of the file.

If you'd rather use a service account JSON instead of ADC, point `GCLOUD_ADC_FILE` at that file — same mount path, same env var, no other changes needed.

## What you'll see

1. **Header**: shows the current `GCP_PROJECT_ID` and `GCP_REGION` from `.env`.
2. **Function picker** (left rail): checkboxes for every deployed Cloud Function in the configured project/region.
3. **Filter bar**: time range (15m / 1h / 6h / 24h / custom), severity (all / WARNING+ / ERROR+), free-text search, limit (50 / 100 / 200 / 500).
4. **Log table**: timestamp, function name, severity, message. Click a row → modal with the full entry as a collapsible JSON tree.
5. **Auto-refresh toggle**: re-runs the same query every 30 s.
6. **Copy-as-gcloud**: bottom-right button copies the equivalent `gcloud logging read '…'` command for the active filter.

## Endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/api/health` | Liveness check; returns `{ ok: true, project, region }` |
| GET | `/api/functions` | List of Cloud Functions in the configured project/region |
| POST | `/api/logs` | Query logs. Body: `{ functionNames: string[], minutesAgo: number, severityMin?: string, freeText?: string, limit?: number }` |

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| `Error: Could not load the default credentials` | Run `gcloud auth application-default login`. |
| `permission denied` on functions list | Your account needs `roles/cloudfunctions.viewer` (or higher) on the project. |
| `permission denied` on logs | Your account needs `roles/logging.viewer` on the project. |
| Empty function list | Check `GCP_REGION` in `.env` — functions in other regions won't show up. |
| Logs show nothing for a function you just deployed | Cloud Logging has ~30 s ingestion lag. Wait and refresh. |

## Adding more services later

For v1 this is Cloud Functions only. The server's filter builder ([server/lib/filter-builder.js](server/lib/filter-builder.js)) can be extended to support Cloud Run, App Engine, etc. — open it, add another `resource.type=` branch, and surface the toggle in the frontend.