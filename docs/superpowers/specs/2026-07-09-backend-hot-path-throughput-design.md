# Backend Hot-Path Throughput & Latency Design

**Date:** 2026-07-09  
**Status:** Approved for implementation planning  
**Repo:** `vertex-gateway`  
**Approach:** Measure-first + ranked ROI fixes (Approach 2)

---

## 1. Goal

Maximize **gateway-local** request throughput and minimize end-to-end **gateway overhead** latency on the live request path of `vertex-gateway` (Node.js `node:http`, zero-framework proxy to Google Vertex/Gemini + OpenAI-compatible surfaces).

Primary order of optimization:

1. Lower p50/p99 **gateway overhead** (time spent in Node before/around mock or real upstream work)
2. Then improve **safe concurrency / throughput** under load

Every claimed win must be backed by numbers from the same bench protocol. Correctness, auth, streaming contracts, pool failover, and security must not regress.

### Non-goals

- Redesigning or restyling admin UI / `DESIGN.md` cosmetics
- Migrating to Express / Fastify / Nest or any new HTTP framework
- Rewriting server architecture
- Disabling retries/failover “for speed”
- Unbounded concurrency that can melt upstream quotas
- Optimizing live Vertex model latency as the primary metric (upstream-dominated)
- Committing, pushing, or deploying unless explicitly requested later
- Inventing benchmarks that were not run

---

## 2. Decisions (locked)

| Topic | Decision |
|-------|----------|
| Primary objective | **C** — both overhead and throughput; **overhead first** |
| Workloads to measure | OpenAI chat **non-stream**, OpenAI chat **stream**, Gemini **generateContent** non-stream |
| Measurement stack | **D** — microbench → HTTP integration (mock upstream); live only optional sanity |
| Runtime mode | **C** — **pool mode** primary; single mode regression-check only |
| Risk envelope | **B** — safe wins + controlled/gated high-ROI changes; no aggressive semantics breaks |
| Method | Approach 2 — measure baseline, rank bottlenecks, implement top fixes, re-measure |

---

## 3. Current hot-path map

### 3.1 Call path (live API request)

```text
createServer (src/app.ts)
  → createRequestContext (request id + startedAt + log helper)
  → maybeHandleAdminRoute (short-circuit; out of scope unless it blocks hot path)
  → applyCors
  → public routes: /, /docs, /llms.txt, /healthz, /readyz (not optimization targets)
  → classifyRoute (method + pathname)
  → requireGatewayAuth + extractGatewayKey
  → readJsonBody (POST) | {} (GET / multipart image edit exception)
  → model alias resolve (gemini path model / openai body.model)
  → isStreamingRequest
  → stream AbortController + socket listeners + streamAdmission.acquire (if streaming + key)
  → resolveRouteDispatch(family).run(...)
       → Gemini strategy | OpenAI chat/responses/images | workloads
       → GenAiRuntime / GenAiPoolClient
            → pin snapshot (refCount)
            → selectAvailableTarget / withFailover
            → target.client.models.generateContent | generateContentStream
            → markSuccess / markFailure / cooldown
  → response JSON or SSE
  → finally: maybeRecordApiCall (diagnostics gate) + ctx.log('request.complete')
```

### 3.2 Expensive nodes already visible in code (pre-measure hypotheses)

These are **candidates**, not proven rankings. Baseline must confirm or demote them.

| Node | Evidence in code | Why potentially expensive |
|------|------------------|---------------------------|
| Gateway auth | `constantTimeEqual` hashes **both** strings every compare; `config.gatewayKeys.some(...)` | O(keys) SHA-256 per request |
| Double key extract | `requireGatewayAuth` + later `extractGatewayKey` in `app.ts` | Duplicate header work |
| Pool RR select | `candidates.some` inside RR loop in `genai-pool.ts` | O(targets × candidates) |
| Success logging | `console.info(JSON.stringify(...))` on `request.complete` and `genai_pool.target_selected` | Sync stringify + console on every request |
| Non-stream stream setup | AbortController + 4 listeners even when only streaming uses admission | Alloc/listener churn on S1/S3 |
| Object copies | `{ ...classified }`, `{ ...body }` every request | Alloc when no mutation needed |
| API call log | Early-return when diagnostics gate off | Should be ~free when off; verify |

