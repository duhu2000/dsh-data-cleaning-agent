# 0.9.8 · DC-SCOPE-P0

Status: release candidate. Date: 2026-09-13.

## Scope and authorization

Explicit ledger delegation authorizes code, tests, commit/push, PR merge, immutable tag,
GitHub Release, OIDC npm publishing and registry read-back. Base main: 2424c97.
Package: dsh-data-cleaning-agent 0.9.8; qcc-field-contracts stays 0.2.0.
Adopts DSH-UX-001 v1.5.3 at the shared AI-设计/DSH智能体开发交互规范方案.md;
visual reference: DSH智能体_企查查蓝_UI_Mockup_v1.5.0.html.

## Migration and boundaries

- New UI tasks persist immutable originSessionId/originWorkspaceId and bounded display labels.
  Missing Workspace capability is explicitly unknown; never inferred from active/recent Workspace.
- Schema v2 additive read migration returns null origin for legacy records. No bulk rewrite.
- LocalStorage bindings are hints, not ownership proof. Wrong/legacy bindings cannot hydrate
  the current Session; explicit new work creates a new task. Profile history remains readable.
- History selection has separate state and uses GET only. It does not load run rows, rules,
  field selection, paid confirmations or command credentials into the current Session.
- Open-source-Session uses an existing, capability-verified Session only. Missing/deleted
  origins remain read-only; no clone or silent rebind feature is introduced.
- HTTP task mutations and workflow command preparation require matching persisted origin
  for scoped tasks. This is an application isolation guard, not an authentication boundary:
  existing Host same-origin/Profile access controls remain authoritative. Legacy/headless
  origin-less API records remain backwards-compatible; UI never adopts them as current.
- Revision conflict rejects concurrent updates; stale UI snapshots do not overwrite newer ones.
- Customer XLSX and secondary report links remain separated. Downloads reuse saved artifacts.
- Provider audit distinguishes success-data, success-empty, not-required, no-permission,
  failed, unknown without changing field completeness or charging rules. No raw response saved.
- Completed/cancelled workflow states cannot regress. Existing explicit partial-result retry
  is retained; it is not classified as an immutable successful completion.

## Verification

Local evidence (2026-09-13): `npm run check` passed, 275/275 tests, zero failures.
Real React/Chromium layout matrix passed 10/10 (light/dark; 320–1440px).
Artifact preview passed 390/800/1440px with compact rows, two-axis scrolling and fixed headers.
`git diff --check` passed. Remote CI and registry evidence are pending publication.
No separate compiled build: runtime consists of shipped JS;
`npm run check` includes syntax, documentation, package allowlist and full node tests.
Real React/Chromium layout and preview regressions are separate from live DSH.
Tests cover Session A/B, origin persistence across store restart, legacy unknown records,
concurrent revision updates, stale history/current responses, open-origin capability checks,
Tab X/fold/provider-remount and synthetic four-plugin coexistence baseline from PR #13.

**真实 DSH Session A/B 浏览器验收：因本机 DSH Web 未认证而未验证。**
Observed browser text: “dsh web authentication required; reopen the URL printed by dsh web.”
No authentication bypass or token collection attempted. Ledger confirmed this external
condition does not block release if all automated gates pass. Live QCC/OCR/Windows-host
and real four-plugin installation verification are not claimed. Market publishing out of scope.

Minimal user recheck after authentication/restart:
1. In Session A, create a synthetic task without sending paid commands; confirm origin labels.
2. In Session B, enter a different draft/field selection, view A from history, then return to
   current task. B's draft, fields, taskId and stage must remain unchanged.
3. Download A's saved artifact without new MCP calls; open source Session A only via explicit action.
4. Restart/reload, close Tab X, fold/unfold Sidebar, switch among four plugins and repeat.
   Old tasks must say “历史版本未保存来源” and must never replace B's current task.

## Publish and rollback

Follow PR → exact merge main CI → annotated v0.9.8 → Release workflow OIDC/provenance.
Read back npm latest/version/gitHead/attestations, tag SHA and GitHub Release flags.
Rollback package: `dsh plugin --profile web add dsh-data-cleaning-agent@0.9.7`.
Rollback reintroduces history adoption risk; preserve persisted records and do not move tags.
Release evidence will be appended after publication; no market or user acceptance claim.
