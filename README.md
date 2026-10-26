# Calorie Tracker – scan server

The small server behind the Calorie Tracker app's **Scan Food** button. The app sends a photo; this server asks Google Gemini what food it is and returns calories, protein, carbs, fat and serving size.

No database, no logins, no files stored. Photos are passed to Gemini and then discarded.

## Endpoints
- `GET /api/health` → `{ ok, configured, model }`
- `POST /api/analyze-food` with JSON `{ "imageBase64": "...", "mimeType": "image/jpeg" }` (max 15 MB) → `{ success: true, data: { foods, totalCalories, description } }` or `{ success: false, error }`
- `POST /api/crash-report` (needs the `x-app-token` header) with JSON `{ message, stack, componentStack?, appVersion, platform, osVersion, device?, isFatal, timestamp, screen? }` (max 20 KB, 20 reports per IP per hour). Each report is written to the logs as one line starting with `CRASH_REPORT` followed by JSON. Only these technical fields are kept — no food logs or weights. In Render: service → Logs → search `CRASH_REPORT`.

## Settings (environment variables — never commit them)
| Name | Needed | What it is |
|---|---|---|
| `GEMINI_API_KEY` | yes | Your key from https://aistudio.google.com/apikey |
| `APP_TOKEN` | recommended | Shared password; requests must send it in the `x-app-token` header |
| `GEMINI_MODEL` | no | Default `gemini-3.5-flash-lite` |
| `PORT` | no | Default 3000 (Render sets this automatically) |

## Run
- Docker (used on Render): `docker build -t scan . && docker run -p 3000:3000 -e GEMINI_API_KEY=... scan`
- Node 20.12+: `npm install && npm run build && GEMINI_API_KEY=... npm start` (or put the values in a `.env` file, which is git-ignored)

The full app lives in a separate private repository.
