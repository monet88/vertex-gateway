const escapeHtml = (value: string): string => value
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const safeJsonScript = (value: unknown): string => JSON.stringify(value)
  .replace(/</g, '\\u003c')
  .replace(/>/g, '\\u003e')
  .replace(/&/g, '\\u0026');

// Legacy rollback renderer. The live /admin route serves the React SPA from frontend/dist.
export const renderAdminUi = (): string => {
  const bootstrapState = {
    provider: 'gemini',
    views: ['dashboard', 'ai-providers', 'auth-files', 'available-models', 'logs-viewer', 'model-management'],
  };

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Gateway Admin</title>
    <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0' x2='1' y1='0' y2='1'%3E%3Cstop stop-color='%23ffe66e'/%3E%3Cstop offset='1' stop-color='%238df4ff'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='64' height='64' rx='18' fill='url(%23g)'/%3E%3Cpath d='M19 32 32 19l13 13-13 13Z' fill='none' stroke='%23372b1d' stroke-width='3.5'/%3E%3Ccircle cx='32' cy='32' r='6' fill='none' stroke='%23372b1d' stroke-width='3'/%3E%3C/svg%3E" />
    <style>
      :root {
        color-scheme: light;
        --bg: #f4f0e8;
        --bg-deep: #ece5d9;
        --panel: rgba(255, 255, 255, 0.88);
        --panel-strong: #ffffff;
        --ink: #1e1b16;
        --muted: #7b746b;
        --line: #ddd3c4;
        --line-strong: #cfc1af;
        --accent: #7d7366;
        --accent-strong: #61584d;
        --accent-soft: #efe8de;
        --accent-tint: #f7f2ea;
        --success: #1d9b6c;
        --success-soft: #dcf5ea;
        --danger: #d55b4a;
        --danger-soft: #fde3df;
        --warn: #a96c2c;
        --warn-soft: #f8e8d3;
        --shadow: 0 18px 46px rgba(35, 24, 9, 0.08);
        --shadow-soft: 0 10px 24px rgba(35, 24, 9, 0.05);
        --radius-lg: 24px;
        --radius-md: 18px;
        --radius-sm: 12px;
      }
      * { box-sizing: border-box; }
      html, body { min-height: 100%; }
      body {
        margin: 0;
        font-family: "IBM Plex Sans", "Segoe UI", sans-serif;
        color: var(--ink);
        background:
          radial-gradient(circle at top center, rgba(255, 229, 168, 0.42), transparent 20%),
          radial-gradient(circle at bottom left, rgba(142, 194, 255, 0.12), transparent 24%),
          linear-gradient(180deg, #fcfaf6 0%, var(--bg) 45%, var(--bg-deep) 100%);
      }
      button, input, textarea, select { font: inherit; }
      .hidden { display: none !important; }
      .app-root {
        min-height: 100vh;
      }
      .login-screen {
        min-height: 100vh;
        display: grid;
        place-items: center;
        padding: 28px;
      }
      .login-card {
        width: min(100%, 620px);
        padding: 48px 34px 36px;
        border: 1px solid var(--line);
        border-radius: 28px;
        background: rgba(255, 255, 255, 0.88);
        box-shadow: var(--shadow);
        backdrop-filter: blur(12px);
        text-align: center;
      }
      .brand-mark {
        width: 74px;
        height: 74px;
        margin: 0 auto 28px;
        border-radius: 18px;
        border: 3px solid rgba(255,255,255,0.75);
        background:
          linear-gradient(135deg, #ffe66e 0%, #8df4ff 100%);
        box-shadow: 0 16px 30px rgba(98, 161, 212, 0.28);
        display: grid;
        place-items: center;
        position: relative;
      }
      .brand-mark::before,
      .brand-mark::after {
        content: "";
        position: absolute;
        inset: 16px;
        border: 2px solid rgba(63, 47, 28, 0.82);
        transform: rotate(45deg);
        border-radius: 6px;
      }
      .brand-mark::after {
        inset: 24px;
        border-radius: 999px;
        transform: rotate(0deg);
        clip-path: polygon(50% 0%, 100% 35%, 78% 100%, 20% 100%, 0% 35%);
      }
      .login-card h1 {
        margin: 0;
        font-size: clamp(32px, 4vw, 52px);
        line-height: 1.02;
        letter-spacing: -0.05em;
      }
      .login-card p {
        margin: 14px auto 0;
        max-width: 38rem;
        color: var(--muted);
        font-size: 18px;
        line-height: 1.6;
      }
      .login-shell {
        margin-top: 28px;
        display: grid;
        gap: 16px;
        text-align: left;
      }
      .login-panel {
        border: 1px solid var(--line);
        border-radius: 20px;
        background: rgba(255,255,255,0.9);
        padding: 18px;
      }
      .login-toolbar {
        display: flex;
        justify-content: center;
      }
      .field, .field-row {
        display: grid;
        gap: 8px;
      }
      .field-row {
        grid-template-columns: 1fr;
      }
      label {
        font-size: 14px;
        color: var(--muted);
      }
      input[type="text"],
      input[type="password"],
      input[type="number"],
      input[type="url"],
      textarea,
      select {
        width: 100%;
        border: 1px solid var(--line);
        border-radius: 14px;
        padding: 13px 14px;
        background: #fff;
        color: var(--ink);
      }
      textarea {
        min-height: 110px;
        resize: vertical;
      }
      input:focus,
      textarea:focus,
      select:focus {
        outline: 2px solid rgba(63, 124, 255, 0.12);
        border-color: rgba(63, 124, 255, 0.35);
      }
      .remember-row {
        display: flex;
        align-items: center;
        gap: 10px;
        color: var(--muted);
        font-size: 14px;
      }
      .login-actions {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 12px;
      }
      .btn {
        border: 0;
        border-radius: 14px;
        padding: 13px 16px;
        background: var(--accent);
        color: #fff;
        cursor: pointer;
        transition: transform 140ms ease, opacity 140ms ease, background 140ms ease;
      }
      .btn:hover:not(:disabled) {
        transform: translateY(-1px);
        background: var(--accent-strong);
      }
      .btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
      .btn.secondary {
        background: #ece7df;
        color: var(--ink);
      }
      .btn.danger {
        background: var(--danger);
      }
      .pill {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        border-radius: 999px;
        padding: 7px 12px;
        font-size: 12px;
        font-weight: 600;
        border: 1px solid transparent;
      }
      .pill.success { background: var(--success-soft); color: var(--success); }
      .pill.warn { background: var(--warn-soft); color: var(--warn); }
      .pill.danger { background: var(--danger-soft); color: var(--danger); }
      .pill.neutral { background: #f2ede7; color: var(--accent-strong); }
      .login-status,
      .global-status {
        margin-top: 6px;
        padding: 12px 14px;
        border-radius: 14px;
        font-size: 14px;
        background: #f3eee7;
        color: var(--muted);
      }
      .login-status.success,
      .global-status.success { background: var(--success-soft); color: var(--success); }
      .login-status.error,
      .global-status.error { background: var(--danger-soft); color: var(--danger); }
      .admin-shell {
        display: grid;
        grid-template-columns: 248px minmax(0, 1fr);
        min-height: 100vh;
      }
      .sidebar {
        border-right: 1px solid var(--line);
        background: rgba(255,255,255,0.82);
        backdrop-filter: blur(18px);
        padding: 22px 16px;
      }
      .sidebar-brand {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 6px 10px 18px;
        border-bottom: 1px solid var(--line);
        margin-bottom: 18px;
      }
      .sidebar-brand strong {
        font-size: 32px;
        letter-spacing: -0.05em;
      }
      .sidebar-section {
        margin-top: 18px;
      }
      .sidebar-section h2 {
        margin: 0 0 10px;
        padding: 0 12px;
        color: #b2a89a;
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: 0.16em;
      }
      .nav-list {
        display: grid;
        gap: 8px;
      }
      .nav-btn {
        display: grid;
        grid-template-columns: 1fr;
        align-items: center;
        gap: 8px;
        width: 100%;
        padding: 11px 12px;
        border: 1px solid transparent;
        border-radius: 16px;
        background: transparent;
        color: var(--ink);
        text-align: left;
        transition: background 140ms ease, border-color 140ms ease, transform 140ms ease;
      }
      .nav-btn:hover {
        background: rgba(255,255,255,0.62);
        border-color: rgba(18,18,18,0.08);
        transform: translateY(-1px);
      }
      .nav-btn.active {
        background: rgba(27, 23, 18, 0.08);
        border-color: rgba(27,23,18,0.1);
        box-shadow: inset 0 1px 0 rgba(255,255,255,0.65);
      }
      .nav-btn strong {
        display: block;
        font-size: 15px;
      }
      .nav-btn span {
        display: block;
        color: var(--muted);
        font-size: 12px;
        margin-top: 2px;
      }
      .content {
        padding: 18px 22px 28px;
      }
      .content-scroll {
        display: grid;
        gap: 16px;
        max-width: 1380px;
        margin: 0 auto;
      }
      .topbar {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 16px;
        border: 1px solid var(--line);
        border-radius: 24px;
        padding: 16px 18px;
        background: var(--panel);
        box-shadow: var(--shadow-soft);
      }
      .topbar h1 {
        margin: 0;
        font-size: clamp(28px, 3vw, 42px);
        letter-spacing: -0.04em;
      }
      .topbar p {
        margin: 4px 0 0;
        color: var(--muted);
        font-size: 14px;
      }
      .topbar-actions {
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
      }
      .panel {
        border: 1px solid var(--line);
        border-radius: var(--radius-lg);
        background: var(--panel);
        box-shadow: var(--shadow-soft);
        padding: 18px;
      }
      .panel h2 {
        margin: 0 0 8px;
        font-size: 17px;
      }
      .panel-subtitle {
        margin: 0 0 14px;
        color: var(--muted);
        font-size: 13px;
        line-height: 1.55;
      }
      .kpi-grid {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 14px;
      }
      .kpi-card {
        padding: 16px;
        border: 1px solid var(--line);
        border-radius: 18px;
        background: rgba(255,255,255,0.95);
      }
      .kpi-card .label {
        display: block;
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: 0.12em;
        color: var(--muted);
      }
      .kpi-card .value {
        display: block;
        margin-top: 10px;
        font-size: 30px;
        font-weight: 700;
        letter-spacing: -0.05em;
      }
      .summary-grid,
      .detail-grid,
      .model-editor-grid,
      .dashboard-grid {
        display: grid;
        gap: 18px;
      }
      .dashboard-grid {
        grid-template-columns: 1.1fr 0.9fr;
        gap: 22px;
      }
      .summary-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
      .detail-grid {
        grid-template-columns: 1.15fr 0.85fr;
      }
      .model-editor-grid {
        grid-template-columns: 1fr 1fr;
        align-items: start;
      }
      .card-grid {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 20px;
      }
      .credential-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(290px, 1fr));
        gap: 14px;
      }
      .metric-list {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 12px;
      }
      .metric-item {
        padding: 12px 14px;
        border: 1px solid var(--line);
        border-radius: 14px;
        background: rgba(255,255,255,0.95);
      }
      .metric-item strong {
        display: block;
        color: var(--muted);
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        margin-bottom: 6px;
      }
      .metric-item span {
        display: block;
        font-size: 18px;
      }
      .auth-chip-row {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
      }
      .auth-chip {
        border: 1px solid var(--line);
        border-radius: 14px;
        padding: 12px 14px;
        background: rgba(255,255,255,0.92);
        color: var(--ink);
        cursor: pointer;
      }
      .auth-chip.active {
        border-color: rgba(78, 123, 255, 0.35);
        background: #eef3ff;
      }
      .toolbar-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 12px;
      }
      .toolbar-grid .field:first-child {
        grid-column: 1 / -1;
      }
      .auth-view-stack {
        display: grid;
        gap: 16px;
      }
      .compact-auth-layout {
        display: grid;
        grid-template-columns: minmax(320px, 0.9fr) minmax(0, 1.1fr);
        gap: 16px;
        align-items: start;
      }
      .compact-panel {
        padding: 16px;
      }
      .compact-panel h2 {
        font-size: 17px;
      }
      .compact-import-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 12px;
      }
      .compact-import-grid .field:last-child {
        grid-column: 1 / -1;
      }
      .toggle-row {
        display: flex;
        align-items: center;
        gap: 12px;
      }
      .toggle-pill {
        position: relative;
        width: 48px;
        height: 28px;
        border: 1px solid var(--line);
        border-radius: 999px;
        background: #e5ddd2;
        flex-shrink: 0;
      }
      .toggle-pill::after {
        content: "";
        position: absolute;
        top: 3px;
        left: 3px;
        width: 20px;
        height: 20px;
        border-radius: 50%;
        background: #fff;
        transition: transform 140ms ease;
      }
      .toggle-pill.active {
        background: #d7ecff;
        border-color: rgba(78, 123, 255, 0.35);
      }
      .toggle-pill.active::after {
        transform: translateX(20px);
      }
      .auth-card {
        border: 1px solid var(--line);
        border-radius: 20px;
        background: rgba(255,255,255,0.95);
        padding: 13px;
        display: grid;
        gap: 10px;
      }
      .auth-card-head {
        display: flex;
        justify-content: space-between;
        gap: 12px;
      }
      .auth-card-title {
        display: flex;
        align-items: center;
        gap: 12px;
      }
      .auth-card-icon {
        width: 40px;
        height: 40px;
        border-radius: 12px;
        display: grid;
        place-items: center;
        background: #dcebff;
        color: #3b65c5;
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.02em;
        flex-shrink: 0;
      }
      .auth-card h3 {
        margin: 0;
        font-size: 16px;
        line-height: 1.15;
      }
      .auth-note {
        margin-top: 4px;
        color: var(--muted);
        font-size: 12px;
      }
      .auth-meta-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 8px;
      }
      .auth-meta-grid .metric-item {
        min-width: 0;
      }
      .auth-meta-grid .metric-item span {
        font-size: 12px;
        line-height: 1.3;
        overflow-wrap: anywhere;
        word-break: break-word;
      }
      .auth-meta-grid .metric-item span.mono,
      .auth-meta-grid .mono {
        font-size: 11px;
        letter-spacing: -0.01em;
      }
      .auth-foot {
        display: flex;
        justify-content: space-between;
        gap: 10px;
        align-items: center;
        border-top: 1px solid var(--line);
        padding-top: 10px;
      }
      .auth-actions {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
      }
      .auth-card-toggle {
        display: flex;
        align-items: center;
        gap: 8px;
        color: var(--muted);
        font-size: 13px;
      }
      .mini-btn {
        border: 1px solid var(--line);
        border-radius: 12px;
        background: #fff;
        color: var(--ink);
        padding: 8px 10px;
        cursor: pointer;
        min-width: 38px;
        min-height: 36px;
        transition: background 140ms ease, border-color 140ms ease, transform 140ms ease;
      }
      .mini-btn:hover:not(:disabled) {
        background: var(--accent-tint);
        border-color: var(--line-strong);
        transform: translateY(-1px);
      }
      .mini-btn.danger {
        border-color: rgba(213, 91, 74, 0.22);
        color: var(--danger);
      }
      .mini-btn.ghost {
        background: #f7f4ee;
      }
      .mini-btn.labelled {
        min-width: 86px;
      }
      .auth-card .pill {
        white-space: nowrap;
      }
      .health-track {
        display: grid;
        grid-template-columns: repeat(12, minmax(0, 1fr));
        gap: 4px;
      }
      .health-track span {
        height: 8px;
        border-radius: 999px;
        background: #e7dfd4;
      }
      .health-track span.ok { background: var(--success); }
      .health-track span.fail { background: var(--danger); }
      .list-shell {
        display: grid;
        gap: 14px;
      }
      .headline-stat {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        border-radius: 999px;
        padding: 8px 14px;
        background: var(--success-soft);
        color: var(--success);
        font-size: 13px;
        font-weight: 600;
      }
      .surface-metrics {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 12px;
        margin-top: 16px;
      }
      .surface-metrics.compact {
        grid-template-columns: repeat(4, minmax(0, 1fr));
      }
      .surface-metric {
        border: 1px solid var(--line);
        border-radius: 16px;
        background: rgba(255,255,255,0.95);
        padding: 14px 16px;
      }
      .surface-metric strong {
        display: block;
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.1em;
        color: var(--muted);
        margin-bottom: 6px;
      }
      .surface-metric span {
        display: block;
        font-size: 22px;
        font-weight: 700;
        letter-spacing: -0.04em;
      }
      .surface-metric small {
        display: block;
        margin-top: 4px;
        color: var(--muted);
        font-size: 12px;
        line-height: 1.45;
      }
      .stack-grid {
        display: grid;
        gap: 12px;
        align-content: start;
        align-items: start;
      }
      .model-summary-strip {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 12px;
        margin-bottom: 16px;
      }
      .model-summary-strip .list-card {
        padding: 14px 16px;
      }
      .editor-card {
        border: 1px solid var(--line);
        border-radius: 20px;
        padding: 16px;
        background: rgba(255,255,255,0.96);
      }
      .editor-card h3 {
        margin: 0;
        font-size: 18px;
      }
      .editor-card p {
        margin: 6px 0 0;
        color: var(--muted);
      }
      .alias-panel {
        margin-top: 12px;
        border: 1px solid var(--line);
        border-radius: 20px;
        background: rgba(255,255,255,0.98);
        overflow: hidden;
        box-shadow: inset 0 1px 0 rgba(255,255,255,0.7);
      }
      .alias-panel-head {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 12px;
        padding: 14px 16px;
        border-bottom: 1px solid var(--line);
        background: linear-gradient(180deg, rgba(255,255,255,0.98) 0%, rgba(248,245,239,0.92) 100%);
      }
      .alias-panel-head h4 {
        margin: 0;
        font-size: 17px;
      }
      .alias-panel-head p {
        margin: 6px 0 0;
        color: var(--muted);
        font-size: 13px;
        line-height: 1.55;
      }
      .alias-list {
        display: grid;
      }
      .alias-row {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto;
        gap: 16px;
        align-items: start;
        padding: 14px 16px;
        border-bottom: 1px solid var(--line);
        background: rgba(255,255,255,0.96);
      }
      .alias-row:last-child {
        border-bottom: 0;
      }
      .alias-row:nth-child(odd) {
        background: rgba(252,251,248,0.98);
      }
      .alias-field {
        display: grid;
        gap: 8px;
      }
      .alias-field label {
        font-size: 12px;
        font-weight: 600;
        letter-spacing: 0.02em;
        color: #6f6458;
      }
      .alias-source-input,
      .alias-target-input,
      .alias-source-custom {
        width: 100%;
        min-height: 42px;
        border: 1px solid #d9cebf;
        border-radius: 14px;
        background: #fff;
        padding: 10px 13px;
        font-size: 14px;
        color: var(--ink);
        box-shadow: inset 0 1px 0 rgba(255,255,255,0.8);
      }
      .alias-source-input:focus,
      .alias-target-input:focus,
      .alias-source-custom:focus {
        outline: 2px solid rgba(99, 139, 255, 0.14);
        border-color: rgba(99, 139, 255, 0.4);
      }
      .alias-source-hint {
        font-size: 12px;
        color: var(--muted);
      }
      .alias-remove {
        border: 1px solid transparent;
        background: transparent;
        color: var(--muted);
        font-size: 24px;
        line-height: 1;
        cursor: pointer;
        padding: 6px 10px;
        border-radius: 12px;
        align-self: start;
        margin-top: 22px;
      }
      .alias-remove:hover {
        color: var(--danger);
        background: rgba(253,227,223,0.7);
        border-color: rgba(213,91,74,0.18);
      }
      .alias-empty {
        padding: 20px;
        color: var(--muted);
        font-size: 14px;
      }
      .provider-card,
      .list-card {
        border: 1px solid var(--line);
        border-radius: 18px;
        background: rgba(255,255,255,0.96);
        padding: 16px;
      }
      .provider-card h3,
      .list-card h3 {
        margin: 0;
        font-size: 18px;
      }
      .provider-card p,
      .list-card p {
        margin: 6px 0 0;
        color: var(--muted);
      }
      .chip-cloud {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 12px;
      }
      .model-chip {
        border: 1px solid var(--line);
        border-radius: 999px;
        padding: 8px 12px;
        background: #fff;
        font-family: "IBM Plex Mono", ui-monospace, monospace;
        font-size: 12px;
      }
      .model-group-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
        gap: 14px;
        margin-top: 16px;
      }
      .catalog-card-head {
        display: flex;
        align-items: start;
        justify-content: space-between;
        gap: 12px;
      }
      .catalog-card-meta {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
        margin-top: 10px;
      }
      .catalog-meta-chip {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border-radius: 999px;
        padding: 6px 10px;
        background: var(--accent-soft);
        color: var(--accent-strong);
        font-size: 12px;
        font-weight: 600;
      }
      .detail-panel-stack {
        display: grid;
        gap: 18px;
      }
      .muted {
        color: var(--muted);
      }
      .mono {
        font-family: "IBM Plex Mono", ui-monospace, monospace;
      }
      .panel-actions {
        display: flex;
        justify-content: space-between;
        gap: 10px;
        align-items: center;
        flex-wrap: wrap;
      }
      .section-actions {
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
      }
      .runtime-json {
        margin: 0;
        border-radius: 18px;
        border: 1px solid var(--line);
        background: #fcfbf8;
        padding: 16px;
        overflow: auto;
        max-height: 420px;
        font-size: 12px;
      }
      .empty-state {
        border: 1px dashed var(--line);
        border-radius: 18px;
        padding: 26px;
        text-align: center;
        color: var(--muted);
        background: rgba(255,255,255,0.8);
      }
      .modal-shell {
        position: fixed;
        inset: 0;
        display: grid;
        place-items: center;
        padding: 24px;
        background: rgba(32, 27, 22, 0.18);
        backdrop-filter: blur(4px);
        z-index: 50;
      }
      .modal-card {
        width: min(100%, 820px);
        max-height: calc(100vh - 48px);
        overflow: auto;
        border: 1px solid var(--line);
        border-radius: 24px;
        background: rgba(255,255,255,0.98);
        box-shadow: var(--shadow);
      }
      .modal-head {
        display: flex;
        justify-content: space-between;
        align-items: start;
        gap: 12px;
        padding: 22px 24px 14px;
        border-bottom: 1px solid var(--line);
      }
      .modal-head h2 {
        margin: 0;
        font-size: 28px;
        letter-spacing: -0.04em;
      }
      .modal-head p {
        margin: 6px 0 0;
        color: var(--muted);
      }
      .modal-body {
        padding: 18px 24px 24px;
        display: grid;
        gap: 16px;
      }
      .modal-grid {
        display: grid;
        grid-template-columns: minmax(0, 0.95fr) minmax(0, 1.05fr);
        gap: 16px;
      }
      .log-toolbar {
        display: grid;
        grid-template-columns: minmax(280px, 1.15fr) auto auto;
        gap: 12px;
        align-items: center;
      }
      .log-pill-row {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      .filter-pill {
        border: 1px solid var(--line);
        border-radius: 999px;
        padding: 8px 12px;
        background: #fff;
        color: var(--muted);
        cursor: pointer;
        font-size: 13px;
      }
      .filter-pill.active {
        border-color: rgba(78, 123, 255, 0.35);
        background: #eef3ff;
        color: var(--ink);
      }
      .log-table {
        display: grid;
        gap: 0;
        border: 1px solid var(--line);
        border-radius: 18px;
        overflow: hidden;
        background: rgba(255,255,255,0.96);
      }
      .log-row,
      .log-head {
        display: grid;
        grid-template-columns: 180px 110px 140px 140px minmax(180px, 1fr) 140px;
        gap: 12px;
        align-items: center;
        padding: 12px 16px;
      }
      .log-head {
        background: #f7f4ee;
        color: var(--muted);
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
      }
      .log-row {
        border-top: 1px solid var(--line);
        font-size: 13px;
      }
      .log-row strong {
        font-size: 13px;
      }
      .log-route-chip {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 28px;
        padding: 6px 10px;
        border-radius: 999px;
        border: 1px solid var(--line);
        background: #fff;
        color: var(--accent-strong);
        font-size: 12px;
        font-weight: 600;
      }
      .log-row-code {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
      }
      .log-detail-stack {
        display: grid;
        gap: 4px;
      }
      .log-detail-stack small {
        color: var(--muted);
        font-size: 11px;
      }
      .log-empty {
        padding: 28px;
        text-align: center;
        color: var(--muted);
      }
      .compact-json {
        min-height: 110px;
        max-height: 180px;
      }
      .model-modal-card {
        width: min(100%, 760px);
      }
      .model-metadata-grid {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 10px;
      }
      .modal-actions {
        display: flex;
        justify-content: flex-end;
        gap: 10px;
        flex-wrap: wrap;
        padding-top: 4px;
      }
      .json-preview {
        min-height: 180px;
        max-height: 260px;
        overflow: auto;
        padding: 14px;
        border: 1px solid var(--line);
        border-radius: 16px;
        background: #fcfbf8;
        font-size: 12px;
      }
      .sr-only {
        position: absolute;
        width: 1px;
        height: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
        border: 0;
      }
      @media (max-width: 1240px) {
        .card-grid,
        .kpi-grid,
        .summary-grid,
        .detail-grid,
        .model-editor-grid,
        .dashboard-grid,
        .surface-metrics,
        .toolbar-grid,
        .compact-auth-layout,
        .compact-import-grid,
        .modal-grid,
        .log-toolbar,
        .model-metadata-grid {
          grid-template-columns: 1fr;
        }
        .log-row,
        .log-head {
          grid-template-columns: 1fr;
        }
        .model-summary-strip {
          grid-template-columns: 1fr;
        }
        .alias-row {
          grid-template-columns: 1fr;
        }
        .alias-remove {
          margin-top: 0;
          padding-top: 0;
        }
      }
      @media (max-width: 980px) {
        .admin-shell {
          grid-template-columns: 1fr;
        }
        .sidebar {
          border-right: 0;
          border-bottom: 1px solid var(--line);
        }
        .content {
          padding: 18px;
        }
      }
      @media (max-width: 720px) {
        .login-card {
          padding: 32px 20px 26px;
        }
        .login-actions {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </head>
  <body>
    <div class="app-root">
      <section id="login-screen" class="login-screen">
        <div class="login-card">
          <div class="brand-mark" aria-hidden="true"></div>
          <h1>Gateway Admin</h1>
          <div class="login-toolbar">
            <div class="field" style="max-width:160px;width:100%">
              <label for="language-select" class="sr-only">Language</label>
              <select id="language-select">
                <option>English</option>
              </select>
            </div>
          </div>
          <p>Login with the admin account to access the management interface.</p>

          <form id="login-form" class="login-shell">
            <div class="login-panel">
              <div class="field">
                <label>Current URL</label>
                <strong id="current-url" style="font-size:18px">${escapeHtml('http://localhost:19089/admin')}</strong>
                <span class="muted">The system will automatically use the current gateway admin origin for connection.</span>
              </div>
            </div>

            <div class="field">
              <label for="username-input">Username</label>
              <input id="username-input" type="text" autocomplete="username" value="admin" />
            </div>

            <div class="field">
              <label for="password-input">Password</label>
              <input id="password-input" type="password" autocomplete="current-password" placeholder="Enter admin password" />
            </div>

            <div id="password-change-panel" class="login-panel hidden">
              <div class="field">
                <label for="current-password-input">Current password</label>
                <input id="current-password-input" type="password" autocomplete="current-password" placeholder="Current admin password" />
              </div>
              <div class="field" style="margin-top:12px">
                <label for="new-password-input">New password</label>
                <input id="new-password-input" type="password" autocomplete="new-password" placeholder="At least 8 characters, not changeme" />
              </div>
              <button id="change-password-btn" type="button" class="btn" style="margin-top:14px;width:100%">Change password</button>
            </div>

            <div class="login-actions">
              <button id="login-btn" type="submit" class="btn">Login</button>
              <button id="login-clear-btn" type="button" class="btn secondary">Clear</button>
            </div>

            <div id="login-status" class="login-status">Use admin / changeme on first login, then change the password.</div>
          </form>
        </div>
      </section>

      <div id="admin-shell" class="admin-shell hidden">
        <aside class="sidebar">
          <div class="sidebar-brand">
            <div class="brand-mark" style="width:54px;height:54px;margin:0"></div>
            <div>
              <div class="muted" style="font-size:12px;text-transform:uppercase;letter-spacing:0.14em">Admin</div>
              <strong>Gateway</strong>
            </div>
          </div>

          <div class="sidebar-section">
            <h2>Operate</h2>
            <div class="nav-list">
              <button type="button" class="nav-btn active" data-view="dashboard">
                <span><strong>Dashboard</strong><span>Operations overview</span></span>
              </button>
            </div>
          </div>

          <div class="sidebar-section">
            <h2>Gateway</h2>
            <div class="nav-list">
              <button type="button" class="nav-btn" data-view="ai-providers">
                <span><strong>AI Providers</strong><span>Upstream model routing</span></span>
              </button>
              <button type="button" class="nav-btn" data-view="auth-files">
                <span><strong>Auth Files</strong><span>Auth files & credentials</span></span>
              </button>
              <button type="button" class="nav-btn" data-view="available-models">
                <span><strong>Available Models</strong><span>Detected model catalog</span></span>
              </button>
            </div>
          </div>

          <div class="sidebar-section">
            <h2>Observe</h2>
            <div class="nav-list">
              <button type="button" class="nav-btn" data-view="logs-viewer">
                <span><strong>Logs Viewer</strong><span>Request tracing summary</span></span>
              </button>
              <button type="button" class="nav-btn" data-view="model-management">
                <span><strong>Model Management</strong><span>Aliases, allowlists, disabled</span></span>
              </button>
            </div>
          </div>
        </aside>

        <main class="content">
          <div class="content-scroll">
            <header class="topbar">
              <div>
                <h1 id="view-title">Dashboard</h1>
                <p id="view-description">Operations overview for the current gateway runtime.</p>
              </div>
              <div class="topbar-actions">
                <button id="refresh-btn" type="button" class="btn secondary">Refresh</button>
                <button id="reload-btn" type="button" class="btn secondary">Reload Runtime</button>
                <button id="logout-btn" type="button" class="btn">Lock</button>
              </div>
            </header>

            <div id="global-status" class="global-status">Connect to the admin APIs to load gateway state.</div>
            <pre id="runtime-json" class="runtime-json mono hidden">{}</pre>

            <section id="view-dashboard" class="view-section">
              <div class="kpi-grid">
                <article class="kpi-card"><span class="label">Configured Targets</span><span id="kpi-configured" class="value">0</span></article>
                <article class="kpi-card"><span class="label">Healthy Targets</span><span id="kpi-healthy" class="value">0</span></article>
                <article class="kpi-card"><span class="label">Cooldown Targets</span><span id="kpi-cooldown" class="value">0</span></article>
                <article class="kpi-card"><span class="label">Runtime Mode</span><span id="kpi-mode" class="value">-</span></article>
              </div>

              <div class="dashboard-grid">
                <section class="panel">
                  <div class="panel-actions">
                    <div>
                      <h2>Runtime Summary</h2>
                      <p class="panel-subtitle">Pool status, selection mode, mutability, and store mode.</p>
                    </div>
                    <div class="section-actions">
                      <span id="store-mode-badge" class="pill neutral">Store: unknown</span>
                      <span id="mutation-badge" class="pill warn">Mutations: unknown</span>
                    </div>
                  </div>
                  <div class="metric-list">
                    <div class="metric-item"><strong>Store Mode</strong><span id="summary-store-mode">-</span></div>
                    <div class="metric-item"><strong>Mutations</strong><span id="summary-mutations">-</span></div>
                    <div class="metric-item"><strong>Selection</strong><span id="summary-selection">-</span></div>
                    <div class="metric-item"><strong>Snapshot Version</strong><span id="summary-version">-</span></div>
                    <div class="metric-item"><strong>Configured Accounts</strong><span id="summary-target-count">0</span></div>
                    <div class="metric-item"><strong>Healthy Accounts</strong><span id="summary-healthy-count">0</span></div>
                  </div>
                </section>

                <section class="panel">
                  <h2>Connection State</h2>
                  <p class="panel-subtitle">Current admin session and endpoint posture.</p>
                  <div class="metric-list">
                    <div class="metric-item"><strong>Admin Origin</strong><span id="summary-origin" class="mono">-</span></div>
                    <div class="metric-item"><strong>Current Provider</strong><span id="summary-provider">gemini</span></div>
                    <div class="metric-item"><strong>Auth Mode</strong><span id="summary-auth">Bearer token</span></div>
                    <div class="metric-item"><strong>Remembered</strong><span id="summary-remembered">no</span></div>
                  </div>
                </section>
              </div>
            </section>

            <section id="view-ai-providers" class="view-section hidden">
              <section class="panel">
                <h2>AI Providers</h2>
                <p class="panel-subtitle">Upstream target routing, health, and pool distribution.</p>
                <div id="provider-grid" class="card-grid"></div>
              </section>
            </section>

            <section id="view-auth-files" class="view-section hidden">
              <div class="auth-view-stack">
                <div class="compact-auth-layout">
                  <section class="panel compact-panel">
                    <div class="panel-actions">
                      <div>
                        <h2>Vertex JSON Login</h2>
                        <p class="panel-subtitle">Upload one service account JSON and turn it into a managed vertex auth file.</p>
                      </div>
                      <button id="import-btn" type="button" class="btn">Import Vertex Credential</button>
                    </div>
                    <div class="compact-import-grid" style="margin-top:12px">
                      <div class="field">
                        <label for="import-location">Region</label>
                        <input id="import-location" type="text" value="global" placeholder="global" />
                      </div>
                      <div class="field">
                        <label for="import-project">Project</label>
                        <input id="import-project" type="text" placeholder="project-id" />
                      </div>
                      <div class="field">
                        <label for="import-label">Label</label>
                        <input id="import-label" type="text" placeholder="Monet AI Project" />
                      </div>
                      <div class="field">
                        <label for="import-weight">Weight</label>
                        <input id="import-weight" type="number" min="1" value="1" />
                      </div>
                      <div class="field">
                        <label for="import-file">Service account key JSON</label>
                        <input id="import-file" type="file" accept="application/json,.json" />
                        <span id="import-hint" class="muted">Only Google Cloud service account key JSON files are accepted.</span>
                      </div>
                    </div>
                  </section>

                  <section class="panel compact-panel">
                    <h2>Auth Files Management</h2>
                    <p class="panel-subtitle">Manage vertex auth files here. Imported credentials are enabled immediately.</p>
                    <div class="auth-chip-row" id="auth-chip-row"></div>
                    <div class="toolbar-grid" style="margin-top:14px">
                      <div class="field">
                        <label for="auth-search">Search configs</label>
                        <input id="auth-search" type="text" placeholder="Filter by name, type, or provider. Use * as a wildcard" />
                      </div>
                      <label class="toggle-row">
                        <span id="problematic-toggle" class="toggle-pill"></span>
                        <span>Only show problematic credentials</span>
                      </label>
                      <label class="toggle-row">
                        <span id="disabled-toggle" class="toggle-pill"></span>
                        <span>Only show disabled credentials</span>
                      </label>
                    </div>
                  </section>
                </div>

                <section class="panel compact-panel">
                  <div id="credential-list" class="credential-grid"></div>
                </section>
              </div>
            </section>

            <section id="view-available-models" class="view-section hidden">
              <section class="panel">
                <div class="panel-actions">
                  <div>
                    <h2>Available Models</h2>
                    <p class="panel-subtitle">Shows the saved provider catalogs and common model families the gateway currently knows about.</p>
                  </div>
                  <div class="section-actions">
                    <button id="available-models-add-alias-btn" type="button" class="btn secondary">Add Alias</button>
                    <button id="refresh-models-btn" type="button" class="btn secondary">Refresh</button>
                  </div>
                </div>
                <div id="available-model-total" class="headline-stat">0 available models</div>
                <div id="available-model-metrics" class="surface-metrics"></div>
                <div id="available-model-groups" class="list-shell" style="margin-top:18px"></div>
              </section>
            </section>

            <section id="view-logs-viewer" class="view-section hidden">
              <section class="panel">
                <h2>Logs Viewer</h2>
                <p class="panel-subtitle">Structured runtime events from the active pool targets. Search and filter the latest health, cooldown, and failure signals.</p>
                <div id="logs-metrics" class="surface-metrics compact" style="margin-bottom:14px"></div>
                <div class="log-toolbar" style="margin-bottom:14px">
                  <div class="field">
                    <label for="log-search">Search logs</label>
                    <input id="log-search" type="text" placeholder="Search logs by target, route family, or status code" />
                  </div>
                  <label class="toggle-row">
                    <span id="log-failures-toggle" class="toggle-pill"></span>
                    <span>Only failures</span>
                  </label>
                  <button id="refresh-logs-btn" type="button" class="btn secondary">Refresh Logs</button>
                </div>
                <div id="log-filter-pills" class="log-pill-row" style="margin-bottom:14px"></div>
                <div id="logs-summary-grid" class="log-table"></div>
              </section>
            </section>

            <section id="view-model-management" class="view-section hidden">
              <section class="panel">
                <div class="panel-actions">
                  <div>
                    <h2>Model Management</h2>
                    <p class="panel-subtitle">Manage the vertex-facing Gemini default route, aliases, allowlist, and disabled entries.</p>
                  </div>
                  <span class="pill neutral">Vertex / Gemini</span>
                </div>
                <section class="model-summary-strip">
                  <article class="list-card">
                    <h3>Disabled Models</h3>
                    <p id="disabled-summary">0 models disabled</p>
                  </article>
                  <article class="list-card">
                    <h3>Model Aliases</h3>
                    <p id="alias-summary">0 aliases configured</p>
                  </article>
                  <article class="list-card">
                    <h3>Default Route</h3>
                    <p id="default-model-summary">No default model selected</p>
                  </article>
                </section>
                <div class="stack-grid">
                  <section class="editor-card">
                    <div class="panel-actions">
                      <div>
                        <h3 id="model-editor-title">Vertex Model Catalog</h3>
                        <p id="model-editor-subtitle">Tune the default route and saved Gemini aliases, allowlists, and disabled entries for the vertex gateway.</p>
                      </div>
                      <span id="model-editor-provider-pill" class="pill neutral">vertex</span>
                    </div>
                    <div class="field">
                      <label for="model-default">Default model</label>
                      <input id="model-default" type="text" placeholder="gemini-2.5-flash" />
                    </div>
                    <div class="field" style="margin-top:14px">
                      <label for="model-aliases" class="sr-only">Aliases</label>
                      <textarea id="model-aliases" class="mono hidden" placeholder='{"fast":"gemini-2.5-flash"}'></textarea>
                      <div class="alias-panel">
                        <div class="alias-panel-head">
                          <div>
                            <h4>Vertex model aliases</h4>
                            <p>Map preview or legacy client model names to the routed Gemini model this gateway should serve.</p>
                          </div>
                          <button id="add-alias-btn" type="button" class="btn secondary">Add alias</button>
                        </div>
                        <div id="alias-list" class="alias-list"></div>
                      </div>
                    </div>
                    <div class="model-editor-grid" style="margin-top:14px">
                      <div class="field">
                        <label for="model-allowlist">Allowlist (one per line)</label>
                        <textarea id="model-allowlist" placeholder="gemini-2.5-flash"></textarea>
                      </div>
                      <div class="field">
                        <label for="model-disabled">Disabled (one per line)</label>
                        <textarea id="model-disabled" placeholder="model-id"></textarea>
                      </div>
                    </div>
                    <div class="section-actions" style="margin-top:16px">
                      <button id="save-model-btn" type="button" class="btn">Save Model Catalog</button>
                    </div>
                  </section>
                </div>
              </section>
            </section>

            <section class="view-section hidden"></section>
          </div>
        </main>
      </div>
    </div>

    <div id="credential-modal" class="modal-shell hidden">
      <div class="modal-card">
        <div class="modal-head">
          <div>
            <h2 id="modal-title">Auth File Details / Edit</h2>
            <p id="modal-subtitle">Inspect and update this managed vertex credential.</p>
          </div>
          <button id="modal-close-btn" type="button" class="mini-btn ghost" aria-label="Close">×</button>
        </div>
        <div class="modal-body">
          <div class="modal-grid">
            <section class="stack-grid">
              <div class="field">
                <label for="detail-id">Credential ID</label>
                <input id="detail-id" type="text" readonly />
              </div>
              <div class="field">
                <label for="detail-email">Service Account Email</label>
                <input id="detail-email" type="text" readonly />
              </div>
              <div class="field">
                <label for="detail-label">Label</label>
                <input id="detail-label" type="text" />
              </div>
              <div class="field">
                <label for="detail-location">Location</label>
                <input id="detail-location" type="text" />
              </div>
              <div class="field">
                <label for="detail-weight">Weight</label>
                <input id="detail-weight" type="number" min="1" />
              </div>
              <div class="field">
                <label for="detail-enabled">Enabled</label>
                <select id="detail-enabled">
                  <option value="true">Enabled</option>
                  <option value="false">Disabled</option>
                </select>
              </div>
            </section>

            <section class="stack-grid">
              <div class="field">
                <label>Auth file info</label>
                <pre id="modal-info-json" class="json-preview compact-json mono">{}</pre>
              </div>
              <div class="field">
                <label>Auth file JSON preview</label>
                <pre id="modal-credential-json" class="json-preview compact-json mono">{}</pre>
              </div>
            </section>
          </div>

          <div class="modal-actions">
            <button id="modal-test-btn" type="button" class="btn secondary">Test</button>
            <button id="save-detail-btn" type="button" class="btn">Save</button>
            <button id="delete-detail-btn" type="button" class="btn danger">Delete</button>
          </div>
        </div>
      </div>
    </div>

    <div id="model-modal" class="modal-shell hidden">
      <div class="modal-card model-modal-card">
        <div class="modal-head">
          <div>
            <h2 id="model-modal-title">Vertex Model Rules</h2>
            <p id="model-modal-subtitle">Manage per-credential model allowlist and exclusions.</p>
          </div>
          <button id="model-modal-close-btn" type="button" class="mini-btn ghost" aria-label="Close">×</button>
        </div>
        <div class="modal-body">
          <div class="model-metadata-grid">
            <div class="metric-item"><strong>Credential</strong><span id="model-modal-credential" class="mono">-</span></div>
            <div class="metric-item"><strong>Project</strong><span id="model-modal-project" class="mono">-</span></div>
            <div class="metric-item"><strong>Location</strong><span id="model-modal-location">-</span></div>
          </div>
          <div class="field">
            <label for="detail-allowlist">Model allowlist</label>
            <textarea id="detail-allowlist" placeholder="one model id per line"></textarea>
          </div>
          <div class="field">
            <label for="detail-exclusions">Model exclusions</label>
            <textarea id="detail-exclusions" placeholder="one model id per line"></textarea>
          </div>
          <div class="modal-actions">
            <button id="model-modal-save-btn" type="button" class="btn">Save</button>
          </div>
        </div>
      </div>
    </div>

    <script id="bootstrap-state" type="application/json">${safeJsonScript(bootstrapState)}</script>
    <script>
      (() => {
        const bootstrap = JSON.parse(document.getElementById('bootstrap-state').textContent);
        const escapeHtml = (value) => String(value)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#39;');
        const KNOWN_MODELS = {
          gemini: ['gemini-3-pro-image', 'gemini-2.5-flash', 'gemini-2.5-flash-image', 'gemini-3.1-flash-lite', 'gemini-2.5-flash-lite', 'gemini-3.5-flash', 'gemini-3.1-flash-image-preview', 'gemini-2.5-pro', 'gemini-3.1-flash-lite-preview', 'gemini-3.1-pro-preview', 'gemini-3-pro-image-preview', 'gemini-3.1-flash-image'],
        };
        const VIEW_META = {
          dashboard: ['Dashboard', 'Operations overview for the current gateway runtime.'],
          'ai-providers': ['AI Providers', 'Inspect pool targets, routing health, and upstream capacity.'],
          'auth-files': ['Auth Files', 'Import, inspect, test, and manage credential JSON files.'],
          'available-models': ['Available Models', 'Visual inventory of the provider model catalogs currently known to this gateway.'],
          'logs-viewer': ['Logs Viewer', 'Structured runtime events and recent pool activity.'],
          'model-management': ['Model Management', 'Default models, aliases, allowlists, and disabled entries.'],
        };

        const clearStoredTokens = () => {
          localStorage.removeItem('gateway_admin_token');
          sessionStorage.removeItem('gateway_admin_token_session');
          sessionStorage.removeItem('gateway_admin_token');
        };

        clearStoredTokens();

        const state = {
          token: '',
          username: 'admin',
          mustChangePassword: false,
          provider: bootstrap.provider || 'gemini',
          currentView: 'dashboard',
          snapshot: null,
          selectedCredentialId: null,
          writable: false,
          providerFilter: 'all',
          onlyProblematic: false,
          onlyDisabled: false,
          authSearch: '',
          logSearch: '',
          logFailuresOnly: false,
          logFilter: 'all',
        };

        const $ = (id) => document.getElementById(id);
        const loginScreen = $('login-screen');
        const adminShell = $('admin-shell');
        const loginForm = $('login-form');
        const loginStatus = $('login-status');
        const globalStatus = $('global-status');
        const usernameInput = $('username-input');
        const passwordInput = $('password-input');
        const passwordChangePanel = $('password-change-panel');
        const currentPasswordInput = $('current-password-input');
        const newPasswordInput = $('new-password-input');
        const currentUrl = $('current-url');
        const credentialGrid = $('credential-list');
        const authChipRow = $('auth-chip-row');
        const providerGrid = $('provider-grid');
        const availableModelGroups = $('available-model-groups');
        const availableModelMetrics = $('available-model-metrics');
        const runtimeJson = $('runtime-json');
        const logsSummaryGrid = $('logs-summary-grid');
        const logsMetrics = $('logs-metrics');
        const aliasList = $('alias-list');
        const credentialModal = $('credential-modal');
        const modelModal = $('model-modal');

        const ids = {
          configured: $('kpi-configured'),
          healthy: $('kpi-healthy'),
          cooldown: $('kpi-cooldown'),
          mode: $('kpi-mode'),
          storeBadge: $('store-mode-badge'),
          mutationBadge: $('mutation-badge'),
          summaryStoreMode: $('summary-store-mode'),
          summaryMutations: $('summary-mutations'),
          summarySelection: $('summary-selection'),
          summaryVersion: $('summary-version'),
          summaryTargetCount: $('summary-target-count'),
          summaryHealthyCount: $('summary-healthy-count'),
          summaryOrigin: $('summary-origin'),
          summaryProvider: $('summary-provider'),
          summaryRemembered: $('summary-remembered'),
          detailId: $('detail-id'),
          detailEmail: $('detail-email'),
          detailLabel: $('detail-label'),
          detailLocation: $('detail-location'),
          detailWeight: $('detail-weight'),
          detailEnabled: $('detail-enabled'),
          detailAllowlist: $('detail-allowlist'),
          detailExclusions: $('detail-exclusions'),
          modalTitle: $('modal-title'),
          modalSubtitle: $('modal-subtitle'),
          modalInfoJson: $('modal-info-json'),
          modalCredentialJson: $('modal-credential-json'),
          modelModalTitle: $('model-modal-title'),
          modelModalSubtitle: $('model-modal-subtitle'),
          modelModalCredential: $('model-modal-credential'),
          modelModalProject: $('model-modal-project'),
          modelModalLocation: $('model-modal-location'),
          modelDefault: $('model-default'),
          modelAliases: $('model-aliases'),
          modelAllowlist: $('model-allowlist'),
          modelDisabled: $('model-disabled'),
          disabledSummary: $('disabled-summary'),
          aliasSummary: $('alias-summary'),
          defaultModelSummary: $('default-model-summary'),
        };

        currentUrl.textContent = window.location.origin + '/admin';
        ids.summaryOrigin.textContent = window.location.origin;
        usernameInput.value = state.username;

        const setLoginStatus = (message, tone = '') => {
          loginStatus.textContent = message;
          loginStatus.className = 'login-status' + (tone ? ' ' + tone : '');
        };

        const setGlobalStatus = (message, tone = '') => {
          globalStatus.textContent = message;
          globalStatus.className = 'global-status' + (tone ? ' ' + tone : '');
        };

        const authHeaders = (json = true) => ({
          ...(json ? { 'Content-Type': 'application/json' } : {}),
          'Authorization': 'Bearer ' + state.token,
        });

        const splitLines = (value) => value.split(/\\r?\\n/).map((line) => line.trim()).filter(Boolean);

        const renderRecentTrack = (recent = []) => {
          const dots = Array.from({ length: 12 }, (_, index) => {
            const item = recent[recent.length - 12 + index];
            if (!item) return '<span></span>';
            return '<span class="' + (item.ok ? 'ok' : 'fail') + '"></span>';
          });
          return '<div class="health-track">' + dots.join('') + '</div>';
        };

        const serializeRuntimeJson = () => {
          runtimeJson.textContent = JSON.stringify({
            runtime: state.snapshot?.runtime || null,
            mode: state.snapshot?.mode || null,
            mutable: state.snapshot?.mutable || false,
            selectedCredentialId: state.selectedCredentialId,
          }, null, 2);
        };

        const toggleShell = (loggedIn) => {
          loginScreen.classList.toggle('hidden', loggedIn);
          adminShell.classList.toggle('hidden', !loggedIn);
          ids.summaryRemembered.textContent = loggedIn ? 'memory only' : 'no';
        };

        const setView = (viewId) => {
          state.currentView = viewId;
          Object.entries(VIEW_META).forEach(([key, [title, description]]) => {
            $('view-' + key).classList.toggle('hidden', key !== viewId);
            document.querySelector('.nav-btn[data-view="' + key + '"]').classList.toggle('active', key === viewId);
            if (key === viewId) {
              $('view-title').textContent = title;
              $('view-description').textContent = description;
            }
          });
        };

        const fetchJson = async (path, options = {}) => {
          if (!state.token) throw new Error('Login first.');
          const response = await fetch(path, {
            credentials: 'same-origin',
            ...options,
            headers: {
              ...(options.headers || {}),
              ...authHeaders(!options.headers || !('Content-Type' in options.headers)),
            },
          });
          const body = await response.json().catch(() => ({}));
          if (!response.ok) {
            throw new Error(body?.error?.message || ('Request failed with ' + response.status));
          }
          return body;
        };

        const setPasswordChangeMode = (required) => {
          state.mustChangePassword = required;
          passwordChangePanel.classList.toggle('hidden', !required);
          $('login-btn').classList.toggle('hidden', required);
          usernameInput.disabled = required;
          passwordInput.disabled = required;
          if (required) {
            currentPasswordInput.focus();
          }
        };

        const requestJson = async (path, options = {}) => {
          const response = await fetch(path, {
            credentials: 'same-origin',
            ...options,
            headers: {
              'Content-Type': 'application/json',
              ...(options.headers || {}),
            },
          });
          const text = await response.text();
          let body = {};
          try {
            body = text ? JSON.parse(text) : {};
          } catch {
            body = {};
          }
          if (!response.ok) {
            throw new Error(body?.error?.message || response.statusText || 'Request failed');
          }
          return body;
        };

        const loginWithPassword = async () => {
          const body = await requestJson('/admin/api/auth/login', {
            method: 'POST',
            body: JSON.stringify({
              username: usernameInput.value.trim(),
              password: passwordInput.value,
            }),
          });
          state.token = body.token || '';
          state.username = body.username || usernameInput.value.trim();
          clearStoredTokens();
          if (!state.token) throw new Error('Admin login did not return a session token.');
          if (body.mustChangePassword) {
            setPasswordChangeMode(true);
            setLoginStatus('Default password must be changed before opening the dashboard.', 'error');
            setGlobalStatus('Change the default admin password to unlock admin APIs.');
            return false;
          }
          setPasswordChangeMode(false);
          passwordInput.value = '';
          return true;
        };

        const availableModelsForProvider = (provider) => {
          const catalog = state.snapshot?.modelCatalog?.[provider] || { aliases: {}, allowlist: [], disabled: [], defaultModel: '' };
          const base = provider === 'gemini' ? KNOWN_MODELS.gemini : [];
          const merged = new Set(base);
          if (catalog.defaultModel) merged.add(catalog.defaultModel);
          Object.values(catalog.aliases || {}).forEach((value) => merged.add(value));
          (catalog.allowlist || []).forEach((value) => merged.add(value));
          return Array.from(merged).filter(Boolean);
        };

        const closeCredentialModal = () => {
          credentialModal.classList.add('hidden');
        };

        const openCredentialModal = () => {
          credentialModal.classList.remove('hidden');
        };

        const closeModelModal = () => {
          modelModal.classList.add('hidden');
        };

        const openModelModal = () => {
          modelModal.classList.remove('hidden');
        };

        const renderAliasRows = (aliases) => {
          const entries = Object.entries(aliases || {});
          if (!entries.length) {
            aliasList.innerHTML = '<div class="alias-empty">No aliases configured yet.</div>';
            return;
          }
          const knownModels = availableModelsForProvider(state.provider);
          const options = knownModels
            .map((model) => '<option value="' + escapeHtml(model) + '"></option>')
            .join('');
          aliasList.innerHTML = entries.map(([source, target], index) => (
            '<div class="alias-row" data-alias-index="' + index + '">' +
              '<div class="alias-field">' +
                '<label>Source model name</label>' +
                '<input class="alias-source-input" list="known-model-options" value="' + escapeHtml(source) + '" placeholder="Source model name" />' +
                '<span class="alias-source-hint">Pick a known model or type a custom alias source.</span>' +
              '</div>' +
              '<div class="alias-field">' +
                '<label>Routes to</label>' +
                '<input class="alias-target-input" list="known-model-options" value="' + escapeHtml(String(target)) + '" placeholder="gemini-3.1-flash-image-preview" />' +
              '</div>' +
              '<button type="button" class="alias-remove" data-action="remove-alias" data-index="' + index + '" aria-label="Remove alias">×</button>' +
            '</div>'
          )).join('');
          const existingList = $('known-model-options');
          if (existingList) {
            existingList.remove();
          }
          const dataList = document.createElement('datalist');
          dataList.id = 'known-model-options';
          dataList.innerHTML = options;
          aliasList.appendChild(dataList);
        };

        const collectAliasRows = () => {
          const aliases = {};
          aliasList.querySelectorAll('.alias-row').forEach((row) => {
            const source = row.querySelector('.alias-source-input')?.value?.trim();
            const target = row.querySelector('.alias-target-input')?.value?.trim();
            if (source && target) {
              aliases[source] = target;
            }
          });
          return aliases;
        };

        const refreshAll = async () => {
          try {
            const [health, credentials, gemini] = await Promise.all([
              fetchJson('/admin/api/health'),
              fetchJson('/admin/api/vertex-credentials'),
              fetchJson('/admin/api/models?provider=gemini'),
            ]);
            state.snapshot = {
              ...credentials,
              runtime: health.runtime,
              modelCatalog: { gemini },
            };
            state.writable = Boolean(state.snapshot.mutable) && state.snapshot.mode === 'file-store';
            renderDashboard();
            renderProviderGrid();
            renderAuthChips();
            renderCredentialGrid();
            fillCredentialDetail(state.snapshot.vertexPools.find((entry) => entry.id === state.selectedCredentialId) || state.snapshot.vertexPools[0] || null);
            fillModelEditor();
            renderAvailableModels();
            renderLogsSummary();
            serializeRuntimeJson();
            toggleShell(true);
            setGlobalStatus('Gateway admin state loaded.', 'success');
            setLoginStatus('Gateway admin state loaded.', 'success');
          } catch (error) {
            toggleShell(false);
            setLoginStatus(error.message || String(error), 'error');
          }
        };

        const renderDashboard = () => {
          const runtime = state.snapshot?.runtime?.active;
          const mode = state.snapshot?.runtime?.mode || state.snapshot?.mode || '-';
          ids.configured.textContent = String(runtime?.targetCount || state.snapshot?.vertexPools?.length || 0);
          ids.healthy.textContent = String(runtime?.healthyTargets || 0);
          ids.cooldown.textContent = String(runtime?.cooldownTargets || 0);
          ids.mode.textContent = String(mode);
          ids.storeBadge.textContent = 'Store: ' + (state.snapshot?.mode || '-');
          ids.storeBadge.className = 'pill ' + (state.snapshot?.mode === 'file-store' ? 'success' : 'neutral');
          ids.mutationBadge.textContent = 'Mutations: ' + (state.writable ? 'enabled' : 'read-only');
          ids.mutationBadge.className = 'pill ' + (state.writable ? 'success' : 'warn');
          ids.summaryStoreMode.textContent = state.snapshot?.mode || '-';
          ids.summaryMutations.textContent = state.writable ? 'enabled' : 'read-only';
          ids.summarySelection.textContent = runtime?.selection || '-';
          ids.summaryVersion.textContent = String(runtime?.version || '-');
          ids.summaryTargetCount.textContent = String(runtime?.targetCount || 0);
          ids.summaryHealthyCount.textContent = String(runtime?.healthyTargets || 0);
          ids.summaryProvider.textContent = state.provider;

          $('import-btn').disabled = !state.writable;
          $('save-detail-btn').disabled = !state.writable;
          $('delete-detail-btn').disabled = !state.writable;
          $('save-model-btn').disabled = !state.writable;
          $('import-hint').textContent = state.writable
            ? 'Writable file-store is active. Import, update, and delete are enabled.'
            : 'Gateway is running in read-only static mode. Mutation actions are disabled.';
        };

        const renderProviderGrid = () => {
          const targets = state.snapshot?.runtime?.active?.targets || [];
          if (!targets.length) {
            providerGrid.innerHTML = '<div class="empty-state">No provider targets are configured yet.</div>';
            return;
          }
          providerGrid.innerHTML = targets.map((target) => {
            const status = target.health?.status || 'unknown';
            const pillClass = status === 'healthy' ? 'success' : (status === 'cooldown' ? 'warn' : 'danger');
            return '<article class="provider-card">' +
              '<div class="panel-actions">' +
                '<div><h3>' + escapeHtml(target.id) + '</h3><p>' + escapeHtml(target.project) + ' · ' + escapeHtml(target.location) + '</p></div>' +
                '<span class="pill ' + pillClass + '">' + escapeHtml(status) + '</span>' +
              '</div>' +
              '<div class="metric-list" style="margin-top:14px">' +
                '<div class="metric-item"><strong>Weight</strong><span>' + (target.weight || 1) + '</span></div>' +
                '<div class="metric-item"><strong>Success</strong><span>' + (target.health?.success || 0) + '</span></div>' +
                '<div class="metric-item"><strong>Failure</strong><span>' + (target.health?.failure || 0) + '</span></div>' +
                '<div class="metric-item"><strong>Cooldown</strong><span>' + (target.health?.cooldownUntil ? 'active' : 'clear') + '</span></div>' +
              '</div>' +
              renderRecentTrack(target.health?.recent || []) +
            '</article>';
          }).join('');
        };

        const buildLogRows = () => {
          const targets = state.snapshot?.runtime?.active?.targets || [];
          const rows = [];
          const allowedRouteFamilies = new Set(['gemini', 'vertex', 'images', 'openai-chat', 'openai-responses', 'unknown']);
          targets.forEach((target) => {
            const health = target.health || {};
            const routeBuckets = health.routeFamilyBuckets || {};
            const bucketEntries = Object.entries(routeBuckets);
            if (!bucketEntries.length) {
              rows.push({
                targetId: target.id,
                targetProject: target.project,
                targetLocation: target.location,
                routeFamily: 'runtime',
                status: health.status || 'unknown',
                code: (health.status || 'unknown').toUpperCase(),
                detail: 'success ' + (health.success || 0) + ' · failure ' + (health.failure || 0),
                success: health.success || 0,
                failure: health.failure || 0,
                recent: health.recent || [],
              });
              return;
            }
            bucketEntries.forEach(([routeFamily, bucket]) => {
              if (!allowedRouteFamilies.has(routeFamily)) {
                return;
              }
              const success = typeof bucket?.success === 'number' ? bucket.success : 0;
              const failure = typeof bucket?.failure === 'number' ? bucket.failure : 0;
              const recent = Array.isArray(bucket?.recent) ? bucket.recent : (health.recent || []);
              rows.push({
                targetId: target.id,
                targetProject: target.project,
                targetLocation: target.location,
                routeFamily,
                status: failure > 0 ? 'failure' : (success > 0 ? 'healthy' : (health.status || 'idle')),
                code: failure > 0 ? (failure + ' fail') : (success > 0 ? (success + ' ok') : 'idle'),
                detail: 'success ' + success + ' · failure ' + failure,
                success,
                failure,
                recent,
              });
            });
          });
          return rows;
        };

        const renderLogFilters = (rows) => {
          const counts = rows.reduce((map, row) => {
            map[row.status] = (map[row.status] || 0) + 1;
            return map;
          }, {});
          const filters = [
            ['all', 'All', rows.length],
            ['healthy', 'Healthy', counts.healthy || 0],
            ['failure', 'Failure', counts.failure || 0],
            ['cooldown', 'Cooldown', counts.cooldown || 0],
            ['idle', 'Idle', counts.idle || 0],
          ];
          $('log-filter-pills').innerHTML = filters.map(([value, label, count]) => (
            '<button type="button" class="filter-pill' + (state.logFilter === value ? ' active' : '') + '" data-log-filter="' + value + '">' +
              escapeHtml(label) + ' (' + count + ')' +
            '</button>'
          )).join('');
        };

        const renderLogMetrics = (rows) => {
          const uniqueTargets = new Set(rows.map((row) => row.targetId)).size;
          const failureCount = rows.filter((row) => row.status === 'failure').length;
          const activeRoutes = new Set(rows.map((row) => row.routeFamily)).size;
          const routeSignals = rows.reduce((sum, row) => sum + row.success + row.failure, 0);
          logsMetrics.innerHTML = [
            ['Targets', String(uniqueTargets), 'Pool targets contributing telemetry'],
            ['Failures', String(failureCount), 'Current failure-state route buckets'],
            ['Routes', String(activeRoutes), 'Distinct route families in view'],
            ['Signals', String(routeSignals), 'Success + failure counters across buckets'],
          ].map(([label, value, hint]) => (
            '<article class="surface-metric">' +
              '<strong>' + escapeHtml(label) + '</strong>' +
              '<span>' + escapeHtml(value) + '</span>' +
              '<small>' + escapeHtml(hint) + '</small>' +
            '</article>'
          )).join('');
        };

        const renderLogsSummary = () => {
          const rows = buildLogRows();
          renderLogMetrics(rows);
          renderLogFilters(rows);
          const filtered = rows.filter((row) => {
            if (state.logFilter !== 'all' && row.status !== state.logFilter) return false;
            if (state.logFailuresOnly && row.status !== 'failure') return false;
            const haystack = [row.targetId, row.routeFamily, row.status, row.code, row.detail].join(' ').toLowerCase();
            if (state.logSearch && !haystack.includes(state.logSearch.toLowerCase())) return false;
            return true;
          });
          if (!filtered.length) {
            logsSummaryGrid.innerHTML = '<div class="log-empty">No runtime events match the current filters.</div>';
            return;
          }
          logsSummaryGrid.innerHTML =
            '<div class="log-head"><span>Target</span><span>Route</span><span>Status</span><span>Signal</span><span>Detail</span><span>Recent</span></div>' +
            filtered.map((row) => (
              '<div class="log-row">' +
                '<strong class="mono">' + escapeHtml(row.targetId) + '</strong>' +
                '<span class="log-route-chip mono">' + escapeHtml(row.routeFamily) + '</span>' +
                '<span><span class="pill ' + (row.status === 'failure' ? 'danger' : row.status === 'cooldown' ? 'warn' : 'success') + '">' + escapeHtml(row.status) + '</span></span>' +
                '<span class="log-row-code mono">' + escapeHtml(row.code) + '</span>' +
                '<span class="log-detail-stack"><strong>' + escapeHtml(row.detail) + '</strong><small>' + escapeHtml(row.targetProject || '-') + ' · ' + escapeHtml(row.targetLocation || '-') + '</small></span>' +
                renderRecentTrack(row.recent || []) +
              '</div>'
            )).join('');
        };

        const credentialProviderCounts = () => ({
          all: state.snapshot?.vertexPools?.length || 0,
          vertex: state.snapshot?.vertexPools?.length || 0,
        });

        const renderAuthChips = () => {
          const counts = credentialProviderCounts();
          const chips = [
            ['all', 'All'],
            ['vertex', 'Vertex'],
          ];
          authChipRow.innerHTML = chips.map(([value, label]) => {
            const active = state.providerFilter === value;
            return '<button type="button" class="auth-chip' + (active ? ' active' : '') + '" data-provider-filter="' + value + '">' +
              '<strong>' + label + '</strong> <span class="muted">' + (counts[value] || 0) + '</span>' +
            '</button>';
          }).join('');
        };

        const renderCredentialGrid = () => {
          const entries = (state.snapshot?.vertexPools || []).filter((entry) => {
            if (state.providerFilter !== 'all' && state.providerFilter !== 'vertex') return false;
            const healthStatus = entry.health?.status || (entry.enabled === false ? 'disabled' : 'healthy');
            if (state.onlyProblematic && healthStatus === 'healthy') return false;
            if (state.onlyDisabled && entry.enabled !== false) return false;
            const haystack = [entry.id, entry.label, entry.project, entry.location, entry.email].filter(Boolean).join(' ').toLowerCase();
            if (state.authSearch && !haystack.includes(state.authSearch.toLowerCase())) return false;
            return true;
          });

          if (!entries.length) {
            credentialGrid.innerHTML = '<div class="empty-state">No auth files match the current filters.</div>';
            return;
          }

          credentialGrid.innerHTML = entries.map((entry) => {
            const health = entry.health || { status: entry.enabled === false ? 'disabled' : 'healthy', success: 0, failure: 0, recent: [] };
            const statusClass = health.status === 'healthy' ? 'success' : (health.status === 'cooldown' ? 'warn' : 'danger');
            const modifiedLabel = entry.modifiedAt
              ? new Date(entry.modifiedAt).toLocaleString()
              : '-';
            const sizeLabel = typeof entry.sizeBytes === 'number'
              ? (entry.sizeBytes < 1024 ? (entry.sizeBytes + ' B') : ((entry.sizeBytes / 1024).toFixed(2) + ' KB'))
              : '-';
            return '<article class="auth-card">' +
              '<div class="auth-card-head">' +
                '<div class="auth-card-title">' +
                  '<span class="auth-card-icon">Vx</span>' +
                  '<div>' +
                    '<div class="auth-chip-row" style="margin-bottom:6px"><span class="pill neutral">Vertex</span><span class="pill ' + statusClass + '">' + escapeHtml(health.status || 'unknown') + '</span></div>' +
                    '<h3>' + escapeHtml(entry.label || entry.id) + '</h3>' +
                    '<div class="auth-note">Note ' + escapeHtml(entry.location || 'global') + '</div>' +
                  '</div>' +
                '</div>' +
              '</div>' +
              '<div class="auth-meta-grid">' +
                '<div class="metric-item"><strong>Credential</strong><span class="mono">' + escapeHtml(entry.id || '-') + '</span></div>' +
                '<div class="metric-item"><strong>Project</strong><span class="mono">' + escapeHtml(entry.project || '-') + '</span></div>' +
                '<div class="metric-item"><strong>Email</strong><span class="mono">' + escapeHtml(entry.email || '-') + '</span></div>' +
                '<div class="metric-item"><strong>Size</strong><span>' + escapeHtml(sizeLabel) + '</span></div>' +
                '<div class="metric-item"><strong>Modified</strong><span>' + escapeHtml(modifiedLabel) + '</span></div>' +
                '<div class="metric-item"><strong>Weight</strong><span>' + (entry.weight || 1) + '</span></div>' +
                '<div class="metric-item"><strong>Enabled</strong><span>' + (entry.enabled === false ? 'No' : 'Yes') + '</span></div>' +
              '</div>' +
              '<div class="auth-chip-row"><span class="pill success">Success ' + (health.success || 0) + '</span><span class="pill danger">Failure ' + (health.failure || 0) + '</span></div>' +
              renderRecentTrack(health.recent || []) +
              '<div class="auth-foot">' +
                '<div class="auth-actions">' +
                  '<button type="button" class="mini-btn labelled ghost" title="Models" data-action="inspect-models" data-id="' + escapeHtml(entry.id) + '">Models</button>' +
                  '<button type="button" class="mini-btn ghost" title="Auth File Details / Edit" data-action="edit" data-id="' + escapeHtml(entry.id) + '">Edit</button>' +
                  '<button type="button" class="mini-btn danger" title="Delete" data-action="delete" data-id="' + escapeHtml(entry.id) + '"' + (state.writable ? '' : ' disabled') + '>Del</button>' +
                '</div>' +
                '<label class="auth-card-toggle"><span>Enabled</span><input type="checkbox" data-action="toggle-enabled" data-id="' + escapeHtml(entry.id) + '"' + (entry.enabled === false ? '' : ' checked') + (state.writable ? '' : ' disabled') + ' /></label>' +
              '</div>' +
            '</article>';
          }).join('');
        };

        const fillCredentialDetail = (entry) => {
          state.selectedCredentialId = entry ? entry.id : null;
          ids.detailId.value = entry?.id || '';
          ids.detailEmail.value = entry?.email || '';
          ids.detailLabel.value = entry?.label || '';
          ids.detailLocation.value = entry?.location || '';
          ids.detailWeight.value = String(entry?.weight || 1);
          ids.detailEnabled.value = String(entry?.enabled !== false);
          ids.detailAllowlist.value = (entry?.modelAllowlist || []).join('\\n');
          ids.detailExclusions.value = (entry?.modelExclusions || []).join('\\n');
          ids.modalTitle.textContent = 'Auth File Details / Edit - ' + (entry?.id || 'credential');
          ids.modalSubtitle.textContent = 'Inspect and update this managed vertex credential.';
          ids.modalInfoJson.textContent = JSON.stringify({
            id: entry?.id || '',
            email: entry?.email || '',
            project: entry?.project || '',
            location: entry?.location || '',
            weight: entry?.weight || 1,
            enabled: entry?.enabled !== false,
            label: entry?.label || '',
            health: entry?.health || null,
            modifiedAt: entry?.modifiedAt || '',
            sizeBytes: entry?.sizeBytes || 0,
          }, null, 2);
          ids.modalCredentialJson.textContent = JSON.stringify(entry?.credential || entry || {}, null, 2);
          ids.modelModalTitle.textContent = 'Vertex Model Rules - ' + (entry?.id || 'credential');
          ids.modelModalSubtitle.textContent = 'Manage allowlist and exclusions for this vertex credential.';
          ids.modelModalCredential.textContent = entry?.id || '-';
          ids.modelModalProject.textContent = entry?.project || '-';
          ids.modelModalLocation.textContent = entry?.location || '-';
        };

        const fillModelEditor = () => {
          const catalog = state.snapshot?.modelCatalog?.gemini || { aliases: {}, allowlist: [], disabled: [], defaultModel: '' };
          ids.modelDefault.value = catalog.defaultModel || '';
          ids.modelAliases.value = JSON.stringify(catalog.aliases || {}, null, 2);
          ids.modelAllowlist.value = (catalog.allowlist || []).join('\\n');
          ids.modelDisabled.value = (catalog.disabled || []).join('\\n');
          ids.disabledSummary.textContent = (catalog.disabled || []).length + ' models disabled';
          ids.aliasSummary.textContent = Object.keys(catalog.aliases || {}).length + ' aliases configured';
          ids.defaultModelSummary.textContent = catalog.defaultModel ? ('Default -> ' + catalog.defaultModel) : 'No default model selected';
          $('model-editor-title').textContent = 'Vertex Model Catalog';
          $('model-editor-subtitle').textContent = 'Tune the default route and saved Gemini aliases, allowlists, and disabled entries for the vertex gateway.';
          $('model-editor-provider-pill').textContent = 'vertex';
          renderAliasRows(catalog.aliases || {});
        };

        const renderAvailableModels = () => {
          const catalog = state.snapshot?.modelCatalog?.gemini || { aliases: {}, allowlist: [], disabled: [], defaultModel: '' };
          const groups = [
            ['gemini', 'Gemini', availableModelsForProvider('gemini')],
          ].filter(([, , models]) => models.length > 0);
          const total = groups.reduce((sum, [, , models]) => sum + models.length, 0);
          $('available-model-total').textContent = total + ' available models';
          availableModelMetrics.innerHTML = [
            ['Catalog Groups', String(groups.length), 'Visible provider families currently indexed'],
            ['Saved Aliases', String(Object.keys(catalog.aliases || {}).length), 'Client-facing remaps in the active model catalog'],
            ['Default Route', catalog.defaultModel || 'none', 'Current default Gemini route exposed by the gateway'],
          ].map(([label, value, hint]) => (
            '<article class="surface-metric">' +
              '<strong>' + escapeHtml(label) + '</strong>' +
              '<span class="' + (label === 'Default Route' ? 'mono' : '') + '">' + escapeHtml(value) + '</span>' +
              '<small>' + escapeHtml(hint) + '</small>' +
            '</article>'
          )).join('');
          availableModelGroups.innerHTML = groups.length
            ? '<div class="model-group-grid">' + groups.map(([, title, models]) => (
            '<article class="list-card">' +
              '<div class="catalog-card-head">' +
                '<div><h3>' + title + '</h3><p>' + models.length + ' available models</p></div>' +
                '<span class="pill neutral">catalog</span>' +
              '</div>' +
              '<div class="catalog-card-meta">' +
                '<span class="catalog-meta-chip">aliases ' + Object.keys(catalog.aliases || {}).length + '</span>' +
                '<span class="catalog-meta-chip">disabled ' + (catalog.disabled || []).length + '</span>' +
                '<span class="catalog-meta-chip">allowlist ' + (catalog.allowlist || []).length + '</span>' +
              '</div>' +
              '<div class="chip-cloud">' + models.map((model) => '<span class="model-chip">' + escapeHtml(model) + '</span>').join('') + '</div>' +
            '</article>'
          )).join('') + '</div>'
            : '<div class="empty-state">No model catalog entries are available yet.</div>';
        };

        const patchCredential = async (id, patch) => {
          await fetchJson('/admin/api/vertex-credentials/' + encodeURIComponent(id), {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(patch),
          });
        };

        const submitLogin = async () => {
          try {
            if (await loginWithPassword()) {
              await refreshAll();
            }
          } catch (error) {
            state.token = '';
            setPasswordChangeMode(false);
            setLoginStatus(error.message || String(error), 'error');
          }
        };

        loginForm.addEventListener('submit', async (event) => {
          event.preventDefault();
          await submitLogin();
        });

        $('login-clear-btn').addEventListener('click', () => {
          usernameInput.value = 'admin';
          passwordInput.value = '';
          currentPasswordInput.value = '';
          newPasswordInput.value = '';
          state.token = '';
          state.username = 'admin';
          setPasswordChangeMode(false);
          clearStoredTokens();
          setLoginStatus('Login form cleared.');
        });

        $('change-password-btn').addEventListener('click', async () => {
          try {
            const body = await fetchJson('/admin/api/auth/change-password', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                currentPassword: currentPasswordInput.value,
                newPassword: newPasswordInput.value,
              }),
            });
            if (body.token) state.token = body.token;
            currentPasswordInput.value = '';
            newPasswordInput.value = '';
            passwordInput.value = '';
            setPasswordChangeMode(false);
            await refreshAll();
          } catch (error) {
            setLoginStatus(error.message || String(error), 'error');
          }
        });

        $('logout-btn').addEventListener('click', () => {
          state.token = '';
          clearStoredTokens();
          passwordInput.value = '';
          currentPasswordInput.value = '';
          newPasswordInput.value = '';
          state.snapshot = null;
          state.selectedCredentialId = null;
          setPasswordChangeMode(false);
          toggleShell(false);
          setLoginStatus('Session locked.');
          setGlobalStatus('Login to the admin APIs to load gateway state.');
        });

        document.querySelectorAll('.nav-btn').forEach((button) => {
          button.addEventListener('click', () => setView(button.getAttribute('data-view')));
        });

        $('refresh-btn').addEventListener('click', refreshAll);
        $('reload-btn').addEventListener('click', async () => {
          try {
            await fetchJson('/admin/api/runtime/reload', { method: 'POST' });
            await refreshAll();
          } catch (error) {
            setGlobalStatus(error.message || String(error), 'error');
          }
        });
        $('refresh-models-btn').addEventListener('click', renderAvailableModels);
        $('available-models-add-alias-btn').addEventListener('click', () => {
          $('add-alias-btn').click();
          setView('model-management');
          requestAnimationFrame(() => {
            aliasList.querySelector('.alias-source-input:last-of-type')?.focus();
          });
        });

        $('auth-search').addEventListener('input', (event) => {
          state.authSearch = event.target.value;
          renderCredentialGrid();
        });
        $('log-search').addEventListener('input', (event) => {
          state.logSearch = event.target.value;
          renderLogsSummary();
        });
        $('log-failures-toggle').addEventListener('click', () => {
          state.logFailuresOnly = !state.logFailuresOnly;
          $('log-failures-toggle').classList.toggle('active', state.logFailuresOnly);
          renderLogsSummary();
        });
        $('refresh-logs-btn').addEventListener('click', renderLogsSummary);
        $('log-filter-pills').addEventListener('click', (event) => {
          const button = event.target.closest('[data-log-filter]');
          if (!button) return;
          state.logFilter = button.getAttribute('data-log-filter');
          renderLogsSummary();
        });

        $('problematic-toggle').addEventListener('click', () => {
          state.onlyProblematic = !state.onlyProblematic;
          $('problematic-toggle').classList.toggle('active', state.onlyProblematic);
          renderCredentialGrid();
        });

        $('disabled-toggle').addEventListener('click', () => {
          state.onlyDisabled = !state.onlyDisabled;
          $('disabled-toggle').classList.toggle('active', state.onlyDisabled);
          renderCredentialGrid();
        });

        authChipRow.addEventListener('click', (event) => {
          const button = event.target.closest('[data-provider-filter]');
          if (!button) return;
          state.providerFilter = button.getAttribute('data-provider-filter');
          renderAuthChips();
          renderCredentialGrid();
        });

        $('import-btn').addEventListener('click', async () => {
          try {
            if (!state.writable) throw new Error('Gateway is read-only. Import is disabled.');
            const file = $('import-file').files && $('import-file').files[0];
            if (!file) throw new Error('Choose a JSON file first.');
            const raw = await file.text();
            const credential = JSON.parse(raw);
            await fetchJson('/admin/api/vertex-credentials/import', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                project: $('import-project').value.trim(),
                location: $('import-location').value.trim() || 'global',
                label: $('import-label').value.trim(),
                weight: Number($('import-weight').value || '1'),
                credential,
              }),
            });
            $('import-file').value = '';
            await refreshAll();
          } catch (error) {
            setGlobalStatus(error.message || String(error), 'error');
          }
        });

        credentialGrid.addEventListener('click', async (event) => {
          const button = event.target.closest('[data-action]');
          if (!button) return;
          const id = button.getAttribute('data-id');
          const action = button.getAttribute('data-action');
          const entry = state.snapshot?.vertexPools?.find((item) => item.id === id);
          if (!entry) return;
          try {
            if (action === 'inspect-models') {
              fillCredentialDetail(entry);
              openModelModal();
              ids.detailAllowlist.focus();
              return;
            }
            if (action === 'edit') {
              fillCredentialDetail(entry);
              openCredentialModal();
              return;
            }
            if (action === 'delete') {
              if (!state.writable) throw new Error('Gateway is read-only. Delete is disabled.');
              await fetchJson('/admin/api/vertex-credentials/' + encodeURIComponent(id), { method: 'DELETE' });
              await refreshAll();
            }
          } catch (error) {
            setGlobalStatus(error.message || String(error), 'error');
          }
        });

        $('modal-close-btn').addEventListener('click', closeCredentialModal);
        credentialModal.addEventListener('click', (event) => {
          if (event.target === credentialModal) {
            closeCredentialModal();
          }
        });
        $('model-modal-close-btn').addEventListener('click', closeModelModal);
        modelModal.addEventListener('click', (event) => {
          if (event.target === modelModal) {
            closeModelModal();
          }
        });

        credentialGrid.addEventListener('change', async (event) => {
          const input = event.target.closest('[data-action="toggle-enabled"]');
          if (!input) return;
          const id = input.getAttribute('data-id');
          try {
            await patchCredential(id, { enabled: input.checked });
            await refreshAll();
          } catch (error) {
            setGlobalStatus(error.message || String(error), 'error');
          }
        });

        $('save-detail-btn').addEventListener('click', async () => {
          try {
            if (!state.selectedCredentialId) throw new Error('Select a credential first.');
            await patchCredential(state.selectedCredentialId, {
              label: ids.detailLabel.value.trim(),
              location: ids.detailLocation.value.trim(),
              weight: Number(ids.detailWeight.value || '1'),
              enabled: ids.detailEnabled.value === 'true',
            });
            await refreshAll();
          } catch (error) {
            setGlobalStatus(error.message || String(error), 'error');
          }
        });

        $('model-modal-save-btn').addEventListener('click', async () => {
          try {
            if (!state.selectedCredentialId) throw new Error('Select a credential first.');
            await patchCredential(state.selectedCredentialId, {
              modelAllowlist: splitLines(ids.detailAllowlist.value),
              modelExclusions: splitLines(ids.detailExclusions.value),
            });
            await refreshAll();
            closeModelModal();
          } catch (error) {
            setGlobalStatus(error.message || String(error), 'error');
          }
        });

        $('modal-test-btn').addEventListener('click', async () => {
          try {
            if (!state.selectedCredentialId) throw new Error('Select a credential first.');
            await fetchJson('/admin/api/vertex-credentials/' + encodeURIComponent(state.selectedCredentialId) + '/test', { method: 'POST' });
            await refreshAll();
          } catch (error) {
            setGlobalStatus(error.message || String(error), 'error');
          }
        });

        $('delete-detail-btn').addEventListener('click', async () => {
          try {
            if (!state.selectedCredentialId) throw new Error('Select a credential first.');
            if (!state.writable) throw new Error('Gateway is read-only. Delete is disabled.');
            await fetchJson('/admin/api/vertex-credentials/' + encodeURIComponent(state.selectedCredentialId), { method: 'DELETE' });
            state.selectedCredentialId = null;
            closeCredentialModal();
            await refreshAll();
          } catch (error) {
            setGlobalStatus(error.message || String(error), 'error');
          }
        });

        $('save-model-btn').addEventListener('click', async () => {
          try {
            if (!state.writable) throw new Error('Gateway is read-only. Model edits are disabled.');
            const aliases = collectAliasRows();
            ids.modelAliases.value = JSON.stringify(aliases, null, 2);
            await fetchJson('/admin/api/models/gemini', {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                defaultModel: ids.modelDefault.value.trim(),
                aliases,
                allowlist: splitLines(ids.modelAllowlist.value),
                disabled: splitLines(ids.modelDisabled.value),
              }),
            });
            await refreshAll();
          } catch (error) {
            setGlobalStatus(error.message || String(error), 'error');
          }
        });

        $('add-alias-btn').addEventListener('click', () => {
          const aliases = collectAliasRows();
          let nextIndex = 1;
          while (aliases['alias-' + nextIndex]) {
            nextIndex += 1;
          }
          aliases['alias-' + nextIndex] = '';
          renderAliasRows(aliases);
        });

        aliasList.addEventListener('click', (event) => {
          const button = event.target.closest('[data-action="remove-alias"]');
          if (!button) return;
          const row = button.closest('.alias-row');
          row?.remove();
          if (!aliasList.querySelector('.alias-row')) {
            renderAliasRows({});
          }
        });

        toggleShell(false);
        setView('dashboard');
      })();
    </script>
  </body>
</html>`;
};
