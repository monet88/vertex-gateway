# PR #6 - Unresolved Review Threads Report

> **Date**: 06-07-2026
> **PR**: [#6 Admin Dashboard](https://github.com/monet88/vertex-gateway/pull/6)
> **Verified against**: current branch after local fixes
> **Code status**: 5 fixed in this pass, 1 already fixed before this pass, 0 remaining code issues from this report
> **GitHub status**: thread resolution not performed in this pass

---

## Outcome Summary

| Thread | Severity | Area | Current outcome |
|---|---:|---|---|
| [#14](https://github.com/monet88/vertex-gateway/pull/6#discussion_r3526471448) | P1 | Admin token bootstrap | Fixed: bootstrap rejects admin tokens matching managed gateway key hashes. |
| [#11](https://github.com/monet88/vertex-gateway/pull/6#discussion_r3526424053) | P1 | Config reload | Fixed: app reload re-hydrates managed key hashes before swapping active config. |
| [#12](https://github.com/monet88/vertex-gateway/pull/6#discussion_r3526424061) | P2 | Service account dialog | Fixed: closing the dialog clears pasted credential JSON. |
| [#13](https://github.com/monet88/vertex-gateway/pull/6#discussion_r3526424065) | P2 | Gateway key rollback | Fixed: rollback is best-effort and no longer masks the original error. |
| [#6](https://github.com/monet88/vertex-gateway/pull/6#discussion_r3526199579) | P2 | API-key target duplicate ID | Already fixed: duplicate IDs are rejected instead of silently replacing. |
| [#15](https://github.com/monet88/vertex-gateway/pull/6#discussion_r3526471449) | P3 | JSON file-store helpers | Fixed: shared JSON file-store helper extracted and reused. |

---

## Fix Details

### Thread #14 - Admin Token Overlap With Managed Gateway Keys

**Status**: Fixed locally.

`src/admin/admin-routes.ts` now checks the candidate admin token against `config.managedGatewayKeyHashes` with `verifyManagedGatewayKey` before persisting the bootstrap token. This keeps the admin-token boundary separate from both static gateway keys and managed gateway keys.

Regression coverage added in `test/admin-routes.test.ts`: `rejects admin token bootstrap when it overlaps a managed gateway key`.

### Thread #11 - Stale Managed Gateway Key Hashes On Admin Reload

**Status**: Fixed locally.

`src/app.ts` now passes every incoming admin-derived config through `hydrateManagedGatewayKeyHashes` before `runtime.reload()` and before replacing `activeConfig`. This preserves active managed keys after unrelated file-store mutations such as adding a Vertex target.

Regression coverage added in `test/admin-routes.test.ts`: `keeps managed gateway keys active after unrelated admin config reloads`.

### Thread #12 - Service Account Dialog Retains Pasted JSON

**Status**: Fixed locally.

`frontend/src/components/console/ServiceAccountTargetDialog.tsx` now resets its draft state when the dialog closes, unless a pending submit intentionally blocks close. This clears the pasted service account JSON from component state on close/reopen.

Verified by `frontend` production build.

### Thread #13 - Rollback Failure Masks Original Error

**Status**: Fixed locally.

`src/admin/gateway-key-store.ts` now restores previous records through a best-effort wrapper and rethrows the original persistence/reload error. The same wrapper is used for both create and revoke failure paths.

Regression coverage added in `test/gateway-key-store.test.ts`: `preserves the original error when rollback also fails`.

### Thread #6 - Duplicate API-Key Vertex Target ID

**Status**: Already fixed before this pass.

Current `src/admin/admin-routes.ts` rejects a duplicate API-key target ID inside the `updateVertexPools` mutator before appending the new credential. Existing coverage already confirms this behavior in `test/admin-routes.test.ts`: `rejects duplicate API-key Vertex targets instead of replacing them`.

No additional code change was needed for this thread.

### Thread #15 - Duplicate JSON File-Store Helpers

**Status**: Fixed locally.

Added `src/lib/json-file-store.ts` with shared `readJsonIfExists` and `writeJsonAtomic` helpers. `src/admin/credential-store.ts`, `src/admin/gateway-key-store.ts`, and `src/config/admin-settings-store.ts` now reuse that helper instead of carrying duplicate local implementations.

---

## Validation

Passed:

```text
npm test -- admin-routes gateway-key-store
# 2 test files passed, 25 tests passed

npm run compile
# TypeScript compile passed

Set-Location -LiteralPath 'F:\CodeBase\vertex-gateway\frontend'; npm run build
# frontend TypeScript/Vite build passed
```

Invalid command observed and ignored:

```text
npm run build
# root package has no build script
```

---

## Remaining Action

No code issue remains from this report. After the branch is pushed, the six corresponding GitHub review threads can be resolved; this pass did not perform GitHub thread resolution.

---

## Follow-up Unresolved Thread Scan

After fetching all unresolved PR #6 review threads from GitHub, two additional active test-quality findings were confirmed and fixed locally:

- `test/genai-pool.test.ts`: set `upstreamRetries: 0` in the bind-first failover test so the expected call sequence validates single-attempt failover instead of retry behavior.
- `test/root-routes.test.ts`: split the negative endpoint assertions so `/vertex/`, `/vtx/`, and `/api/images/` leaks each fail independently.

Additional unresolved review threads were verified as already fixed or superseded by current code, including frontend revoke error handling, dashboard error/loading display, active OpenAI catalog resolution, managed-key hash rehydration, service-account dialog clearing, rollback error preservation, admin-token overlap, and shared JSON file-store helpers.

Follow-up validation:

```text
npm test -- admin-routes gateway-key-store genai-pool root-routes
# 4 test files passed, 51 tests passed

npm run compile
# TypeScript compile passed

Set-Location -LiteralPath 'F:\CodeBase\vertex-gateway\frontend'; npm run build
# frontend TypeScript/Vite build passed
```
