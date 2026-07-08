# Admin React Stitch Replacement Design

Date: 2026-07-07
Status: Written for user review
Scope: Replace the live `/admin` UI with the React frontend and align the experience with the Stitch operator-console direction

## Goal

Replace the backend-rendered `/admin` HTML UI with a single React admin application that follows the Stitch project direction and the local root `DESIGN.md` design system.

The new admin must become the only operator experience served at `/admin`. It must preserve the existing admin API surface under `/admin/api/*`, keep all current live admin feature areas visible, and avoid maintaining two unrelated admin UIs in parallel.

## Current State

The repository currently has two separate admin experiences:

- `src/admin/admin-ui.ts` renders the live `/admin` page as a large backend-generated HTML/CSS/JS document.
- `frontend/` contains a React operator console introduced in PR #5, with a dark Stitch-aligned shell, partial admin data wiring, and a narrower feature surface.

The current live `/admin` UI is visually divergent from the Stitch project and from root `DESIGN.md`. It uses a light beige theme, different typography, different layout rules, and a separate interaction model. That divergence is structural, not a small styling drift.

The backend admin routes already provide real JSON endpoints for authentication, password change, health, gateway keys, Vertex credentials, model catalog, and runtime reload. The React frontend already contains reusable shell, table, dialog, and auth pieces, but it does not yet replace the live `/admin` route or cover the full feature inventory of the current live admin.

## Chosen Approach

Serve one React single-page admin application at `/admin` and retire the backend-rendered HTML admin UI as the active experience.

The backend remains the source of truth for admin auth, persistence, runtime actions, and JSON APIs. The frontend becomes the source of truth for presentation, navigation, loading states, errors, empty states, mutation UX, and beta messaging for not-yet-backed views.

The admin navigation keeps feature parity with the current live `/admin` structure:

1. Dashboard
2. AI Providers
3. Auth Files
4. Available Models
5. Logs Viewer
6. Model Management

Views without real backend telemetry yet remain visible in the new UI, but they must be presented as explicit beta or coming-soon surfaces rather than fake live data.

## Non-Goals

This slice does not add a new backend telemetry system only to populate the logs screen.

This slice does not redesign any public gateway route outside `/admin`.

This slice does not continue feature work on the backend-rendered beige admin UI except what is needed to deprecate or stop serving it.

This slice does not expand product scope beyond replacing the admin presentation layer and wiring it to the existing admin APIs. New backend endpoints should be added only if a small compatibility gap blocks the React admin from replacing the old UI cleanly.

## Route And Render Design

`/admin` becomes a React SPA entrypoint.

- `GET /admin` returns the built frontend admin shell instead of `renderAdminUi()`.
- Backend serves the built frontend assets required by that shell.
- All data and mutations continue to flow through `/admin/api/*`.

The runtime flow is:

1. Operator opens `/admin`.
2. React admin bootstraps.
3. The app resolves auth state:
   - no token -> show `Admin Login`
   - default-password session -> show `Force Change Password`
   - valid token -> enter the main console
4. Each view fetches its own data through the existing admin APIs.
5. Views lacking backend support render structured beta surfaces rather than pretending to be fully live.

The frontend may use lightweight client-side routing or view-state routing, but it should support shareable deep links such as `/admin?view=model-management` or `/admin?view=auth-files`.

## Information Architecture

The new React admin keeps all six live feature areas while clarifying their responsibilities.

### Dashboard

The landing screen after successful authentication. It surfaces runtime posture, health, quick actions, gateway-key snapshot, Vertex-target snapshot, and model posture. It should provide operational overview rather than deep editing.

### AI Providers

The operational view for upstream target health and routing capacity. It focuses on Vertex targets, target state, project and location identity, auth type, health, and test actions.

### Auth Files

The credential lifecycle view. It covers importing service-account JSON, creating API-key targets, inspecting credentials, testing credentials, and deleting credentials. It should clearly distinguish sensitive upstream credentials from client-facing gateway credentials.

### Available Models

A read-heavy inventory of the provider model catalogs currently known to the gateway. It should show grouped models and catalog visibility without conflating catalog viewing with policy editing.

### Logs Viewer

This remains present in the navigation for feature parity, but until real telemetry APIs exist it renders as a beta screen with a finished layout, disabled or read-only controls as needed, and explicit messaging that telemetry wiring is not yet live.

### Model Management

The policy-editing screen for default models, aliases, allowlists, disabled entries, and any retained per-credential model rules. This is the mutation-heavy counterpart to `Available Models`.

## UX And Visual Design