### 3.3 Architecture invariants to preserve

- `GatewayConfig` is the validated API boundary; no per-request env/file re-reads on the hot path.
- `classifyRoute` stays pure (method + path only).
- Two auth concepts stay separate: gateway key (client→gateway) vs upstream credentials (gateway→Google).
- `GenAiClient` remains the only upstream call interface for routes/strategies/workloads.
- Pool snapshot pin/`refCount`: in-flight requests must not lose their snapshot on reload.
- Abort/cancel must not mark healthy targets as failed.
- Public API: Gemini + OpenAI surfaces, status codes, error envelopes, streaming semantics, rejected OpenAI fields.

---

## 4. Measurement design

### 4.1 Placement and runner

- Prefer files under `test/bench/` or `test/*hot-path*.bench.ts`.
- Reuse: `createApp`, `testConfig`, mock `genAiFactory` / `runtimeFactory`, pool overrides.
- **Default `npm test` stays green and fast.**
- Benches are **env-gated Vitest** (e.g. `RUN_BENCH=1`), no new heavy harness dependencies.

Documented run command (exact script may be refined in the implementation plan):

```bash
# Example — finalize in implementation plan
RUN_BENCH=1 npx vitest --run --config vitest.config.ts test/bench
```

### 4.2 M1 — Micro benches (no HTTP)

| Bench | Subject | Parameters |
|-------|---------|------------|
| Auth | Gateway key verify path | Multiple configured keys; valid + invalid |
| Pool select | RR / bind-first selection under healthy targets | 2, 8, 32 targets; allowlist filter path |
| Optional | Small JSON parse, model resolve | Only if M2 points here |

Metrics: ops/s or ns/op after warmup (e.g. 5k–50k iterations). Record Node version and OS for context only.

### 4.3 M2 — HTTP integration benches (mock upstream)

Full `createApp` on `127.0.0.1:0`, **pool mode** with ≥2 healthy mock targets.

| ID | Scenario | Request | Mock |
|----|----------|---------|------|
| **S1** | OpenAI chat non-stream | `POST /openai/v1/chat/completions`, small messages, `stream: false` | Instant `generateContent` fixed JSON |
| **S2** | OpenAI chat stream | same, `stream: true` | Async iterable, few small chunks |
| **S3** | Gemini generateContent | Classified Gemini generateContent path used in existing tests | Instant fixed JSON |

**Metrics (before and after, same machine/command):**

| Metric | Definition |
|--------|------------|
| p50 / p99 latency | Client-observed RTT with mock upstream ~0 work |
| Throughput | Stable req/s at fixed concurrency C (e.g. 1, 10, 50 non-stream; lower C for stream) |
| Stream extras (S2) | TTFB + full drain for fixed chunk count |

**Protocol:**

1. Warmup W requests (discard)
2. Measure M requests or fixed wall time T
3. Identical W/M/C for before and after
4. Primary numbers: diagnostics API call log **off**
5. Optional second pass with diagnostics **on** to quantify log cost
6. Report only measured numbers — never invent results

Single mode: one smoke per scenario after fixes (regression), not the optimization target.

### 4.4 Success criteria (done when all true)

1. Hot-path bottlenecks identified with evidence (code path + why expensive; bench numbers when claiming cost).
2. At least the top **3** highest-ROI backend speed fixes implemented — or fewer if baseline shows only N real wins, with explicit documentation of why.
3. Existing tests still pass for touched areas (`npm test`).
4. Before/after metrics reported for S1–S3 (pool) under the same protocol.
5. No auth / security / stream-contract / pool-failover regressions.
6. Summary lists: what changed, what did not, residual risk, next 3 fastest wins.

