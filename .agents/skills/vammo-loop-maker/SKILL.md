---
name: vammo-loop-maker
description: "Use when creating, designing, dry-running, operating, promoting, pausing, retiring, listing, or auditing a Vammo loop: any recurring human ops process on autopilot through SENSE, THINK, ACT, and REPORT. Triggers include automatiza X, cria um loop de Y, piloto automatico, recurring ops reports/alerts/actions, loop registry, zombie/orphan loops, collections, churn, cabinet watchdogs, fleet integrity, fines, retention briefs, and document checks."
triggers:
  - create a Vammo loop
  - design a recurring Vammo ops report
  - dry-run a recurring Vammo alert or action
  - operate or audit an existing Vammo loop
  - promote a Vammo loop from dry-run to live
  - pause or retire a Vammo loop
  - list Vammo loops or inspect the loop registry
  - find orphan or zombie Vammo loops
  - change loop owner, destination, autonomy, runbook, or reporting
  - set or backfill Vammo loop created_by or created_via
  - manual de multas
  - Kustomer ticket loop
  - cabinet error report
  - fleet integrity
  - run-page sharding
  - loop de cobranças
  - cabinet watchdog
  - loops quem criou
  - orphan loops
  - sem ser owner
---

# Vammo Loop Maker

## Overview

A **loop** is a recurring human process running on autopilot through four fixed phases:

```
SENSE -> THINK -> ACT -> REPORT
```

The phase names are the contract; the tools behind each phase are chosen per loop. Metabase and the Vammo MCP are common defaults, not requirements.

Core principle: **evidence before design, dry-run before build, report before action.**
A loop without documented pain is a toy; a loop without a dry-run is a gamble; a loop born acting autonomously is an incident.

## When to Use

- Automating a recurring ops process: "automatiza X", "cria um loop de Y", "bota no piloto automatico".
- Designing a recurring report, alert, or action on any trusted sensing source plus an action/reporting surface.
- Operating, promoting, pausing, retiring, listing, or auditing existing loops.
- Fixing how a loop reports, dedupes, remembers, records authorship, enforces ownership, or appears in the registry.

**When NOT to use:** one-off analyses, pure dashboards, or synchronous request-path logic that belongs in a backend service.

## Phase 1 - Discovery Gates

Run these gates in order before designing:

1. **Anchor in documented pain.** Search Vammo Mind/GBrain for policies, SOPs, or Slack threads describing the manual process: who runs it, how often, and what it costs. Capture the governing policy. Use `find_experts` when available to identify the validator. **No documented pain + no owner -> don't build.**
2. **Size the problem with real queries now.** Run sizing queries before designing: counts, R$, cases/day, error/week. Metabase `analytics` marts are the usual first stop, especially marts built for daily actions (`fct_value_risk_classifier_daily`, `fct_installment_payments`, `mart_churn_reconciliation`). A mart that already encodes the intelligence often makes the loop pure orchestration. **Problem too small for recurrence -> don't build.**
3. **Check existing loops.** Search Mind/GBrain for loop indexes, `loops/registry`, and the ranked backlog (`LOOP_OPPORTUNITIES.md`). The idea may be a sub-report of an existing loop.
4. **Resolve the owner as email.** For loops created through Leonardo/OpenClaw, `owner` is the Vammo email of the person who asked for the loop, never a Slack display name, first name, or prose label. Resolve it from the trusted user profile/contact source; if unavailable, ask for the email before creating or editing the index.
5. **Capture config with the owner.** Before building, agree on cadence/schedule, notification destination, SENSE sources, ACT surface, autonomy level, and `created_by`. Destination is owner-defined; never assume a channel. Start at L1 unless the owner explicitly accepts more risk.

Write this config as structured frontmatter on the loop index, not prose (see REPORT).

## Ownership And Edit Rights

- `owner` is the accountable requester and must be stored as an email address, e.g. `owner: pessoa@vammo.com`.
- Only the current `owner` may edit a loop's config, runbook, notification destination, autonomy, THINK rules, ACT behavior, lifecycle status, or registry row.
- Authorized Leonardo/OpenClaw admins may edit any loop as an administrative override. When doing so, record the actor in the relevant frontmatter/history fields (`retired_by` for pause/retire, runbook notes for other changes).
- If a non-owner asks to edit a loop, do not edit it. Ask for owner approval or ask an admin to approve the change.
- Owner handoff is itself an edit: it must be requested/approved by the current owner or an admin, and the new `owner` must be an email address.
- For old loops with names instead of emails, do not guess. Backfill `owner` only after verifying the person's email.

## Phase 2 - Standard Anatomy

Every loop is specified with exactly these four parts. Do not invent synonyms like Identify/Verify/Notify; shared vocabulary makes loops comparable.

