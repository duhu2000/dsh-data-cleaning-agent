# dsh-data-cleaning-agent

> A data cleaning & completion agent plugin for DeepSeek Harness: local CSV/XLSX/JSON engine plus optional Qichacha (QCC) MCP enterprise-data enrichment. Initiated and maintained by the Qichacha (QCC) team.
>
> Current source version / 当前源码版本: **0.5.3** (stable release)

[![CI](https://github.com/duhu2000/dsh-data-cleaning-agent/actions/workflows/ci.yml/badge.svg)](https://github.com/duhu2000/dsh-data-cleaning-agent/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/dsh-data-cleaning-agent)](https://www.npmjs.com/package/dsh-data-cleaning-agent)
[![npm downloads](https://img.shields.io/npm/dm/dsh-data-cleaning-agent)](https://www.npmjs.com/package/dsh-data-cleaning-agent)
[![GitHub stars](https://img.shields.io/github/stars/duhu2000/dsh-data-cleaning-agent?style=social)](https://github.com/duhu2000/dsh-data-cleaning-agent/stargazers)
[![GitHub forks](https://img.shields.io/github/forks/duhu2000/dsh-data-cleaning-agent?style=social)](https://github.com/duhu2000/dsh-data-cleaning-agent/forks)
[![GitHub release](https://img.shields.io/github/v/release/duhu2000/dsh-data-cleaning-agent)](https://github.com/duhu2000/dsh-data-cleaning-agent/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

## Overview

`dsh-data-cleaning-agent` is a DeepSeek Harness plugin (DSH Bundle plugin) for the common
"customer gave us a messy list of company names / table data" task. Upload CSV / XLSX / JSON,
clean name / phone / amount columns (trim, phone normalization, drop missing-required /
negative-amount / duplicate rows), deterministically complete gaps, profile the batch, and
export clean CSV.

When spreadsheet data is handled in the right-side workbench, the model receives aggregate
summaries by default while full rows stay in the same-origin UI. If the user explicitly pastes
entities, attaches an image, or sends a spreadsheet entity preview through the prompt builder,
that selected content enters model context; the full spreadsheet still remains local to the workbench.

QCC enrichment follows a **bring-your-own connection and account (BYO QCC)** model. Each customer
connects QCC MCP in their own DSH environment and uses quota or billing attached to their own QCC
contract. This plugin does not embed, distribute, or share a maintainer key, does not resell QCC data,
and does not pay or subsidize customer usage. Maintainer credentials are used only in isolated tests
and are never shipped in the package.

## Quick start

```bash
dsh plugin --profile web add dsh-data-cleaning-agent
```

Fully restart DeepSeek Harness afterwards (stop and re-run `dsh web`). Then say
"help me clean this batch of company list data" and the plugin loads its built-in Skill and
drives the clean / complete / profile tools.

After restart, a "Data Cleaning & Completion" entry appears between "New Session" and "Workspaces"
near the top of the sidebar. It opens a dedicated native DSH session with a business landing view,
product/workflow introduction, and a prompt builder at the upper-left of the composer. The builder
accepts pasted entities, locally parsed spreadsheet data, or image attachments and writes an editable
task brief back to the native composer. Five workflow actions (upload, profile, match, enrich, history)
sit below the composer and open the four-step workbench on demand.

Without the `dsh` CLI, use the install script:

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/duhu2000/dsh-data-cleaning-agent/main/install.sh)
```

Or let an agent install it for you:

> Install this plugin for me: https://github.com/duhu2000/dsh-data-cleaning-agent

## Capability matrix

| Capability | Tool / entry | Notes |
| --- | --- | --- |
| Clean | `data_clean_rows` | trim, phone normalization, drop missing-required / negative-amount / duplicate rows |
| Complete | `data_complete_rows` | fill empty amount with 0, empty name with placeholder, report incomplete items |
| Profile | `data_profile` | column overview and amount distribution |
| Parse | web `/data-cleaning/api/mvp/parse` | CSV / XLSX / JSON |
| Async jobs | web `/data-cleaning/api/mvp/jobs` | job state machine + persistent storage |
| UI | web `/data-cleaning/` | upload → clean/complete → export |
| In-app entry | top "Data Cleaning & Completion" entry + five actions below the composer | dedicated business home in the center; opens the Mockup-aligned workbench on demand |
| Prompt builder | `conversation.input.overlay` | text / spreadsheet / image intake, cleaning and enrichment selection, editable native-composer draft |
| Tool cards | `tool.call.toolview` (`data_clean_rows`/`data_complete_rows`/`data_profile`) | render clean/complete/profile result cards in-conversation with running/done/failed state |
| Task progress | workbench header jobs pill | polls `/data-cleaning/api/mvp/jobs`; shows queued / running tasks |
| Skill | `data-cleaning` | guides the model through the workflow |
| QCC Skill enrichment | `enterprise-enrichment` | 0.4.0: company panorama, ownership, governance, and historical registration |
| 0.4.0 preflight | web `/data-cleaning/api/phase2/capabilities` | Read-only 16+4 dynamic-tool check; makes no QCC or paid calls |
| QCC Host Bridge | web `/data-cleaning/api/g5/*` | 0.4.0: real OAuth/QCC path, natural-expiry refresh, and fault injection verified |
| Three-domain enrichment | web `/data-cleaning/api/phase3/*` | 0.5.0: risk 38 + IPR 18 + operation 35, zero-call estimate, user-owned QCC quota confirmation, candidate review, recovery/retry, and two CSV exports |

## Qichacha MCP enrichment (status and roadmap)

Besides local deterministic completion, the plugin supports Qichacha MCP enterprise-data enrichment:

- **Plan A (model-mediated, first)**: after the user connects Qichacha with
  `qcc-dsh-mcp-oauth`, the Skill guides the model to call
  `mcp__qcc-company__get_company_by_query` / `mcp__qcc-company__get_company_registration_info`
  per company name and feed the fresh registration data back into the completion tool.
- **Plan B (programmatic, 0.4.0)**: the Host Bridge supports batch enrichment,
  idempotency, explicit candidate-resolution resume, manual retry of retryable failures, and
  metadata-only auditing through the public `ctx.tools.execute()` runtime. Paid endpoints require
  both `confirmPaidCalls:true` and a unique `idempotencyKey`. The flag means the current user
  confirms use of their own QCC account quota; it does not transfer the charge to the plugin maintainer.
  Ambiguous candidates are never auto-selected. A loopback-only, fail-closed E2E runner is ready. On 2026-09-01 an isolated rc.2
  Host passed real OAuth, restart recovery, and 400 QCC calls across 20 public companies. Natural-expiry
  token refresh, dynamic-tool recovery, a post-refresh real call, and 401/429/quota fault injection also passed.
- **0.5.0 three-domain batch extension (released)**: a frozen 91-tool contract covers risk (38),
  intellectual property (18), and operation (35). The workbench supports domain selection, a zero-call upper-bound
  estimate, separate paid-call confirmation, manual ambiguous-candidate locking, partial-failure retry, 30-minute
  Host-memory recovery, and result/review CSV exports. rc.2 and alpha.2 passed 24/24 zero-call Host smoke checks;
  rc.2 passed actual rendering and Chinese company-field mapping. On 2026-09-03, a minimal real Phase-3 E2E
  using the maintainer's own test account completed one public entity with one risk tool in two actual calls,
  with no review items or errors. IPR and operation were covered by runtime registration, contract, and zero-call gates only.

The Bridge accepts both the documented `mcp__qcc-company__*` names and the legacy
`mcp__company__*` names observed from `qcc-dsh-mcp-oauth@0.1.7`. A fresh rc.2 profile must also
install the matching `@deepseek-ai/dsh-mcp-client` explicitly; see the compatibility guide.

See [the 0.4.0 release record](docs/RELEASE-0.4.0.md) for scope, validation gates, and rollback steps.
See [the Phase-3 acceptance record](docs/PHASE3-ACCEPTANCE.md) and
[the 0.5.0 release record](docs/RELEASE-0.5.0.md) for verification, upgrade, and rollback.
See [the 0.5.1 release record](docs/RELEASE-0.5.1.md) for the README fix and release-text gate.
See [the 0.5.2 release record](docs/RELEASE-0.5.2.md) for native DSH UI alignment, verification, and rollback.
See [the 0.5.3 release record](docs/RELEASE-0.5.3.md) for the business landing view and prompt builder.

See [docs/PLAN-OSS.md](docs/PLAN-OSS.md) for details.

## Local development

Node.js 20 or later. DSH runtime services (`ctx.tools` / `ctx.skills` / `ctx.jobs` /
`ctx.storageDomain` / `webServer` / `webRuntime`) are provided by the Host; locally you only
install `xlsx`:

```bash
npm install --legacy-peer-deps
npm run check
```

`npm run check` runs lint, documentation version consistency, pack whitelist verification and
unit tests.
Real G5 validation must be enabled explicitly according to
[the E2E runbook](docs/G5-E2E-RUNBOOK.md); `npm run e2e:g5` refuses to run by default.
The Phase-3 runner is also disabled by default: `npm run e2e:phase3` only permits a loopback Host,
and real-call mode requires an additional confirmation for use of the maintainer's own test account.

## Configuration

The plugin registers itself as a bundle via `cordis.patch.yml`; `dsh plugin add` adds the
package to the profile's `dsh.profile.bundles` automatically.

## Documentation

- [User guide](docs/USER-GUIDE.md)
- [First contribution](docs/FIRST-CONTRIBUTION.md)
- [Compatibility](docs/COMPATIBILITY.md)
- [Contributing](CONTRIBUTING.md)

## Security & privacy

- Model tools return summaries only; raw detail rows never enter model context.
- Detail data is delivered only via same-origin (`127.0.0.1` / `localhost`) web endpoints;
  untrusted cross-origin requests are rejected.
- Never put tokens, API keys, cookies, OAuth credentials, or real business data in issues, PRs,
  logs, screenshots, or test fixtures.

## License

[MIT](LICENSE) © 2026 dsh-data-cleaning-agent plugin contributors

## Get involved

If the plugin helps you clean company lists faster, consider
[starring the repository](https://github.com/duhu2000/dsh-data-cleaning-agent/stargazers),
[filing an issue](https://github.com/duhu2000/dsh-data-cleaning-agent/issues), or
[contributing a fix](CONTRIBUTING.md).
