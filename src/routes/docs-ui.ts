const OPENAI_MODELS = [
  'gemini-3.5-flash',
  'gemini-3.1-pro-preview',
  'gemini-3.1-flash-lite',
  'gemini-2.5-flash',
  'gemini-2.5-pro',
] as const;

const IMAGE_MODELS = [
  'gemini-2.5-flash-image',
  'gemini-3.1-flash-image-preview',
  'gemini-3.1-flash-image',
  'gemini-3.1-flash-lite-image',
  'gemini-3-pro-image-preview',
  'gemini-3-pro-image',
] as const;

const escapeHtml = (value: string): string => value
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;');

const block = (label: string, content: string): string => `
  <div class="snippet">
    <div class="snippet-bar">
      <span>${escapeHtml(label)}</span>
      <button class="copy-btn" type="button" data-copy="${escapeHtml(content)}">Copy</button>
    </div>
    <pre><code>${escapeHtml(content)}</code></pre>
  </div>
`;

const listItems = (items: readonly string[]): string => items
  .map((item) => `<li><code>${escapeHtml(item)}</code></li>`)
  .join('');

export const renderDocsUi = (origin: string): string => {
  const baseUrl = origin.replace(/\/+$/, '');
  const openAiChatCurl = `curl ${baseUrl}/openai/v1/chat/completions \\
  -H "Authorization: Bearer YOUR_GATEWAY_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "gemini-2.5-flash",
    "messages": [{"role": "user", "content": "Reply with exactly: OPENAI_OK"}],
    "max_tokens": 64
  }'`;
  const openAiResponsesCurl = `curl ${baseUrl}/openai/v1/responses \\
  -H "Authorization: Bearer YOUR_GATEWAY_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "gemini-2.5-flash",
    "input": "Reply with exactly: RESPONSES_OK",
    "max_output_tokens": 64
  }'`;
  const geminiCurl = `curl ${baseUrl}/gemini/v1beta/models/gemini-2.5-flash:generateContent \\
  -H "Authorization: Bearer YOUR_GATEWAY_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "contents": [
      {
        "role": "user",
        "parts": [{"text": "Reply with exactly: GEMINI_OK"}]
      }
    ]
  }'`;
  const imageCurl = `curl ${baseUrl}/openai/v1/images/generations \\
  -H "Authorization: Bearer YOUR_GATEWAY_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "gemini-2.5-flash-image",
    "prompt": "Generate a tiny red square icon on white background",
    "size": "1024x1024"
  }'`;
  const streamingFetch = `const response = await fetch('${baseUrl}/openai/v1/chat/completions', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer YOUR_GATEWAY_KEY',
  },
  body: JSON.stringify({
    model: 'gemini-2.5-flash',
    stream: true,
    messages: [{ role: 'user', content: 'Stream a short response' }],
  }),
});

const reader = response.body.getReader();
const decoder = new TextDecoder();
let buffer = '';

while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  buffer += decoder.decode(value, { stream: true });
  console.log(buffer);
}`;
  const javascriptFetch = `const response = await fetch('${baseUrl}/openai/v1/chat/completions', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer YOUR_GATEWAY_KEY',
  },
  body: JSON.stringify({
    model: 'gemini-2.5-flash',
    messages: [{ role: 'user', content: 'Say hello from my app' }],
    max_tokens: 128,
  }),
});

const data = await response.json();
console.log(data);`;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Vertex Gateway Docs</title>
    <style>
      :root {
        color-scheme: dark;
        --bg: #07111d;
        --bg-soft: #0d1828;
        --panel: rgba(10, 18, 30, 0.86);
        --panel-strong: rgba(15, 25, 42, 0.96);
        --panel-muted: rgba(255, 255, 255, 0.03);
        --line: rgba(140, 173, 234, 0.16);
        --line-strong: rgba(140, 173, 234, 0.26);
        --ink: #eef5ff;
        --muted: #97acc9;
        --accent: #82f7ff;
        --accent-2: #95ffb8;
        --accent-3: #ffcd84;
        --shadow: 0 28px 80px rgba(0, 0, 0, 0.42);
        --radius-xl: 32px;
        --radius-lg: 24px;
        --radius-md: 18px;
        --radius-sm: 12px;
      }
      * { box-sizing: border-box; }
      html, body {
        margin: 0;
        min-height: 100%;
        scroll-behavior: smooth;
      }
      body {
        font-family: "Outfit", "Segoe UI", sans-serif;
        color: var(--ink);
        background:
          radial-gradient(circle at 12% 16%, rgba(93, 148, 255, 0.20), transparent 22%),
          radial-gradient(circle at 88% 12%, rgba(130, 247, 255, 0.12), transparent 20%),
          radial-gradient(circle at 50% 100%, rgba(149, 255, 184, 0.08), transparent 24%),
          linear-gradient(180deg, #060e19 0%, #0a1422 48%, #08111d 100%);
      }
      body::before {
        content: "";
        position: fixed;
        inset: 0;
        pointer-events: none;
        background-image:
          linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px),
          linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px);
        background-size: 28px 28px;
        mask-image: radial-gradient(circle at center, black, transparent 78%);
        opacity: 0.2;
      }
      a {
        color: inherit;
        text-decoration: none;
      }
      code, pre {
        font-family: "IBM Plex Mono", "Cascadia Code", monospace;
      }
      .shell {
        width: min(1280px, calc(100% - 32px));
        margin: 0 auto;
        padding: 24px 0 72px;
      }
      .hero {
        position: relative;
        overflow: hidden;
        border: 1px solid var(--line);
        border-radius: var(--radius-xl);
        background:
          linear-gradient(135deg, rgba(14, 24, 40, 0.97) 0%, rgba(9, 17, 28, 0.92) 58%, rgba(8, 23, 36, 0.96) 100%);
        box-shadow: var(--shadow);
        padding: 36px;
      }
      .hero::after {
        content: "";
        position: absolute;
        inset: auto -120px -120px auto;
        width: 340px;
        height: 340px;
        border-radius: 50%;
        background: radial-gradient(circle, rgba(130, 247, 255, 0.18) 0%, transparent 68%);
      }
      .hero-top {
        display: flex;
        justify-content: space-between;
        gap: 18px;
        align-items: flex-start;
        flex-wrap: wrap;
      }
      .badge {
        display: inline-flex;
        align-items: center;
        gap: 10px;
        border-radius: 999px;
        padding: 9px 14px;
        background: rgba(130, 247, 255, 0.1);
        color: var(--accent);
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.16em;
        text-transform: uppercase;
      }
      .hero h1 {
        margin: 18px 0 0;
        max-width: 12ch;
        font-size: clamp(48px, 8vw, 94px);
        line-height: 0.92;
        letter-spacing: -0.07em;
        text-wrap: balance;
      }
      .hero-copy {
        margin-top: 22px;
        max-width: 62ch;
        color: var(--muted);
        font-size: 18px;
        line-height: 1.75;
      }
      .hero-grid {
        display: grid;
        grid-template-columns: 1.15fr 0.85fr;
        gap: 22px;
        margin-top: 32px;
      }
      .glass {
        border: 1px solid var(--line);
        border-radius: var(--radius-lg);
        background: var(--panel);
        box-shadow: var(--shadow);
        backdrop-filter: blur(16px);
      }
      .quick-card {
        padding: 20px;
      }
      .quick-card h2 {
        margin: 0 0 12px;
        font-size: 18px;
      }
      .kv-list {
        display: grid;
        gap: 12px;
      }
      .kv {
        padding: 14px;
        border-radius: 16px;
        border: 1px solid var(--line);
        background: rgba(255,255,255,0.03);
      }
      .kv strong {
        display: block;
        margin-bottom: 6px;
        color: var(--accent);
        font-size: 11px;
        letter-spacing: 0.14em;
        text-transform: uppercase;
      }
      .kv span {
        color: var(--ink);
        font-size: 15px;
        line-height: 1.55;
      }
      .base-card {
        padding: 20px;
        display: grid;
        gap: 16px;
      }
      .eyebrow {
        color: var(--accent-3);
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.18em;
        text-transform: uppercase;
      }
      .base-url {
        display: inline-flex;
        max-width: 100%;
        overflow-x: auto;
        border-radius: 999px;
        border: 1px solid rgba(149, 255, 184, 0.22);
        background: rgba(149, 255, 184, 0.08);
        color: var(--accent-2);
        padding: 11px 14px;
        font-size: 14px;
        font-weight: 600;
      }
      .nav {
        position: sticky;
        top: 18px;
        z-index: 2;
        margin: 24px 0 0;
        padding: 14px;
        border-radius: 999px;
        border: 1px solid var(--line);
        background: rgba(8, 16, 29, 0.86);
        backdrop-filter: blur(16px);
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
      }
      .nav a {
        padding: 10px 14px;
        border-radius: 999px;
        color: var(--muted);
        font-size: 14px;
        transition: background 180ms ease, color 180ms ease, transform 180ms ease;
      }
      .nav a:hover {
        color: var(--ink);
        background: rgba(255,255,255,0.07);
        transform: translateY(-1px);
      }
      .section {
        margin-top: 28px;
        padding: 26px;
      }
      .section h2 {
        margin: 0;
        font-size: 28px;
        letter-spacing: -0.04em;
        text-wrap: balance;
      }
      .section p {
        max-width: 66ch;
        color: var(--muted);
        line-height: 1.75;
      }
      .grid {
        display: grid;
        gap: 18px;
      }
      .grid.two {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
      .card {
        padding: 18px;
        border-radius: var(--radius-md);
        border: 1px solid var(--line);
        background: rgba(255,255,255,0.03);
      }
      .card h3 {
        margin: 0 0 10px;
        font-size: 18px;
      }
      .card ul {
        margin: 0;
        padding-left: 18px;
        color: var(--muted);
      }
      .pill {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        margin: 6px 8px 0 0;
        padding: 9px 12px;
        border-radius: 999px;
        border: 1px solid var(--line);
        background: rgba(255,255,255,0.04);
        color: var(--ink);
        font-size: 13px;
      }
      .snippet {
        margin-top: 16px;
        border-radius: 18px;
        overflow: hidden;
        border: 1px solid rgba(130, 247, 255, 0.14);
        background: #030914;
      }
      .snippet-bar {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        align-items: center;
        padding: 12px 14px;
        background: linear-gradient(180deg, rgba(255,255,255,0.03), rgba(255,255,255,0.01));
        border-bottom: 1px solid rgba(130, 247, 255, 0.1);
        color: var(--muted);
        font-size: 12px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }
      pre {
        margin: 0;
        padding: 18px;
        overflow-x: auto;
        color: #d5ebff;
        line-height: 1.65;
        font-size: 13px;
      }
      .copy-btn {
        border: 1px solid rgba(130, 247, 255, 0.18);
        border-radius: 999px;
        padding: 8px 12px;
        background: rgba(130, 247, 255, 0.08);
        color: var(--accent);
        cursor: pointer;
        transition: background 180ms ease, transform 180ms ease, color 180ms ease;
      }
      .copy-btn:hover {
        background: rgba(130, 247, 255, 0.14);
        transform: translateY(-1px);
      }
      .copy-btn.copied {
        color: var(--accent-2);
        border-color: rgba(149, 255, 184, 0.24);
        background: rgba(149, 255, 184, 0.1);
      }
      .route {
        display: grid;
        gap: 8px;
        padding: 14px 0;
        border-top: 1px solid rgba(255,255,255,0.06);
      }
      .route:first-child {
        border-top: 0;
        padding-top: 0;
      }
      .route code {
        color: var(--ink);
      }
      .callout {
        padding: 16px 18px;
        border-radius: var(--radius-md);
        border: 1px solid rgba(255, 205, 132, 0.18);
        background: rgba(255, 205, 132, 0.08);
        color: #ffdca8;
      }
      .footer {
        margin-top: 28px;
        padding: 18px 24px;
        display: flex;
        justify-content: space-between;
        gap: 12px;
        flex-wrap: wrap;
        color: var(--muted);
        font-size: 14px;
      }
      @media (max-width: 980px) {
        .hero-grid, .grid.two {
          grid-template-columns: 1fr;
        }
      }
      @media (max-width: 720px) {
        .shell {
          width: min(100%, calc(100% - 20px));
        }
        .hero, .section {
          padding: 20px;
        }
        .hero h1 {
          max-width: none;
        }
      }
    </style>
  </head>
  <body>
    <main class="shell">
      <section class="hero">
        <div class="hero-top">
          <div class="badge">Vertex Gateway Docs</div>
          <div class="base-url">${escapeHtml(baseUrl)}</div>
        </div>
        <div class="hero-grid">
          <div>
            <h1>One HTTPS surface for Gemini, OpenAI, and image workloads.</h1>
            <p class="hero-copy">
              Integrate this gateway when you want app teams to ship against a stable public interface
              while the VPS handles Vertex credentials, model routing, and image-compatible workloads
              behind the scenes.
            </p>
          </div>
          <div class="glass quick-card">
            <h2>Use this first</h2>
            <div class="kv-list">
              <div class="kv">
                <strong>Auth Header</strong>
                <span><code>Authorization: Bearer YOUR_GATEWAY_KEY</code></span>
              </div>
              <div class="kv">
                <strong>Health Checks</strong>
                <span><code>/healthz</code> for liveness, <code>/readyz</code> for runtime readiness.</span>
              </div>
              <div class="kv">
                <strong>Best Fit</strong>
                <span>Apps already speaking OpenAI or teams needing direct Gemini-compatible routes.</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <nav class="nav">
        <a href="#auth">Auth</a>
        <a href="#health">Health</a>
        <a href="#gemini">Gemini</a>
        <a href="#openai">OpenAI</a>
        <a href="#streaming">Streaming</a>
        <a href="#images">Images</a>
        <a href="#models">Models</a>
      </nav>

      <section class="section glass" id="auth">
        <div class="eyebrow">Authentication</div>
        <h2>Protect the gateway key like a backend secret.</h2>
        <p>
          All model and image routes require a gateway API key. The public docs use
          <code>YOUR_GATEWAY_KEY</code> as a placeholder. Issue real keys to teams out of band,
          and prefer server-to-server calls when you do not want browser clients to hold the key.
        </p>
        ${block('auth header', 'Authorization: Bearer YOUR_GATEWAY_KEY')}
      </section>

      <section class="section glass" id="health">
        <div class="eyebrow">Health</div>
        <h2>Start every integration with health and readiness.</h2>
        <div class="grid two">
          <div class="card">
            <h3><code>GET /healthz</code></h3>
            <p>Fast liveness signal for load balancers and uptime checks.</p>
          </div>
          <div class="card">
            <h3><code>GET /readyz</code></h3>
            <p>Returns runtime mode, route switches, Google auth mode, and request limits.</p>
          </div>
        </div>
      </section>

      <section class="section glass" id="gemini">
        <div class="eyebrow">Gemini-Compatible</div>
        <h2>Use direct Gemini-style paths when the client already speaks Gemini.</h2>
        <div class="route">
          <strong><code>GET /gemini/v1beta/models</code></strong>
          <span>Lists available Gemini-facing model ids.</span>
        </div>
        <div class="route">
          <strong><code>POST /gemini/v1beta/models/{model}:generateContent</code></strong>
          <span>Sync text or multimodal generation.</span>
        </div>
        <div class="route">
          <strong><code>POST /gemini/v1beta/models/{model}:streamGenerateContent</code></strong>
          <span>Streaming generation over the Gemini compatibility surface.</span>
        </div>
        ${block('gemini curl', geminiCurl)}
      </section>

      <section class="section glass" id="openai">
        <div class="eyebrow">OpenAI-Compatible</div>
        <h2>Drop in for apps already written against OpenAI-style clients.</h2>
        <div class="grid two">
          <div class="card">
            <h3>Text and Responses</h3>
            <ul>
              <li><code>GET /openai/v1/models</code></li>
              <li><code>POST /openai/v1/chat/completions</code></li>
              <li><code>POST /openai/v1/responses</code></li>
            </ul>
          </div>
          <div class="card">
            <h3>Images</h3>
            <ul>
              <li><code>POST /openai/v1/images/generations</code></li>
              <li><code>POST /openai/v1/images/edits</code></li>
            </ul>
          </div>
        </div>
        ${block('openai chat curl', openAiChatCurl)}
        ${block('openai responses curl', openAiResponsesCurl)}
      </section>

      <section class="section glass" id="streaming">
        <div class="eyebrow">Streaming</div>
        <h2>For live output, use streamed chat or Gemini stream routes.</h2>
        <p>
          The gateway supports streamed chat via the OpenAI-compatible surface and streamed content
          generation via Gemini routes. Consume the response body as a stream and
          forward chunks to your UI.
        </p>
        ${block('javascript streaming example', streamingFetch)}
      </section>

      <section class="section glass" id="images">
        <div class="eyebrow">Image Workloads</div>
        <h2>Generate or edit images without exposing Vertex credentials to app teams.</h2>
        <p>
          The OpenAI-compatible image route returns a base64 payload under <code>data[].b64_json</code>.
          Use image-capable models explicitly to avoid accidental fallback to text-only variants.
        </p>
        <div class="callout">
          Prefer explicit image-capable model ids such as <code>gemini-2.5-flash-image</code> for
          generation and image workflows.
        </div>
        ${block('image generation curl', imageCurl)}
      </section>

      <section class="section glass" id="models">
        <div class="eyebrow">Models</div>
        <h2>Current model ids exposed by this gateway.</h2>
        <div class="grid two">
          <div class="card">
            <h3>Text / General</h3>
            <ul>${listItems(OPENAI_MODELS)}</ul>
          </div>
          <div class="card">
            <h3>Image</h3>
            <ul>${listItems(IMAGE_MODELS)}</ul>
          </div>
        </div>
        <p>
          If a request fails validation after a model update, compare the model id against
          <code>/openai/v1/models</code> or the gateway operator's allowlist before debugging payload shape.
        </p>
        ${block('javascript fetch example', javascriptFetch)}
      </section>

      <footer class="glass footer">
        <span>Public docs for <code>${escapeHtml(baseUrl)}</code></span>
        <span>Use <code>/readyz</code> when you need runtime and auth diagnostics.</span>
      </footer>
    </main>
    <script>
      const copyButtons = document.querySelectorAll('.copy-btn');
      for (const button of copyButtons) {
        button.addEventListener('click', async () => {
          const payload = button.getAttribute('data-copy') || '';
          try {
            await navigator.clipboard.writeText(payload);
            const original = button.textContent;
            button.textContent = 'Copied';
            button.classList.add('copied');
            setTimeout(() => {
              button.textContent = original;
              button.classList.remove('copied');
            }, 1400);
          } catch {
            button.textContent = 'Copy failed';
            setTimeout(() => {
              button.textContent = 'Copy';
            }, 1400);
          }
        });
      }
    </script>
  </body>
</html>`;
};

export const renderLlmsTxt = (origin: string): string => {
  const baseUrl = origin.replace(/\/+$/, '');
  return `# Vertex Gateway

Public integration surface for the Chang Store Vertex Gateway.

## Canonical Docs
- ${baseUrl}/docs : Main developer integration guide
- ${baseUrl}/healthz : Liveness check
- ${baseUrl}/readyz : Readiness and runtime details

## API Surfaces
- ${baseUrl}/gemini/v1beta/models : Gemini-compatible model list
- ${baseUrl}/openai/v1/models : OpenAI-compatible model list
- ${baseUrl}/openai/v1/chat/completions : OpenAI-compatible chat
- ${baseUrl}/openai/v1/responses : OpenAI-compatible responses
- ${baseUrl}/openai/v1/images/generations : OpenAI-compatible image generation
- ${baseUrl}/openai/v1/images/edits : OpenAI-compatible image edits

## Notes
- Protected API routes require Authorization: Bearer YOUR_GATEWAY_KEY
- Use ${baseUrl}/docs for cURL, JavaScript, image, and streaming examples
- Use ${baseUrl}/readyz to inspect runtime mode, route toggles, limits, and Google auth status
`;
};