| Part | Common default | Other valid sources/surfaces | Spec must state |
|---|---|---|---|
| **SENSE** | Vammo Metabase | Horus/Kustomer, Slack, Drive SOPs, BigQuery/GA4, Retool, IoT logs | sources, grain, freshness/lag |
| **THINK** | Mind/GBrain context + reasoning rules | deterministic rules, policy checks | prioritization, false-positive filters |
| **ACT** | Vammo MCP or notification destination | n8n, OneSignal, HubSpot, Jira/SO, email | exact tool/action, BO link, approval path |
| **REPORT** | Mind/GBrain, sharded | Slack/Drive mirror when useful | per-run slug, index slug, north-star metric |

**Autonomy ladder - every loop starts at L1 by default:**

- **L1 report-only:** posts findings, takes no action. This often already pays for itself.
- **L2 propose-and-approve:** posts proposed actions with BO links; humans approve in the notification destination; the agent executes approved items via MCP with `confirm:true` where required.
- **L3 autonomous:** acts within guardrails and logs everything. Only after stable L2 runs and explicit owner sign-off. Irreversible actions such as subscription `cancel`, DETRAN indication, and payments never reach L3.

## Phase 3 - Mandatory Dry-Run

The first execution of any loop is a manual dry-run in an agent session before any production flow, cron, or scheduled agent. SENSE and THINK run for real; ACT is simulated.

1. Run the real sizing/detection queries.
2. Apply Think rules and record which candidates were filtered and why.
3. Post the standard dry-run message to the owner-defined notification destination. This is simulated ACT: state exactly what would be executed and why, but execute nothing.
4. Validate delivery by reading the destination back.
5. Write the run findings to Mind/GBrain as a per-run report: table IDs, field IDs, think rules, delivery confirmation, and north-star number.

Dry-run template (PT-BR, adapt only to destination conventions):

```
🔁 [DRY-RUN] Loop <nome> · <data> BRT
_Modo dry-run: nenhuma ação foi executada. Abaixo, o que o loop faria e por quê._

📡 SENSE — fontes + números reais + ⚠️ freshness/lag de cada fonte
🧠 THINK — regras aplicadas, candidatos filtrados (e por quê), achados de data quality
⚡ ACT — o que eu executaria (e não executei): ação numerada por caso,
 com a tool/ação exata, o porquê citando a política, e link do BO
🛡️ Guardrails — pendências p/ sair do dry-run, limitações conhecidas
Fontes: tabelas (IDs), políticas/SOPs (via Mind)
```

**The dry-run is the design's test.** If THINK changes nothing versus raw query output, the loop is a dashboard, not a loop.

## Think Rules

Apply these by default:

| Rule | Why |
|---|---|
| **Snapshot prioritizes, operational D-0 decides.** Never act on a daily snapshot alone; confirm against live/operational state. | 12 of 15 top debtors from a D-3 classifier snapshot had no overdue installment on the day. |
| **Persistence filter (>=2 consecutive days) for state anomalies.** | 52 STORED-bikes-with-rider collapsed to 1 real case; the rest was same-day return noise. |
| **Freshness gate.** Source lag beyond threshold means report-only; do not act. | Stale source + action = acting on a world that no longer exists. |
| **Heartbeat OK is not healthy.** Cross error/event tables with live state. | An ACTIVE, online cabinet can still concentrate swap errors or charging failures. |
| **Null is never a triggered condition.** Missing fields go to a separate human-review list. | Null CNH date treated as "expired" blocks innocent customers. |

## ACT Guardrails

- MCP writes require `confirm:true`; IoT writes also need a clear `reason`.
- Keep approval-in-destination on top at L2.
- Every proposed action carries a backoffice link for fast human verification.
- **Dedupe via Mind/GBrain:** read recent run pages before alerting or acting. Same case already open (SO, thread, fluxo) -> skip.
- Cap per run, add sanity checks, and define a kill switch. If proposed actions exceed N% of base, abort as a likely data issue.
- For infrastructure loops, escalate gradually: alert -> reversible mitigation such as slot `MAINTENANCE` -> never auto-reset mid-operation.

## REPORT - Sharded Memory

Memory turns a recurring script into a loop. It enables dedupe between runs, cross-loop signals, data-quality routing, and trend tracking.

Use one folder per loop, one small page per run, and one stable index:

```
loops/<loop-slug>/index
loops/<loop-slug>/runs/<YYYY-MM-DD>
```

### Index Frontmatter

Every loop index must begin with structured frontmatter. The Mind has ingestion provenance fields, but no reliable author field; authorship must be explicit and queryable.

```yaml
---
type: project
tags: [loop, <loop-slug>]
loop_slug: <loop-slug>
created_by: <person who created the loop>
created_at: <YYYY-MM-DD>
owner: <requester email, e.g. pessoa@vammo.com>
status: dry-run # dry-run | live | paused | retired
cadence: <schedule, e.g. daily 08:00 BRT>
notify: <Slack channel / DM / email / none>
sources: [<SENSE source + table/mart IDs>]
action_surface: <ACT tool/surface>
autonomy: L1 # L1 | L2 | L3
north_star: <metric name>
# close-out fields, filled only when paused/retired
retired_by: <person who turned it off>
retired_at: <YYYY-MM-DD>
retired_reason: <why: paused, superseded, pain gone, merged into <slug>, broken>
---
```

