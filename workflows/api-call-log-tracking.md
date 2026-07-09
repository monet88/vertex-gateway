# Workflow: API call log tracking

Status: **implemented** (branch `feat/api-call-log-tracking`; plan: `docs/superpowers/plans/2026-07-09-api-call-log-tracking.md`)

Loop: Operator enables diagnostic logging in Cấu hình, inspects public API traffic in Nhật ký API (refresh / auto-refresh / clear / filter / raw), then disables diagnostics when done.

## Intent
Give Vertex Gateway operators a gated API-call log tracker with Refresh / Auto Refresh / Clear. Capture and the live logs surface appear only when **Debug Mode** and **Log to File** are both ON (file-store writable admin).

## Resolved decisions
- **Product shape = Hybrid A**
  - Default: structured API-call table
  - Optional **Show Raw Logs**: line-oriented render of the **same** redacted events
  - Not a pure CLIProxy raw-only console replacement
- **Gate = hard AND**
  - `gateEnabled = debugMode && logToFile`
  - Gate ON → capture public API events + show Nhật ký API nav/view + toolbar
  - Gate OFF → no capture; hide Nhật ký API nav; no live tracker UI
  - Settings remain reachable in Cấu hình when gate OFF
- **Storage = dual-write**
  - Memory ring (UI source of truth), max **500**, newest retained
  - JSONL file `{adminFileStoreDir}/logs/api-calls.log`
  - Rotate at ~**10MB** → `api-calls.log.1` (single backup), then new active file
- **Schema = metadata-only**
  - Fields: `id`, `timestamp` (ISO-8601), `requestId`, `method`, `path` (redacted query secrets), `statusCode`, `statusClass` (`2xx`|`4xx`|`5xx` derived), `latencyMs`, `routeFamily`, `operation`, `model?`, `gatewayKeyPreview` (masked only), `upstreamTarget?`, `errorCode?`
  - Never capture bodies, raw auth headers, full keys/tokens, SA private keys, admin tokens
  - Raw line = formatted text from these fields only
- **Toolbar**
  - **Refresh Logs**: immediate `GET /admin/api/logs`
  - **Auto Refresh**: client toggle, default **OFF**; when ON and view mounted and gate ON, poll every **5s**; stop on leave view / logout / gate OFF
  - **Clear Logs**: confirm dialog → `DELETE /admin/api/logs` → clear memory + active file + backup; UI empties
  - Out of v1: Download Logs, Full Screen, SSE
- **Capture scope**
  - Public gateway API families only (Gemini / OpenAI / other real client proxy API ops via classifier)
  - Never: `/admin`, `/admin/*`, `/healthz`, `/readyz`, admin static assets
  - 401/403 on in-scope public routes may be recorded
- **Settings placement**
  - Section **Logging & Diagnostics** on **Cấu hình** (`ai-providers`)
  - Toggles: Debug Mode, Log to File + helper that both must be ON
  - No new Diagnostics nav item
- **Persistence & deploy posture**
  - Persist `debugMode`, `logToFile` in admin file-store settings (`admin-settings.json` or adjacent diagnostics settings under `adminFileStoreDir`)
  - Defaults both **OFF**
  - Requires `file-store` + mutations allowed + `adminFileStoreDir`
  - static-config / mutations-off: toggles disabled with explanation; no capture; no live logs surface; PATCH/DELETE reject clearly
  - Restart: reload flags; memory empty; no hydrate-from-file; resume capture only if gate still ON
- **Filters / raw / deep-link**
  - Filters: `statusClass`, `routeFamily`, `method`, `search` (path/requestId/model/gatewayKeyPreview/upstreamTarget)
  - Show Raw Logs default OFF
  - Gate OFF deep-link `?view=logs-viewer` → Dashboard + banner/toast to enable settings
