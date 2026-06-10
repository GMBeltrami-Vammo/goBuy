# goBuy — Vammo Purchase Request Platform — Design Spec

**Date:** 2026-06-10
**Status:** Approved decisions captured from stakeholder Q&A; progressive execution authorized.
**Replaces:** the static `index.html` Cowork artifact ("Vammo Solicitacoes Compra").

## 1. Goal

Replace the entire payment-request flow across all Vammo departments. Requesters submit
purchase/service/advance requests; cost-center heads approve; the fiscal team gets easy
access to all documents (notas fiscais, quotations); the finance team executes payments.
Everything logged, nothing leaks.

## 2. Locked decisions

| Decision | Choice |
|---|---|
| Stack | Next.js (App Router, TS, Tailwind) on Vercel, replacing static HTML |
| Database | Supabase project `jfdqlnpidynxwqqiblcd` ("Vammo Automations"), schema `finance` **only** — no objects in any other schema |
| Naming | snake_case, lowercase, indicative names |
| Auth | Google OAuth via Supabase Auth; only `@vammo.com` may access data |
| Heads | Auto-assigned by email match in `finance.cost_center_heads`; one head can own many centers |
| Roles | `finance`, `fiscal` (+ implicit requester for everyone, head via center assignment); one person can hold multiple roles |
| Budget | Mock data seeded now (`source='mock'`), designed for trivial replacement by a real source later |
| Sheets mirror | Not in v1 |
| Slack | Notification structure (queue + one-click action token model) created but **not operable** |
| Schema boundary | Strict: no trigger on `auth.users`, no policies on `storage.objects`. Consequences accepted: non-vammo Google accounts can authenticate but see/do nothing; all file I/O goes through server API routes |

## 3. Data model (schema `finance`)

All tables have RLS enabled. `authenticated` role only ever reads through policies;
writes happen through security-definer RPCs or the server (service key). `anon` has no
usage on the schema at all.

- **user_profiles** — `user_id uuid pk` (FK → auth.users, no trigger — created lazily on
  first login by the app), `email` (unique, lowercase), `full_name`, `avatar_url`,
  `created_at`.
- **user_roles** — `user_email`, `role` enum(`finance`,`fiscal`,`admin`), `granted_by_email`,
  `created_at`; PK (user_email, role). Multiple rows = multiple roles. Email-keyed so roles
  can be pre-assigned before first login.
- **cost_centers** — `id identity pk`, `code` (unique, e.g. `1001`), `name`
  (e.g. `Marketing: Payroll`), `department`, `active`, `created_at`.
- **cost_center_heads** — `cost_center_id` FK, `head_email`, `head_name`; PK
  (cost_center_id, head_email). Email match against the session JWT = "head vision".
- **cost_center_budgets** — `cost_center_id` FK, `period_month date` (month-truncated),
  `amount numeric(14,2)`, `source text` (`mock` now; `budget_pnl` etc. later),
  `updated_by_email`, `updated_at`; UNIQUE (cost_center_id, period_month). Replacing mock
  data = upsert with a different `source`.
- **purchase_requests** — `id uuid pk`, `display_id` (`PC-0001`, from a sequence),
  `request_type` enum(`products`,`service`,`advance`), `status` enum(`pending`,`approved`,
  `rejected`,`cancelled`,`paid`), `supplier_name`, `supplier_document` (CNPJ/CPF),
  `cost_center_id` FK, `requester_email`, `requester_id`, `justification`, `notes`,
  `total_amount numeric(14,2)`, `currency` default `BRL`, type-specific fields
  (`service_start`, `service_end`, `service_period`, `advance_purpose`,
  `advance_use_date`, `advance_settlement_deadline`), decision fields (`decided_at`,
  `decided_by_email`, `decision_reason`), `cancelled_at`, payment fields (`paid_at`,
  `paid_by_email`, `payment_reference`), `created_at`. **Immutable** for clients: no
  UPDATE/DELETE policies; all transitions via RPCs.
- **request_items** — FK → purchase_requests, `description`, `quantity`, `unit`,
  `unit_value`, `line_total` (generated), `position`.
- **request_documents** — FK → purchase_requests, `doc_type` enum(`nota_fiscal`,
  `quotation`,`invoice`,`receipt`,`contract`,`other`), `storage_path` (unique),
  `original_filename`, `content_type`, `size_bytes`, `sha256`, `uploaded_by_email`,
  `created_at`. Inserted only by the server route after a validated upload.
- **request_events** — append-only audit: FK, `event_type` enum(`created`,`approved`,
  `rejected`,`cancelled`,`paid`,`document_added`,`notification_queued`), `actor_email`,
  `detail jsonb`, `created_at`. No update/delete for anyone but service role.
- **slack_notification_queue** — FK, `recipient_email`, `message_payload jsonb`,
  `status` enum(`queued`,`sent`,`failed`,`actioned`,`disabled`), `action_token_hash`,
  `created_at`, `sent_at`, `actioned_at`, `error`. Rows are written on submit (status
  `queued`); nothing consumes them yet. Client has zero access to this table.

### Status flow

```
            ┌─────────┐ cancel (owner)            ┌───────────┐
 submit ──► │ pending │ ─────────────────────────►│ cancelled │
            └────┬────┘                           └───────────┘
   approve (head)│ reject (head)
        ┌────────┴─────────┐
        ▼                  ▼
   ┌──────────┐      ┌──────────┐
   │ approved │      │ rejected │
   └────┬─────┘      └──────────┘
        │ mark paid (finance)
        ▼
    ┌──────┐
    │ paid │
    └──────┘
```