**Not required for done:** multi-machine CI perf gates, live Vertex p99 campaigns, perfect flamegraphs.

---

## 5. Optimization priority (strict)

1. Eliminate per-request waste (sync CPU, JSON parse/stringify, copies, repeated auth, repeated config work).
2. Reduce await waterfalls / serial work that can be parallel or skipped.
3. Stream path efficiency (backpressure, buffering, SSE parse, premature materialization).
4. Pool selection / client reuse / connection reuse / auth token cache locality.
5. Allocation pressure (object churn, buffer copies, hot-path logging).
6. Only then: micro-optimizations.

Ignore low-ROI cleanups unless free with a real fix.

---

## 6. Candidate fix backlog

Ship only if measured or clearly free with a measured sibling fix. IDs are stable for the plan.

### Tier 1 — Per-request waste

| ID | Fix | Where | Why faster | Risk | Validation |
|----|-----|-------|------------|------|------------|
| **F1** | Extract gateway key once; reuse for auth, stream admission, log preview | `src/app.ts`, `src/auth/gateway-auth.ts` | Avoid double extract | Low | Auth tests + M2 |
| **F2** | Prehash configured gateway keys at hydrate/config load; compare candidate digest once with `timingSafeEqual` | `gateway-auth.ts`, hydrate path | Stop N× dual SHA-256 per request | Medium — must stay timing-safe | Auth unit (valid/invalid/managed) + M1 |
| **F3** | Skip stream machinery on non-stream (no AbortController/listeners/admission when not streaming), unless a path already requires abort for non-stream upstream timeout | `src/app.ts` | Less alloc on S1/S3 | Medium | Streaming tests + non-stream regression |
| **F4** | Avoid useless shallow copies of route/body when no mutation | `src/app.ts` | Less object churn | Low | Model rewrite paths + M2 |

### Tier 2 — Pool selection locality

| ID | Fix | Where | Why faster | Risk | Validation |
|----|-----|-------|------------|------|------------|
| **F5** | RR selection: candidate id `Set` (or single filter) instead of nested `some` | `src/lib/genai-pool.ts` | O(n²) → O(n) | Low if order/semantics identical | `genai-pool` tests + M1 |
| **F6** | Reduce repeated full-array filter/sort on success path if profiled | `genai-pool.ts` | Less alloc under load | Medium — health/cooldown correctness | Failover tests |

**Pool invariant:** selection policy (RR vs bind-first), failover, cooldown, model allowlist/exclusions, abort-not-penalize, snapshot pin — **unchanged in behavior**.

### Tier 3 — Logging / allocation (controlled)

| ID | Fix | Where | Why faster | Risk | Validation |
|----|-----|-------|------------|------|------------|
| **F7** | Reduce success-path high-frequency logs (`request.complete`, `genai_pool.target_selected`) after measuring cost — sample, debug-only, or cheaper fields | `request-context.ts`, `genai-pool.ts` | Less sync stringify/console | Medium — ops visibility | Document policy; keep error/failover/cooldown logs |
| **F8** | Verify API call log path is zero-cost when diagnostics gate off | `app.ts`, diagnostics cache | No hidden hot-path cost | Low | Diagnostics tests |

### Tier 4 — Stream / translation (only if S2 or chat path loses)

| ID | Fix | Where | Why faster | Risk | Validation |
|----|-----|-------|------------|------|------------|
| **F9** | SSE write/buffer: avoid double serialize / needless buffering | SSE helpers, OpenAI stream routes, `vertex-rest-client` | Stream CPU | Medium | `streaming-routes`, `stream-contract-proof` |
| **F10** | OpenAI content translation / tool-call stringify only when needed | `openai-content`, chat/responses routes | Chat CPU | Low–Medium | OpenAI route tests |

