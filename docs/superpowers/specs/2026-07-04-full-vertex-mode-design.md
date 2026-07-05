# Full Vertex Mode for API Key Targets

## Status

Approved design. Implementation plan pending.

## Context

The gateway currently treats any upstream target with an `apiKey` as Vertex / Agent Platform express mode. In that path, `createGoogleGenAiClientForTarget` initializes the Google GenAI SDK with `vertexai: true` and `apiKey`, intentionally omitting `project` and `location`.

That behavior is valid for express mode, but it is wrong for the intended operating model where the operator creates multiple Google Cloud projects, creates one API key per project, and expects the gateway pool to round-robin across those project-scoped Vertex / Agent Platform targets. In that model, upstream requests must be sent to the full Vertex resource path for the selected target:

```text
/projects/{project}/locations/{location}/publishers/google/models/{model}
```

Live verification showed that API-key-only requests can be resolved by Google to a location that does not match the configured pool target. Some Gemini 3 image models still worked in that context, but `gemini-2.5-flash-image` failed through the gateway while succeeding when called through the full Vertex endpoint with `project` and `location=global`.

## Goals

- Support full Vertex / Agent Platform mode for API key targets.
- Keep express mode available for future admin UI selection.
- Preserve service account behavior.
- Preserve existing route handlers and pool selection behavior.
- Keep backward compatibility for existing configs where possible.
- Avoid logging or exposing upstream API keys.

## Non-goals

- Replace service account SDK auth with manual OAuth REST calls.
- Redesign pool selection, failover, or model catalog behavior.
- Build the admin UI in this change.
- Remove express mode support.

## API Key Mode

Add an explicit mode to upstream pool targets:

```ts
export type VertexApiKeyMode = "full" | "express";
```

Extend `VertexPoolConfig`:

```ts
export interface VertexPoolConfig {
  id: string;
  project: string;
  location: string;
  credentialsFile: string | null;
  apiKey: string | null;
  apiKeyMode: VertexApiKeyMode;
  enabled: boolean;
  weight: number;
  modelAllowlist: string[];
  modelExclusions: string[];
}
```

### Mode semantics

- `apiKeyMode: "full"`: use the API key against the full Vertex / Agent Platform endpoint for the selected target's `project` and `location`.
- `apiKeyMode: "express"`: use the existing SDK API-key-only path.
- Service account targets do not use `apiKeyMode` for upstream auth. They continue to use SDK project/location auth.

### Backward compatibility

When `apiKeyMode` is omitted:

- If a target has `apiKey`, `project`, and `location`, normalize to `"full"`.
- If a target has `apiKey` but lacks usable `project` or `location`, normalize to `"express"`.
- If a target has no `apiKey`, normalize to `"full"` or ignore the field for behavior.

This keeps legacy express-only configs possible while making the current project/location-based pool configuration run in full mode by default.

### Validation

- `apiKeyMode` must be either `"full"` or `"express"`.
- `apiKeyMode: "full"` with an API key requires non-empty `project` and `location`.
- `apiKeyMode: "express"` requires an API key, but `project` and `location` may still exist for display or future admin UI use.
- If both `apiKey` and `credentialsFile` are configured, preserve the existing priority: `apiKey` wins.

## Architecture

Keep `GenAiClient` as the internal boundary:

```ts
export interface GenAiClient {
  models: {
    generateContent(
      request: Record<string, unknown>,
      metadata?: GenAiRequestMetadata,
    ): Promise<Record<string, unknown>>;
    generateContentStream?(
      request: Record<string, unknown>,
      metadata?: GenAiRequestMetadata,
    ): Promise<AsyncIterable<Record<string, unknown>>>;
  };
}
```

Change the target client factory into a selector:

```text
apiKey + apiKeyMode=full
  -> Vertex REST API-key client

apiKey + apiKeyMode=express
  -> GoogleGenAI SDK apiKey-only client

no apiKey
  -> GoogleGenAI SDK project/location service-account or ADC client
```

Create a new module:

```text
src/lib/vertex-rest-client.ts
```

The REST client implements `GenAiClient`, so existing pool and route code continue to call `models.generateContent` and `models.generateContentStream` without knowing which upstream auth mode is in use.

## Full Vertex REST Client

### Endpoint construction

For `location === "global"`:

```text
https://aiplatform.googleapis.com/v1/projects/{project}/locations/global/publishers/google/models/{model}:generateContent
```

For regional locations:

```text
https://{location}-aiplatform.googleapis.com/v1/projects/{project}/locations/{location}/publishers/google/models/{model}:generateContent
```

Streaming uses the same resource with `streamGenerateContent`:

```text
.../models/{model}:streamGenerateContent?alt=sse
```

### Authentication

Use the API key as a header:

```text
x-goog-api-key: {apiKey}
```

The key must never be logged. Error messages and diagnostic logs must redact API keys if any URL or header is surfaced.

### Request mapping

Gateway route handlers already produce SDK-like request objects:

```ts
{
  model: "gemini-3.5-flash",
  contents: [...],
  config: {...}
}
```

The REST client must:

1. Validate that `model` is a non-empty string.
2. Put `model` into the URL path.
3. Send the remaining fields as the JSON body.

The upstream body must not include `model`, because the Vertex model is encoded in the resource path.

### Streaming mapping

`generateContentStream` calls the SSE endpoint and returns an `AsyncIterable<Record<string, unknown>>`. The parser should:

- Read the response body as text chunks.
- Split SSE events by blank lines.
- For each `data:` field, parse JSON and yield it.
- Ignore keepalive/comment lines.
- Stop cleanly on EOF.

If the stream setup returns a non-2xx status, throw an upstream error before yielding chunks.

## Error Handling

- Non-2xx REST responses throw an error carrying the upstream HTTP status and message.
- The thrown shape should remain compatible with the existing upstream error classifier and pool failover logic.
- `AbortSignal` from request metadata must be passed to `fetch`.
- Client timeout must respect `upstreamTimeoutMs`.
- Request bodies can contain user data, so diagnostics should avoid logging raw payloads.
- Readiness and admin views may expose target mode metadata, but not API key values.

## Route and Pool Impact

No route handler should need full rewrites. These flows continue through `GenAiClient`:

- Gemini-compatible routes
- OpenAI chat completions
- OpenAI responses
- OpenAI image generations and edits
- Vertex-compatible routes
- vtx shorthand routes
- Custom image routes

`GenAiPoolClient` selection, retries, cooldowns, and route-family health buckets should remain unchanged. The selected target's client determines the upstream auth mode.

## Admin UI Compatibility

This design creates a stable backend seam for a future admin UI toggle:

```text
API key mode: [Full Vertex] [Express]
```

The admin backend only needs to persist `apiKeyMode`. Existing fields `project`, `location`, and `apiKey` remain sufficient for full mode.

## Example Target

```json
{
  "id": "monet-ai-4",
  "label": "Monet AI 4",
  "project": "monet-ai-4",
  "location": "global",
  "apiKey": "...",
  "apiKeyMode": "full",
  "credentialsFile": null,
  "enabled": true,
  "weight": 1,
  "modelAllowlist": [],
  "modelExclusions": []
}
```

If `apiKeyMode` is omitted from this target, the loader should normalize it to `"full"` because `apiKey`, `project`, and `location` are all present.

## Test Plan

### Config tests

- Legacy target with `apiKey`, `project`, and `location` defaults to `apiKeyMode: "full"`.
- Explicit `apiKeyMode: "express"` remains express even if project/location are present.
- Invalid `apiKeyMode` fails config loading with a clear validation error.
- `apiKeyMode: "full"` fails if project or location is missing.

### Client factory tests

- Full API-key target creates the REST client and does not initialize SDK apiKey-only mode.
- Express API-key target keeps the current SDK behavior: `apiKey` present and no `project` or `location` in SDK options.
- Service account target keeps SDK project/location and google auth options behavior.

### REST client tests

- `generateContent` builds the correct global endpoint.
- `generateContent` builds the correct regional endpoint.
- Requests include `x-goog-api-key`.
- Request body omits `model` and preserves `contents` and `config`.
- Non-2xx responses throw an upstream error with the status.
- `generateContentStream` parses SSE `data:` events into JSON chunks.

### Validation commands

Run after implementation:

```bash
npm test
npm run compile
```

Optional live local verification after Docker rebuild:

```bash
docker compose up -d --build
```

Then verify through the gateway:

- `gemini-2.5-flash-image` returns `200` when target mode is full and location is `global`.
- Gemini 3 image models still return `200`.
- Text models still return `200`.

## Risks and Mitigations

- **Risk: REST response shape differs from SDK response shape.** Mitigation: use Vertex `generateContent` endpoints that return the same Gemini response structure consumed by existing route converters.
- **Risk: Streaming parser edge cases.** Mitigation: unit-test multi-event chunks, split events, comments, and non-2xx setup errors.
- **Risk: Config migration surprises.** Mitigation: default only API-key targets with both project and location to full mode, while retaining explicit express mode.
- **Risk: Secret exposure in diagnostics.** Mitigation: never log headers, never log API keys, and redact key-like values in any error paths that include URLs.
