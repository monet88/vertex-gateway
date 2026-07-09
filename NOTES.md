# NOTES — operator world for loop-me workflows

## Product under discussion
- Repo: `vertex-gateway` admin console (`/admin` React SPA)
- Live area already named: **Nhật ký API** / `logs-viewer`
- Current state: live gated logs on branch `feat/api-call-log-tracking` (mock rows removed)
- Reference UX: CLIProxyAPI-style management logs (Refresh / Auto Refresh / Clear, Show Raw Logs, Logging & Diagnostics settings)

## Canonical terms
- **API call log (structured)** — metadata-only redacted request event; never body/headers/full secrets
- **Raw log line** — text formatting of the same structured event
- **Logs surface (Hybrid A)** — default structured table; optional Show Raw Logs mode
- **Debug Mode** — diagnostics flag; hard AND with Log to File
- **Log to File** — diagnostics flag; hard AND with Debug Mode; dual-write includes disk JSONL
- **Gate** — `debugMode && logToFile` (and file-store writable capability for enabling/persisting)
- **Refresh Logs** — manual poll of memory-backed list API
- **Auto Refresh** — 5s client poll while logs view open; default **OFF**
- **Clear Logs** — confirm then delete memory ring + active file + backup file
- **Download Logs / Full Screen** — out of v1

## Resolved (grilling complete)
- Product shape Hybrid A
- Gate hard AND for capture + live UI
- Dual-write memory ring (500) + JSONL file
- Metadata-only schema + redaction
- Toolbar Refresh / Auto Refresh / Clear
- Public gateway API capture only; exclude admin/health/static
- Settings in Cấu hình → Logging & Diagnostics
- Persist flags in admin file-store; file-store+mutations only
- Filters + Show Raw Logs + deep-link fallback
- Admin APIs diagnostics + logs
- Gate OFF keeps data (no auto-wipe); Dashboard drops mock, live preview only when gate ON

## Open questions
- None material.

## Plan
- Implementation plan: `docs/superpowers/plans/2026-07-09-api-call-log-tracking.md`