### Explicitly out of this effort (unless baseline proves catastrophic)

- Server framework rewrite
- Retry/failover policy changes for speed
- Removing stream admission or unbounded concurrency
- Deep connection-pool rewrites beyond existing client reuse
- Frontend/admin feature work
- Live multi-region latency campaigns

---

## 7. Implementation phases

### Phase 0 — Map hot path

Trace S1 and S2 (and S3) end-to-end; keep the map in §3 updated if code differs at implement time.

### Phase 1 — Baseline

- Add env-gated M1 + M2 benches
- Run baseline; record table for S1–S3 + micro auth/pool
- Optional: diagnostics-on pass for log cost

### Phase 2 — Rank bottlenecks

Inspect only hot-path files. Rank by expected ROI using baseline + code evidence. Update backlog order if data contradicts hypotheses.

### Phase 3 — Implement top fixes

- One logical fix group at a time
- Tight diffs; no speculative abstractions
- Prefer F1–F5 (and F7 if log cost is material) first
- F6/F8–F10 only if ranked high after re-measure
- Risk envelope B: if a “fast” change risks correctness, skip or isolate behind existing config/diagnostics patterns

### Phase 4 — Validate

- Targeted unit/integration tests for touched modules
- Stream/pool/route tests as relevant
- Before/after same scenario
- Full `npm test`
- If a test fails: fix once; if still blocked, stop and report

### Phase 5 — Report

1. Hot-path map  
2. Bottleneck ranking with evidence  
3. Changes made (files + why faster)  
4. Metrics before/after  
5. What was deliberately not changed  
6. Residual risks  
7. Next 3 fastest remaining wins  

---

## 8. Correctness & security guardrails

| Area | Must hold |
|------|-----------|
| Gateway auth | Timing-safe compare; no secrets in logs; invalid → 401 with same codes |
| Managed keys | Hash verify path still works after F1/F2 |
| Pool | Pin/refCount, failover, cooldown, abort isolation unchanged |
| Stream | SSE framing, first-chunk retry, admission limits, abort cleanup |
| Errors | Same `GatewayError` codes; OpenAI vs gateway error envelope |
| API contracts | Status codes, body shapes, rejected OpenAI fields still rejected |
| Diagnostics log | Best-effort; never throws into client response path |
| Secrets | No `accounts/*.json` touch; no credential leakage |

---

## 9. Test plan

| Layer | What |
|-------|------|
| Existing suite | `npm test` — auth, pool, streaming, openai, app routes as affected |
| New unit | Prehash auth; pool select equivalence (same sequence for fixed RR cursor + candidates) |
| Bench | `RUN_BENCH=1` M1+M2 before and after |
| Live | Optional one-shot sanity only; not a success gate |

---

## 10. Scope lock

### Allowed

- `src/**` hot-path modules listed in §3 and candidate fixes
- `test/**` for correctness + env-gated benches
- Minimal docs only if a config knob affecting speed is introduced (prefer reusing existing diagnostics/config patterns)

### Forbidden without explicit approval

- `frontend/**` feature work
- Docker/deploy/VPS changes
- Dependency major upgrades
- Public route contract changes
- Commit/push/deploy (unless user asks later)

---

## 11. Delivery constraints

- Prefer smallest high-impact diffs over rewrites
- Reuse existing modules/utilities
- No new framework
- Report numbers, not vibes
- Local truth > generic advice

---

## 12. Open implementation details — RESOLVED (grilled 2026-07-09)