## 4. Security model

- Helper functions (all `security definer`, `set search_path = ''`):
  `jwt_email()`, `is_vammo_user()` (authenticated AND email ends `@vammo.com`),
  `has_role(role)`, `is_head_of(cost_center_id)`, `is_head()`, `can_view_request(id)`.
- **Every** policy and RPC starts from `is_vammo_user()`. A non-vammo Google account that
  authenticates sees zero rows and every RPC raises.
- Visibility: requester sees own requests; head sees requests of their centers;
  `finance`/`fiscal` see all. Items/documents/events inherit the parent request's
  visibility.
- Mutations: clients cannot INSERT/UPDATE/DELETE any table directly (single exception:
  `user_profiles` self-row upsert). All writes go through RPCs that validate state
  transitions, permissions, and write audit events atomically:
  `submit_purchase_request(jsonb)`, `cancel_purchase_request(id)`,
  `approve_purchase_request(id)`, `reject_purchase_request(id, reason)`,
  `mark_purchase_request_paid(id, reference)`, `upsert_budget(...)` (finance role).
- Defense in depth at the app layer: middleware rejects non-vammo sessions; server
  routes re-check authorization before any storage operation.
- Recommended (user action): set the Google OAuth app to **Internal** in the Vammo
  Google Workspace so non-vammo accounts can't even start the flow.

## 5. Documents & storage

Supabase Storage, **private** bucket `finance-documents`, zero storage policies →
clients can't touch it; only the server (secret key) can. Rationale vs. Google Drive:
one security boundary (same auth + audit), signed URLs, no second ACL system to leak
from; a Drive export can be added later as a one-way job if fiscal wants Drive browsing.

- Upload: `POST /api/documents` (multipart). Server validates session + request
  visibility + file (PDF/image, ≤ 25 MB, extension and MIME whitelist), computes sha256,
  stores at `{display_id}/{doc_type}/{document_uuid}_{sanitized_original_name}`, inserts
  `request_documents` row + `document_added` event.
- Download: `GET /api/documents/{id}` → authz check → 60-second signed URL.
- Original filename preserved in DB; path carries request display id for fiscal-friendly
  organization; uploads allowed while request is not cancelled/rejected (notas fiscais
  arrive after approval/payment).

## 6. Application

- `/login` — Google sign-in, centered card, Vammo branding.
- `/` (requester home, everyone): centered layout, summary cards (pending/approved/paid
  totals), list of own requests with status chips; click → detail drawer with item table,
  event timeline, documents (view/upload), **cancel** button while pending. "Nova
  solicitação" button → modal with the three request types (products w/ items editor +
  live totals, service, advance), cost-center select grouped by department with
  auto-filled head, justification.
- `/approvals` (heads only): per-center **pie charts** (budget consumed vs. available,
  current month, from `cost_center_budgets` + approved/paid totals) + aggregate; pending
  queue sortable by **value, date, department**; approve/reject with confirmation and
  optional reason.
- `/finance` (finance role): all requests, filters, mark-paid flow with payment
  reference; budget table editing. Fiscal role: same view read-only + documents-first
  listing for NF collection.
- Dark mode: class-based, toggle persisted, defaults to system preference.
- Tabs render by capability (requester always; heads/finance/fiscal conditionally);
  multi-role users see all their tabs.

## 7. Slack (structure only, v2 wiring later)

On submit, the RPC enqueues a `slack_notification_queue` row for each head of the
request's cost center with a `message_payload` (Block Kit-ready JSON including
display id, supplier, amount, requester) and a hashed single-use action token. A future
worker (n8n or Vercel cron) sends the DM with Approve/Reject buttons hitting
`POST /api/slack/interact`, which verifies the Slack signature + token hash and calls the
same approve/reject RPCs. The endpoint ships now returning 501.

## 8. Payments runway (v2+)

`mark_purchase_request_paid` + `request_events` already give an auditable payment record.
A future `payments` table (provider, external_id, webhook states) plugs into the same
RPC layer; provider webhooks land in `/api/payments/webhook`.

## 9. What only the user can do (dashboard checklist)

1. Supabase → Auth → Providers → enable **Google** (create GCP OAuth client, ideally
   *Internal*); callback `https://jfdqlnpidynxwqqiblcd.supabase.co/auth/v1/callback`.
2. Supabase → Auth → URL Configuration: site URL = production domain; add
   `http://localhost:3000` to additional redirect URLs.
3. Supabase → Settings → API → **Exposed schemas**: add `finance`.
4. Supabase → Storage: create **private** bucket `finance-documents`.
5. Vercel project env vars: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
   `SUPABASE_SECRET_KEY` (service role — never committed, never in chat).
6. Later (Slack v2): Slack bot token + signing secret.

## 10. Execution order

1. Migrations: schema/tables → RLS/RPCs → seeds (centers, heads, mock budgets).
2. RLS validation pass (simulated JWTs + advisors).
3. Next.js scaffold (auth, theme) → requester UI → head UI → finance/fiscal UI →
   API routes (documents, Slack stub).
4. Security review (skill checklist) → build/verify → deploy → hand over checklist.