The new admin must follow the Stitch project and root `DESIGN.md` direction: dark operator console, restrained teal accent, dense but scannable tables, fixed left navigation, and data-first composition.

The current light beige, glassy, gradient-heavy admin styling must not carry forward.

### Login And Password Change

The login and forced password-change flows become dedicated dark screens that visually belong to the same operator console. Password change remains a hard gate before the main console loads when the default password is still in use.

### Global App Shell

The shell uses:

- fixed left sidebar around 240px
- top bar with current view title and operational badges
- 12-column main grid
- dense panels with tonal layering, not marketing cards

Environment, readiness, store mode, and admin user context should remain visible near the top of the app.

### Tables And States

Tables are central UI primitives. They must support explicit loading, empty, error, success, and destructive-action states. IDs, timestamps, project IDs, and model names should use mono typography. Hover, focus, and active states should be restrained and consistent.

### Dialogs And Mutations

Key creation, target creation, service-account import, credential inspection, test actions, and model-catalog editing should all use consistent dialog or sheet patterns with inline pending and error handling. The React admin must not rely on old browser-style prompts or the interaction patterns from the deprecated static UI.

### Beta Screens

Screens without live backend support must still look complete. They should use proper layout, filters, and status surfaces, but clearly mark unavailable backend-backed actions as beta or coming soon. The app should never imply that mock data is live operational data.

## Backend And Frontend Boundaries

Backend remains responsible for:

- login and password change
- admin token/session behavior
- gateway keys
- Vertex credentials CRUD and test
- health and runtime state
- model catalog read and write
- runtime reload

Frontend remains responsible for:

- serving the admin shell
- view navigation
- stateful mutation UX
- data presentation
- loading and error handling
- beta-state messaging

This boundary keeps the replacement focused on the admin presentation layer and prevents the redesign from turning into an unrelated backend expansion.

## Migration Design

Keep `/admin/api/*` stable while swapping the presentation layer for `/admin`.

The migration sequence should be:

1. Expand the React admin to cover the full `/admin` feature map.
2. Build the frontend for backend serving.
3. Change `GET /admin` to serve the React app shell.
4. Stop using `renderAdminUi()` as the live admin experience.

The old static admin implementation can remain in the repository temporarily for rollback or extraction purposes during the transition, but it must no longer be the primary served UI once the replacement is complete.

## Data And Feature Mapping

The existing React dashboard already covers:

- admin login and password change
- gateway key listing and creation
- gateway key revoke
- Vertex target listing
- API-key target creation
- service-account import

The replacement work must extend that base to cover:

- full multi-view navigation
- health and runtime summary
- AI Providers view presentation
- Auth Files view presentation
- Available Models view
- Model Management view
- runtime reload action
- credential inspect, test, edit, and delete flows where already supported by backend routes
- beta Logs Viewer screen

Static mock KPI, security, and logs content should be removed or downgraded wherever it would misrepresent live state.

## Error Handling

Authentication failures should stay localized to the auth flows and retain actionable messages.

Mutation failures should preserve operator input where practical. A failed key creation, credential import, or model save must not discard the entered form state unless the action actually succeeded.

Views that depend on backend routes should render scoped errors without collapsing the whole admin shell. The operator should still be able to navigate elsewhere in the console.

## Testing And Validation

Validation should cover both the route replacement and the operator workflows:

- backend compile
- frontend build
- frontend lint
- relevant backend tests around admin routes and auth
- local browser smoke for `/admin`

Manual or E2E validation should confirm:

1. `/admin` loads the React app rather than the old static UI
2. login with `admin / changeme` works on first use
3. forced password change blocks console access until completed
4. dashboard loads live admin-backed data where supported
5. gateway key create and revoke work
6. Vertex target create, import, inspect, test, and delete flows work where supported
7. model catalog load and save work
8. runtime reload action works
9. all six views are reachable from the sidebar
10. beta screens are clearly labeled and do not present fake live telemetry

## Success Criteria

This slice is complete when:

- `/admin` no longer serves the old beige backend-rendered UI
- the React frontend is the only active admin experience
- the experience visually aligns with Stitch and root `DESIGN.md`
- the current live `/admin` feature areas all exist in the React admin
- unsupported telemetry-backed surfaces are represented honestly as beta states
- the codebase no longer has two competing admin UX sources of truth for the live route

## Implementation Boundaries

Keep edits scoped to:

- admin route serving and frontend asset delivery
- React admin navigation and screen composition
- admin data hooks and feature wiring
- shared admin tables, dialogs, and state components
- deprecating the old static UI as the live route

Do not use this redesign as a reason to refactor unrelated public routes, gateway request handling, or non-admin frontend concerns.
