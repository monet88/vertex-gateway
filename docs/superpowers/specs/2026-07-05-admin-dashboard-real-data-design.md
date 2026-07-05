# Admin Dashboard Real Data Design

Date: 2026-07-05
Status: Written for user review
Scope: Vertex targets and gateway keys only

## Goal

Replace the admin dashboard mock data for Vertex targets and gateway keys with real gateway-backed data. Keep API logs, KPI metrics, and security notices out of this implementation slice because they require separate telemetry and aggregation design.

The dashboard must remain usable with the existing admin token flow. It should show live Vertex target configuration and health from existing admin routes, and it should add secure gateway-key management without storing gateway key plaintext at rest.

## Current State

The frontend currently imports `vertexTargets` and `gatewayKeys` from `frontend/src/data/mockData.ts` in `Dashboard.tsx`. The frontend already has `adminFetch`, `useAdminToken`, table components, and create dialogs.

The backend already exposes Vertex target admin routes through `src/admin/admin-routes.ts`: list/import/update/delete/test under `/admin/api/vertex-credentials`, plus `/admin/api/health` and model routes. Those responses already redact upstream API keys and attach runtime health.

Gateway keys currently come from `GatewayConfig.gatewayKeys`, a `string[]` loaded from env/config. Runtime authentication compares submitted keys with SHA256 + `timingSafeEqual` in `src/auth/gateway-auth.ts`. There is no admin API, metadata, revoke state, or created timestamp for gateway keys.

## Chosen Approach

Use one admin data layer in the frontend and add a dedicated backend gateway-key store.

Vertex targets are frontend wiring only. The dashboard maps `/admin/api/vertex-credentials` records into the current `VertexTargetRow` shape. `hasApiKey` or `credentialsFile` determines auth type, `apiKeyMode` maps directly, and `health` comes from the runtime health attached by the backend.

Gateway keys get new backend routes and storage. The backend generates a random gateway secret on create, returns the plaintext only in that create response, stores only SHA256 hash plus metadata, and exposes only previews in later list responses. This preserves the existing security model: authentication never needs plaintext at rest.

## Non-Goals

This slice does not build request logs, 24h KPI aggregation, metrics collection, or security-notice policy evaluation. Those remain static or mock-backed until a telemetry-focused spec is written.

This slice does not store full gateway keys, re-display full keys after creation, add billing/audit logging, or redesign the dashboard layout.

## Backend Design

Add a `gateway-key-store` module under `src/admin/`. It owns gateway-key records and keeps the storage contract separate from Vertex credential storage.

A gateway-key record contains `id`, `label`, `preview`, `status`, `createdAt`, optional `revokedAt`, and `hash`. The hash is SHA256 of the generated plaintext key. The plaintext key is returned only from create and is never written to disk.

In `file-store` mode, gateway-key metadata and hashes are persisted in the existing admin file-store directory. The implementation should extend the existing admin `store.json` state object if that stays localized; otherwise it should use a separate `gateway-keys.json` file in the same directory. In `static-config` mode, list responses expose config-backed keys as read-only records with generated previews and no mutable metadata.

## Admin API

Add these authenticated admin routes under `/admin/api`:

- `GET /gateway-keys`: returns `{ mode, mutable, gatewayKeys }` with sanitized records only.
- `POST /gateway-keys`: requires writable admin mode, accepts `{ label }`, generates a new key, persists the hash and metadata, and returns `{ ok, gatewayKey, secret }` once.
- `POST /gateway-keys/:id/revoke`: requires writable admin mode, marks the key revoked, reloads runtime auth state if needed, and returns `{ ok, gatewayKey }`.

The create response must be the only response that contains the full secret. The list and revoke responses must never include plaintext.

Runtime auth must accept both existing config keys and active managed gateway keys. Revoked managed keys must fail authentication. Existing env/config keys remain backward-compatible and are not silently removed or rewritten by the dashboard.

## Frontend Design

Add an admin data hook or small API module that loads both real resources after an admin token is present:

- `GET /admin/api/vertex-credentials`
- `GET /admin/api/gateway-keys`

`Dashboard.tsx` stops importing `vertexTargets` and `gatewayKeys` from `mockData.ts`. It keeps static `securityNotices` and any out-of-scope KPI/log data until their own slice.

The existing tables remain mostly unchanged, but they should receive loading, empty, and error states. `GatewayKeyDialog` submits to the real create endpoint. After create succeeds, the UI shows the returned secret once with copy affordance and makes clear it will not be shown again.

`VertexTargetDialog` can support the existing API-key target workflow first. Service-account import can remain a later enhancement unless it is already simple to expose without changing the dialog concept. The frontend must preserve backend error messages where useful, especially read-only mode and auth failures.

## Error Handling

Admin API errors should use the existing `GatewayError` and `sendJson` patterns. Mutation endpoints must reject in `static-config` mode and when `adminAllowMutations` is false. Invalid labels should be normalized to a default label rather than failing unless they exceed a reasonable length.

Frontend requests should treat missing admin token as an unauthenticated idle state, not a failed request. A 401 should keep the dashboard visible and show an actionable auth error. Create/revoke failures should keep dialogs or table state intact so the operator can retry.

## Data Flow

1. Operator enters admin token.
2. Dashboard loads Vertex target records and gateway-key records with `adminFetch`.
3. Vertex target rows are derived directly from sanitized backend records.
4. Gateway-key rows come from the new sanitized gateway-key API.
5. Creating a gateway key returns one plaintext secret, refreshes the table, and displays the secret once.
6. Revoking a gateway key updates persisted metadata and causes future client requests with that key to fail gateway authentication.

## Security Requirements

Do not store gateway-key plaintext in the admin file store, config overlay, logs, tests, or frontend state beyond the create-success UI state.

Do not include plaintext gateway keys in list, revoke, health, or runtime snapshot responses. Secret previews should be short and non-sensitive, such as prefix plus last four characters when available.

Use constant-time comparison for managed hashes just like existing config-key auth. Never weaken the current gateway/admin token distinction.

## Testing And Validation

Backend tests should cover gateway-key creation, hash-only persistence, list sanitization, revoke behavior, read-only rejection, and runtime auth accepting active managed keys while rejecting revoked keys.

Frontend validation should cover TypeScript build and lint. Add focused frontend tests only if the current project already has a frontend test harness suitable for hooks or table behavior; otherwise keep validation to build/lint for this slice.

Manual validation should include creating a key, copying the returned secret, confirming it authenticates against a protected gateway route, revoking it, and confirming the same secret is rejected afterward.

## Implementation Boundaries

Keep edits scoped to admin storage/routes/auth, frontend admin API wiring, and the affected dashboard components. Do not refactor unrelated routing, request classification, model catalog behavior, API logs, or KPI widgets.

If existing `credential-store.ts` becomes too broad when adding gateway keys, split the new gateway-key behavior into its own module rather than growing credential storage responsibilities further.