Rules:

- `created_by` is immutable authorship. Set it once when the loop is born; never rewrite it when ownership changes. If unknown for an old loop, use `unknown` rather than guessing.
- `owner` is accountability, must be an email address, and may change only through an owner/admin-approved handoff.
- Edits to loop config, lifecycle, registry, or runbook require the current owner or an authorized admin. A non-owner request is not enough.
- `status` is the declared lifecycle source of truth.
- Moving a loop to `paused` or `retired` requires `retired_by`, `retired_at`, and `retired_reason`. Do not turn loops off silently.
- Authorship or shut-down data written only in prose does not count; it must be queryable frontmatter.

### Lifecycle

| status | meaning | transition rule |
|---|---|---|
| **dry-run** | designed, dry-run validated, not yet production-running | born here |
| **live** | running on cadence | promoted by owner after dry-run passes |
| **paused** | temporarily off; expected to return | fill close-out fields, then flip back to `live` when resumed |
| **retired** | permanently off; terminal | fill close-out fields and keep the page/history |

`zumbi` / red is not a declared status. It is an operational state detected by the Loop Registry Sentinel: a loop marked `live` but not delivering on cadence. Fix it by repairing the loop or declaring `paused`/`retired` with close-out fields.

### Run Pages

- **Per-run page:** write a fresh page per run, never append forever. Include findings, proposed/taken actions, filtered cases with reasons, data-quality catches, source table/field IDs, delivery confirmation, and the run's north-star number. Multiple runs per day get suffixes such as `2026-06-19-am`.
- **Index page:** stable runbook with the required frontmatter, pause/kill-switch instructions, exclusion list, and a rolling table of the last ~20 runs. Trim the table; older runs remain discoverable through tags.
- **Dedupe:** read the last N run pages filtered by the loop tag, sorted newest first. Do not scan an ever-growing log.
- **Tags:** tag index and run pages with `loop` and `<loop-slug>`.
- **North-star metric:** store the raw value on each run page and the trend in the index.

## Registry

Maintain one central page, `loops/registry`, as the declared roster of loops. Each row mirrors the queryable frontmatter fields and links to the loop index:

| loop | created_by | created_at | owner | status | retired_by | retired_at | reason | index |
|---|---|---|---|---|---|---|---|---|
| collections-d1 | Guima | 2026-05-02 | thiago.alcantara@vammo.com | live | - | - | - | `loops/collections-d1/index` |

Keep detail on each loop's index page. The registry is for answering "what loops exist, who created each, what's running, what got turned off, and by whom."

The registry and Loop Registry Sentinel are complementary:

- **Registry = declared truth:** what humans said exists, who created it, who owns it, and intended status.
- **Sentinel = observed truth:** a report-only meta-loop that scans recent pages/deliveries and classifies actual cadence health.

Crossing them catches drift:

- `live` in registry but silent in Sentinel = zombie; repair or close out.
- delivering reports but missing from registry = orphan; add it and backfill `created_by`.

## Production

Dry-run validated -> choose the production substrate with the owner: Windmill, n8n, a service-owned scheduler, or an OpenClaw scheduled agent. The substrate is an implementation detail; SENSE/THINK/ACT/REPORT, autonomy, guardrails, lifecycle, registry, and REPORT memory are the contract.

The loop index page is the runbook: how to pause, who owns it, where it posts, what it can do, who created it, and how to audit it.

## Common Mistakes

| Mistake | Fix |
|---|---|
| Designing before sizing the problem | Phase 1 queries first; numbers go in the spec. |
| First dry-run only after building production flow | Dry-run in an agent session before any build. |
| Custom phase names or rollout vocabulary | Use SENSE/THINK/ACT/REPORT and L1/L2/L3. |
| Assuming Metabase/MCP are the only sources | Use whatever owner-trusted source holds truth; name it explicitly. |
| Hardcoding a notification channel | Destination is owner-defined in Phase 1. |
| Acting straight from a snapshot mart | Snapshot prioritizes; D-0/live state decides. |
| One Mind page that grows every run | Use per-run pages plus a stable index. |
| No per-run memory | Every run gets its own report page. |
| No north-star metric | Define the metric in the spec and record it per run. |
| Authorship left in prose | Set `created_by` and `created_at` in index frontmatter at creation. |
| Owner stored as a name or Slack handle | Resolve and store the requester's Vammo email in `owner`. |
| Editing a loop for someone who is not the owner | Require current-owner approval or an authorized admin override. |
| Turning a loop off silently | Set `status: paused`/`retired` plus close-out fields. |
| Treating registry as Sentinel | Registry is declared truth; Sentinel is observed truth. Crossing them catches zombies and orphans. |
