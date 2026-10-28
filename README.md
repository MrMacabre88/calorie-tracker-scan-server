# Calorie Tracker – scan server

The small server behind the Calorie Tracker app's **Scan Food** button. The app sends a photo; this server asks Google Gemini what food it is and returns calories, protein, carbs, fat and serving size.

No database, no logins, no files stored. Photos are passed to Gemini and then discarded.

## Endpoints
- `GET /api/health` → `{ ok, configured, model }`
- `POST /api/analyze-food` with JSON `{ "imageBase64": "...", "mimeType": "image/jpeg" }` (max 8 MB) → `{ success: true, data: { foods, totalCalories, description } }` or `{ success: false, error }`
- `POST /api/scan-menu` (PortionSnap Pro) with JSON `{ "imageBase64": "...", "mimeType": "image/jpeg", "mode": "auto" | "menu" | "recipe" }` → `{ success: true, data: { kind, title, servings, dishes: [{ name, description, calories, protein, carbs, fat, servingSize, confidence }], note } }`. Same per-IP limits and global cap as analyze-food.
- `POST /api/coach` (PortionSnap Pro) with JSON `{ question, history: [{ role: "user"|"coach", text }], summary: { date, localHour, units, goals, eaten, remaining, foods } }` (max 32 KB; question max 500 chars) → `{ success: true, reply }`. Limited to `COACH_LIMIT_PER_IP_DAY` questions per IP per UTC day, and each question counts toward `DAILY_SCAN_CAP`. Nothing is stored.
  - Limits (in memory, reset on redeploy): **30 scans/hour and 100 scans/day per IP**, plus a **global cap of 500 Gemini calls per day** (resets 00:00 UTC; a retry counts as a call). When a limit is hit the server returns `429` with `{ success: false, error: "<friendly message>", code: "rate_limited" }` and a `Retry-After` header, and logs one `SCAN_LIMIT {json}` line (reason, IP, daily count; never tokens or keys). Too-large photos get `413`.
  - Client IP comes from Cloudflare's `CF-Connecting-IP` / `True-Client-IP` (Render fronts services with Cloudflare), falling back to the rightmost `X-Forwarded-For` entry, so a spoofed `X-Forwarded-For` can't dodge the per-IP limit.
- `POST /api/crash-report` (needs the `x-app-token` header) with JSON `{ message, stack, componentStack?, appVersion, platform, osVersion, device?, isFatal, timestamp, screen? }` (max 20 KB, 20 reports per IP per hour). Each report is written to the logs as one line starting with `CRASH_REPORT` followed by JSON. Only these technical fields are kept — no food logs or weights. In Render: service → Logs → search `CRASH_REPORT`.
- `GET /privacy` (also `/privacy-policy`) → PortionSnap privacy policy, and `GET /disclaimer` (also `/terms`) → health disclaimer. Public HTML pages, no token. The text lives in `server/legal.ts`; `npm run legal:md` prints the Markdown copy used in the app repo's `store-listing/privacy-policy.md`.

## Settings (environment variables — never commit them)
| Name | Needed | What it is |
|---|---|---|
| `GEMINI_API_KEY` | yes | Your key from https://aistudio.google.com/apikey |
| `APP_TOKEN` | recommended | Shared password; requests must send it in the `x-app-token` header |
| `GEMINI_MODEL` | no | Default `gemini-3.5-flash-lite` |
| `PORT` | no | Default 3000 (Render sets this automatically) |
| `DAILY_SCAN_CAP` | no | Max Gemini calls per UTC day across everyone. Default 500 |
| `COACH_LIMIT_PER_IP_DAY` | no | AI coach questions per IP per UTC day. Default 20 |
| `SCAN_LIMIT_PER_IP_HOUR` | no | Default 30 |
| `SCAN_LIMIT_PER_IP_DAY` | no | Default 100 |
| `SCAN_MAX_BODY_BYTES` | no | Max scan request size. Default 8388608 (8 MB) |
| `PRIVACY_CONTACT_EMAIL` | before publishing | Contact email shown on `/privacy` and `/disclaimer`. Until set, the pages show the placeholder `CONTACT_EMAIL_HERE` |
| `TRUST_PROXY_HOPS` | no | Which `X-Forwarded-For` entry to trust, counted from the right, when no Cloudflare header is present. Default 1 |

## Test
`npm test` (limiter, legal-page, menu-scan and coach tests). Local smoke test with tiny limits: `npm run build && DAILY_SCAN_CAP=3 SCAN_LIMIT_PER_IP_HOUR=2 GEMINI_API_KEY=dummy npm start`.

## Run
- Docker (used on Render): `docker build -t scan . && docker run -p 3000:3000 -e GEMINI_API_KEY=... scan`
- Node 20.12+: `npm install && npm run build && GEMINI_API_KEY=... npm start` (or put the values in a `.env` file, which is git-ignored)

The full app lives in a separate private repository.