| Detail | Resolution |
|--------|------------|
| Bench files | `test/bench/hot-path-m1.test.ts`, `test/bench/hot-path-m2.test.ts` |
| Vitest gate | `describe.skipIf(process.env.RUN_BENCH !== '1')`; keep `include: ['test/**/*.test.ts']`; no required npm script |
| Run command | `RUN_BENCH=1 npx vitest --run test/bench` (PowerShell: `$env:RUN_BENCH=1`) |
| M2 protocol | W=50, M=200; C=1 primary; +C=10 throughput for S1/S3; S2 C=1 |
| S2 mock | 3 chunks, delay 0; measure TTFB + full drain |
| M1 auth | W=2k, M=20k; configured keys 1/4/16; valid + invalid |
| M1 pool | W=2k, M=20k; healthy targets 2/8/32; one allowlist-filter case |
| Metrics | Client RTT p50/p99 + throughput to claim wins; stage set for ranking only |
| Stages | `auth`, `body_parse`, `pool_select`, `upstream_mock`, `dispatch_total`, `response_finalize` |
| Stage clocks | Bench-only via test doubles / boundary hooks — **no** production hot-path stage timers |
| F7 policy | Measure-first: S1 C=1 logs-on vs muted-in-bench; ship if Δp50 **or** Δp99 ≥ 5%. Demote `genai_pool.target_selected` success info; keep/minify `request.complete`; never touch error/failover/cooldown logs |
| F3 | **Demoted** — non-stream keeps AbortController + socket listeners + `abortSignal` (cancel contract). Admission already streaming-only |
| Report | `plans/reports/09-07-2026-backend-hot-path-throughput.md` |

No product TBD remains for the optimization goal, workloads, measurement stack, risk envelope, or fix classes.

---

## 13. Decision log (grilled 2026-07-09)

| # | Topic | Decision |
|---|--------|----------|
| 1 | Primary claim metrics | **B** — client RTT p50/p99 + throughput; rank with stages |
| 2 | Stage instrumentation | **A** — bench-only |
| 3 | Stage set | **B** — hot-map 6 |
| 4 | M2 W/M/C | **A** — W50/M200/C1 + C10 throughput S1/S3 |
| 5 | F3 non-stream abort | **A** — demote; keep cancel path |
| 6 | Auth F1+F2 | **A** — ship both after baseline (skip only if ~0 ROI) |
| 7 | Pool F5/F6 | **A** — ship F5; demote F6 |
| 8 | F7 success logs | **A** — measure-first conditional |
| 9 | How to measure stages | **A** — test doubles / boundary hooks |
| 10 | F4 shallow copies | **A** — demote |
| 11 | Done definition | **A** — default package F1+F2+F5 + conditional F7 + F8 verify |
| 12 | F8 diagnostics path | **A** — verify-only; harden if not free |
| 13 | Bench layout | **A** — `test/bench/` two files, no required npm scripts |
| 14 | M1 params | **A** — see §12 |
| 15 | F9/F10 escalate | **A** — tight; max one group after package |
| 16 | Log-cost pass | **A** — required before F7 ship/skip |
| 17 | F7 material threshold | **A** — ≥5% p50 or p99 on S1 C=1 |
| 18 | Vitest include | **A** — `*.test.ts` + `RUN_BENCH` skipIf |
| 19 | F2 digest storage | **A** — digests on config via hydrate/reload; keep plaintext keys |
| 20 | F1 API shape | **A** — `requireGatewayAuth` returns validated key string |
| 21 | Results report | **A** — single file under `plans/reports/` |
| 22 | Docs before code | **A** — update design + write plan, then implement |
| 23+ | Remainder | Recommendations auto-locked (S2=3 chunks; plan path under `docs/superpowers/plans/`; no commit/push unless asked) |

### Default implementation package

1. Env-gated M1/M2 benches + baseline  
2. Log-cost pass (S1)  
3. Ship **F1**, **F2**, **F5** (document skip only if ~0 ROI)  
4. **F7** only if threshold met  
5. **F8** verify; minimal harden if needed  
6. Re-measure S1–S3; single-mode smoke; `npm test`  
7. Report with numbers  

**Explicitly demoted unless baseline forces revisit:** F3, F4, F6.
