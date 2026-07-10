# Backend Hot-Path Throughput Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lower gateway-local overhead (then improve safe throughput) on the live request path via measure-first benches and ranked fixes F1/F2/F5 (+ conditional F7, F8 verify).

**Architecture:** Keep zero-framework `node:http` hot path. Add env-gated Vitest benches under `test/bench/`. Prehash static gateway keys at hydrate/reload; extract key once per request; O(1) RR candidate membership. No production stage clocks — bench uses mock clients / boundary timing only.

**Tech Stack:** Node 22+, TypeScript, Vitest, existing `createApp` / pool / auth modules.

**Spec source:** `docs/superpowers/specs/2026-07-09-backend-hot-path-throughput-design.md` (§12–§13 grilled locks)

## Global Constraints

- Overhead-first; pool mode primary; mock upstream for M2
- Risk envelope B — no auth/stream/pool semantic breaks
- F3 demoted (keep non-stream AbortController + listeners + abortSignal)
- F4/F6 demoted unless proven
- F7 only if S1 C=1 Δp50 or Δp99 ≥ 5% (logs-on vs muted-in-bench)
- No frontend / deploy / commit unless user asks
- `npm test` stays green and fast (benches skip without `RUN_BENCH=1`)
- Report: `plans/reports/09-07-2026-backend-hot-path-throughput.md`

## File map

| File | Responsibility |
|------|----------------|
| Modify `src/config/env.ts` | `gatewayKeyDigests: Buffer[]` on `GatewayConfig`; populate on load/derive |
| Modify `src/admin/gateway-key-store.ts` | Hydrate always attaches digests from `gatewayKeys` |
| Modify `src/auth/gateway-auth.ts` | F1 return key; F2 compare prehashed digests |
| Modify `src/app.ts` | Use returned key; no double extract |
| Modify `src/lib/genai-pool.ts` | F5 RR Set; optional F7 target_selected |
| Modify `test/test-config.ts` | Include digests |
| Modify `test/auth.test.ts` | Return value + prehash path |
| Modify `test/genai-pool.test.ts` | RR sequence equivalence if needed |
| Create `test/bench/hot-path-m1.test.ts` | Auth + pool microbench |
| Create `test/bench/hot-path-m2.test.ts` | S1–S3 HTTP integration bench |
| Create `plans/reports/09-07-2026-backend-hot-path-throughput.md` | Before/after numbers |

---

### Task 1: Benches (M1 + M2) env-gated

**Files:**
- Create: `test/bench/hot-path-m1.test.ts`
- Create: `test/bench/hot-path-m2.test.ts`

- [ ] M1: auth ops/s for key counts 1/4/16; pool select for 2/8/32 targets
- [ ] M2: pool mode ≥2 mock targets; S1/S2/S3; W=50 M=200 C=1; S1/S3 also C=10
- [ ] S2: 3 zero-delay chunks; TTFB + drain
- [ ] Log-cost helper: mute `console.info` for `request.complete` / `target_selected` via spy
- [ ] `describe.skipIf(process.env.RUN_BENCH !== '1')`
- [ ] Verify `npm test` does not run expensive body (skip)

### Task 2: F1 + F2 auth

**Files:**
- `src/config/env.ts`, `src/admin/gateway-key-store.ts`, `src/auth/gateway-auth.ts`, `src/app.ts`, `test/test-config.ts`, `test/auth.test.ts`

- [ ] Add `gatewayKeyDigests`
- [ ] Hydrate/load/derive/testConfig populate digests
- [ ] `requireGatewayAuth` → `string`; one candidate SHA-256; timingSafeEqual vs digests; then managed
- [ ] `app.ts`: `gatewayKey = requireGatewayAuth(...)`
- [ ] Auth unit tests pass

### Task 3: F5 pool RR

**Files:**
- `src/lib/genai-pool.ts`, `test/genai-pool.test.ts` (or bench equivalence)

- [ ] `selectRoundRobinTarget` uses `Set` of candidate ids
- [ ] Existing pool tests still pass; optional sequence test

### Task 4: Baseline + log-cost + F7/F8

- [ ] Run `RUN_BENCH=1` baseline (or post-fix if benches land with fixes in same PR — record first green bench after package as after; if possible run before commits of F1/F2/F5)
- [ ] Log-cost pass S1 C=1
- [ ] F7 if ≥5%; else document skip
- [ ] F8: audit `maybeRecordApiCall` early return; harden only if needed

### Task 5: Validate + report

- [ ] `npm test`
- [ ] Re-measure M1/M2
- [ ] Write `plans/reports/09-07-2026-backend-hot-path-throughput.md`
- [ ] No commit unless asked

## Implementation order (this session)

1. Spec §12–13 done  
2. Plan done  
3. Implement F1/F2/F5 + benches together  
4. Run tests + benches  
5. F7 decision from numbers  
6. Report  