- **Admin API / authz / retention**
  - Auth: same admin session as other `/admin/api/*`
  - `GET /admin/api/diagnostics` → `{ debugMode, logToFile, gateEnabled, writable, logFilePath?, ringSize, entryCount }`
  - `PATCH /admin/api/diagnostics` `{ debugMode?: boolean, logToFile?: boolean }` (writable file-store only)
  - `GET /admin/api/logs?limit&statusClass&routeFamily&method&search`
    - gate ON required; else **409** + enable-settings message
    - newest-first from memory; default limit 100; max 500
  - `DELETE /admin/api/logs`
    - admin auth + writable file-store; clears memory + active + backup
    - allowed even if gate currently OFF so operators can wipe retained artifacts after disabling diagnostics
  - Capture after in-scope public request completes/fails if gate ON: memory append then best-effort file append
  - File write errors must not fail client responses
- **Gate OFF data lifecycle**
  - Stop capture only; **do not auto-wipe** memory or files
  - GET logs still 409 while gate OFF
  - Operator uses Clear (or rotation/restart rules) to remove data
  - Process restart still empties memory (file remains until clear/rotate)
- **Dashboard**
  - Remove mock `apiLogs` "Nhật ký API gần đây" panel content
  - Gate ON: optional live preview (top N from `GET /admin/api/logs`) + link to full Nhật ký API
  - Gate OFF: CTA panel to enable Debug Mode + Log to File in Cấu hình — never fake rows

## Spec (implementable)

### Trigger
- Event: operator PATCHes diagnostics flags
- Event: each completed in-scope public gateway request while `gateEnabled`
- Event: operator Refresh / Auto Refresh poll / Clear

### Operator surface
1. **Cấu hình → Logging & Diagnostics**
   - Debug Mode toggle
   - Log to File toggle
   - Disabled state when not writable file-store
2. **Nhật ký API** (nav only if gate ON)
   - Toolbar: Refresh Logs, Auto Refresh, Clear Logs
   - Show Raw Logs toggle
   - Filters: statusClass, routeFamily, method, search
   - Structured table by default; raw lines when toggled

### Steps
1. Operator opens Cấu hình (file-store writable)
2. Enables Debug Mode and Log to File → gate ON → nav reveals Nhật ký API
3. Public client traffic is recorded (memory + JSONL)
4. Operator opens Nhật ký API, filters/reviews, uses Refresh / Auto Refresh / Clear as needed
5. Operator disables either flag → capture stops; nav hides; retained data kept until Clear/restart-memory/rotation

### Checkpoint
- None automated. Human decides when to enable diagnostics, what to clear, and when to disable.

### UI copy defaults (Vietnamese, operational)
- Section title: `Logging & Diagnostics`
- Helper: `Bật cả Debug Mode và Log to File để ghi và xem Nhật ký API.`
- Non-writable: `Cần admin file-store (ghi được) để dùng diagnostics.`
- Clear confirm: `Xóa toàn bộ log trong bộ nhớ và file log hiện tại?`
- Deep-link/gate-off toast: `Bật Debug Mode và Log to File trong Cấu hình để xem Nhật ký API.`
- Empty logs: `Chưa có API call nào được ghi.`

### Implementation anchors (existing code)
- Frontend: `frontend/src/pages/LogsViewerView.tsx`, `ApiLogsTable`, `Dashboard` mock panel, `admin-static` nav, `ai-providers`/Cấu hình view
- Backend: `src/admin/admin-routes.ts`, `src/config/admin-settings-store.ts`, request classifier/dispatch path for capture hook
- Prior unbuilt plan sketch: `docs/superpowers/plans/2026-07-05-admin-dashboard-backend.md` (`AdminRequestLogStore`) — reuse ideas, not mock data

### Validation expectations for implementer
- Unit: ring buffer, redaction, gate logic, rotation, clear
- Route tests: diagnostics GET/PATCH, logs GET/DELETE, 409 when gate OFF, auth required
- Frontend: nav visibility, settings toggles, toolbar, raw mode, dashboard CTA vs live preview
- No secrets in stored events or UI

## Out of scope (v1)
- Public non-admin log APIs
- Fake/mock live traffic rows
- Download Logs, Full Screen, management-log hide toggle
- SSE/WebSocket streaming
- Hydrate memory from file after restart
- Memory-only diagnostics on static-config / non-file-store
- Commercial Mode / Redis usage stats / unrelated CLIProxy settings from reference screenshots

## Done criteria
An implementer can build backend + admin UI from this file alone without product questions.

