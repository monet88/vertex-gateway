# Design System: Vertex Gateway Operator Console

## 1. Visual Theme & Atmosphere

Vertex Gateway is a backend operator console for managing API gateway keys, admin access, Google Vertex credentials, routing policy, domain allow and block rules, and API call logs.

The interface should feel like a precise infrastructure cockpit for backend engineers. It is dense, calm, and safety-first. It should not look like a generic SaaS dashboard, a landing page, or an AI-purple admin template.

Design dials:

| Dial | Level | Intent |
| --- | ---: | --- |
| Density | 8 | Cockpit-dense, data-heavy, optimized for operators |
| Variance | 5 | Asymmetric enough to avoid template grids, still predictable for admin work |
| Motion | 3 | Restrained, mostly focus states and tactile feedback |
| Visual mood | 8 | Technical, premium, serious, secure |

Core atmosphere: dark infrastructure console, crisp typography, restrained teal accent, compact data tables, clear security posture, and no decorative noise that competes with operational signals.

## 2. Color Palette & Roles

Use one accent only. Status colors are reserved strictly for real system states.

- **Deep Console Canvas** (#0B1020) - primary background surface. Never use pure black.
- **Raised Console Surface** (#111827) - sidebar, cards, top bar, and grouped panels.
- **Pressed Input Well** (#0F172A) - inputs, filters, search fields, code-like fields, and masked secret cells.
- **Layered Surface High** (#1E293B) - popovers, active rows, selected tabs, and side panels.
- **Quiet Hairline** (#263244) - separators, table row dividers, and subtle outlines.
- **Primary Ink** (#E5E7EB) - main text, headings, primary values.
- **Muted Ink** (#94A3B8) - metadata, helper text, placeholders, inactive navigation.
- **Operator Teal** (#2DD4BF) - the single accent for selected navigation, primary actions, focus rings, and active filters.
- **Healthy Green** (#22C55E) - healthy or ready state only.
- **Warning Amber** (#F59E0B) - degraded, pending, or risky configuration state only.
- **Failure Red** (#EF4444) - failed, revoked, rejected, destructive, or blocked state only.

Banned color behavior:

- No violet or purple as a brand accent.
- No neon glow.
- No cyan-to-violet gradients.
- No mixed warm and cool gray systems.
- No color-only status. Pair every status color with text and, when possible, an icon.

## 3. Typography Rules

Dashboard UI uses sans-serif only.

- **Display and headings:** Geist. Compact, track-tight, controlled scale. Use weight and contrast for hierarchy, not oversized marketing type.
- **Body:** Geist. 14-16px, readable in dense layouts, line-height around 1.45.
- **Mono:** JetBrains Mono or Geist Mono. Required for timestamps, latency, status codes, model IDs, masked API keys, token counts, project IDs, and all KPI numbers.
- **Vietnamese UI copy:** labels must be short, direct, and operational. Prefer "Tạo key", "Thu hồi", "Kiểm tra", "Chặn domain", "Thêm target".

Suggested scale:

| Token | Font | Size | Weight | Use |
| --- | --- | ---: | ---: | --- |
| Display | Geist | 40-44px | 680 | Page title or major metric only |
| Heading | Geist | 22-24px | 640 | Section and panel titles |
| Subheading | Geist | 16-18px | 620 | Card titles |
| Body | Geist | 14px | 400 | Main UI copy |
| Caption mono | JetBrains Mono | 12px | 500 | IDs, timestamps, metadata |
| Table mono | JetBrains Mono | 13px | 400 | Logs and numerical rows |

Banned typography:

- No Inter as the default font.
- No serif fonts in dashboard or software UI.
- No oversized landing-page hero typography.
- No decorative uppercase labels on every section.

## 4. Component Stylings

### Buttons

- Minimum hit area: 40px desktop, 44px touch.
- Primary action: Operator Teal fill with Deep Console Canvas text.
- Secondary action: transparent or Raised Console Surface fill with Quiet Hairline outline.
- Destructive action: Failure Red outline or muted red fill with explicit text such as "Thu hồi key".
- Active feedback: subtle `scale(0.96)` or `translateY(-1px)`.
- Focus: 2px Operator Teal ring with visible offset.
- Never use outer glow, neon, or gradient button fills.

### Cards and panels

- Use cards only for real operational groupings.
- Radius: 12px for panels, 8px for inner controls.
- Elevation: tonal layering plus very soft tinted shadow.
- Add one subtle top highlight line only when elevation needs clarity.
- Avoid nested card stacks. Use dividers, spacing, or table rows inside cards.

### Data tables

- Logs table gets the widest region on the page.
- No vertical borders.
- Use horizontal row dividers with Quiet Hairline.
- Header row uses compact labels and muted text.
- Row hover uses Layered Surface High.
- Numbers and IDs use mono font.
- Status cells include text labels: "Ready", "Degraded", "Failed", "200 OK", "4xx", "5xx".

### Forms and inputs

- Label above input. Never use placeholder as the only label.
- Helper text below input when the field is risky or security-sensitive.
- Error text below input with a concrete recovery hint.
- Input background should be Pressed Input Well.
- Focus ring uses Operator Teal.
- Secret fields are masked by default with explicit reveal and copy controls.

### Badges

- Pill-shaped with text and optional icon.
- Semantic colors are reserved for real state.
- Admin store mode, runtime mode, environment, and health badges should be visible near the top bar.

### Secrets and credentials

- Gateway API keys and Google Vertex API keys are always masked.
- Never show a full key in the default state.
- Service account identity can show email and project ID, but never private key material.
- Copy and reveal controls must have clear labels and visible focus states.

## 5. Layout Principles

This is a product admin dashboard, not a marketing page. Do not create a centered hero section.

Desktop layout:

- Fixed left sidebar around 240px.
- Top bar with title, environment badge, health badge, admin store mode, and admin user menu.
- Main content uses a 12-column grid with compact gutters.
- KPI strip appears near the top, but not as three equal generic cards.
- Logs table is the dominant wide component.
- Security notices and risky mutations sit in a narrower right rail or side panel.
- Credential and policy management cards sit near logs, not buried below the fold.

Recommended screen structure:

1. **Top bar** - "Vertex Gateway Admin", environment, readiness, admin store mode.
2. **KPI row** - Requests 24h, Error rate, Active Gateway Keys, Vertex Targets.
3. **Primary grid** - API call logs wide table, Vertex targets table, Gateway keys table.
4. **Policy rail** - Domain allowlist, blacklist, wildcard CORS warning.
5. **Security rail** - admin token separation, file-store mutation warning, Cloud Run mutation note.
6. **Side panel** - Add Vertex target form with project_id, location, auth method, apiKeyMode.

Banned layout patterns:

- No centered hero.
- No 3 equal feature cards as the primary composition.
- No decorative fake terminal panels that do not represent actual UI.
- No overlapping elements.
- No absolute-positioned content stacking.
- No horizontal overflow on mobile.

## 6. Responsive Rules

- Below 768px, all multi-column layouts collapse to a single column.
- Sidebar becomes a top navigation or drawer with explicit labels.
- Tables should use horizontal affordance only when unavoidable. Prefer stacked row cards for mobile logs.
- Buttons are at least 44px tall on touch screens.
- Keep body text at 14px minimum.
- KPI tiles stack into two columns on tablet and one column on narrow mobile.
- Side panels become full-screen sheets on mobile with focus containment.

## 7. Motion & Interaction

Motion is functional, not cinematic.

- Use restrained hover states, focus rings, active press feedback, and table row highlighting.
- Use skeleton rows for loading tables and cards.
- Use no circular spinners.
- Use no perpetual decorative animation.
- If live status changes, pulse only the specific status indicator and provide text update.
- Animate only transform and opacity.
- Respect reduced motion by disabling non-essential transitions.

## 8. Core Screens

### Admin Overview

Must include:

- Gateway health summary.
- Requests 24h.
- Error rate.
- Active gateway keys.
- Vertex targets.
- Recent API call logs.
- Security notices.

### Gateway API Keys

Must include:

- Masked key list.
- Alias or name.
- Status: Active, Revoked, Expired.
- Created date.
- Last used time.
- Scope or allowed route family when implemented.
- Actions: Create, Rotate, Revoke.

Clarify in UI copy: gateway keys are Client to Gateway credentials, not Google Cloud API keys.

### Vertex Credentials

Must include:

- Target label.
- Project ID.
- Location.
- Auth type: Google Cloud API key or Service Account JSON.
- apiKeyMode: full or express.
- Weight.
- Enabled toggle.
- Health state.
- Last probe result.

Clarify in UI copy: upstream credentials are Gateway to Google credentials and must never be exposed to clients.

### API Call Logs

Must include:

- Time.
- Route family.
- Operation.
- Model.
- Gateway key alias.
- Upstream target.
- Latency.
- Status.
- Tokens or cost placeholder when available.
- Filters: date range, route family, status, model, search.

### Domain Policy

Must include:

- Allowlist tab.
- Blacklist tab.
- Domain chips.
- Add domain input.
- Wildcard warning.
- Clear production CORS warning when wildcard is present.

### Security Settings

Must include:

- Admin access state.
- Admin token warning if it matches gateway key.
- Mutation mode: static-config or file-store.
- Cloud Run file-store mutation warning.
- CORS production warning.

## 9. Copy Voice

Use concise Vietnamese operator copy.

Good examples:

- "Token admin phải tách biệt với gateway key."
- "Gateway key dùng cho Client đến Gateway. Đây không phải Google Cloud API key."
- "Upstream credential dùng cho Gateway đến Google. Không hiển thị cho client."
- "Wildcard CORS không phù hợp cho production."
- "File-store mutation bị vô hiệu hóa trên Cloud Run."

Avoid:

- Marketing language.
- Cute or poetic labels.
- Fake version stamps.
- Generic placeholder names.
- Emojis.
- Exaggerated claims.

## 10. Accessibility Requirements

- All interactive elements have visible focus states.
- All icon-only controls have accessible labels.
- Status is never color-only.
- Tables use real header relationships when implemented.
- Side panels and modals contain focus and close with Escape.
- Forms provide text-based error suggestions.
- Contrast meets WCAG AA.
- Touch targets are at least 44px on mobile.

## 11. Anti-Patterns Banned

- No emojis anywhere in UI copy.
- No Inter as default font.
- No serif fonts in dashboard UI.
- No pure black (#000000).
- No neon or outer glow shadows.
- No violet, purple, or AI-blue gradient aesthetic.
- No oversaturated accent colors.
- No excessive gradient text.
- No custom mouse cursors.
- No centered hero section.
- No 3 equal cards as the main layout.
- No overlapping text or controls.
- No generic names such as John Doe, Acme, Nexus, SmartFlow.
- No fake-perfect numbers such as 99.99% or 50%.
- No AI copywriting cliches such as Elevate, Seamless, Unleash, Next-Gen, Revolutionize.
- No filler UI text such as Scroll to explore or Swipe down.
- No decorative status dots unless they represent real live state.
- No circular loading spinners.
- No unmasked secrets by default.

## 12. Stitch Prompt Guidance

When generating screens in Stitch, use this prompt shape:

```text
Design a desktop admin dashboard for Vertex Gateway using the Vertex Gateway Operator Console design system.
Use a dark infrastructure cockpit aesthetic with Deep Console Canvas (#0B1020), Raised Console Surface (#111827), and Operator Teal (#2DD4BF) as the only accent.
The screen is for backend operators managing gateway API keys, admin access, Vertex credentials, API logs, and domain policy.
Use Vietnamese UI copy. Keep secrets masked. Use mono typography for IDs, timestamps, latency, tokens, and masked keys.
Prioritize a wide API call logs table, compact KPI tiles, credential management cards, domain policy controls, and security notices.
Avoid generic SaaS dashboards, violet gradients, neon glows, emojis, centered hero sections, and decorative fake terminal panels.
```
