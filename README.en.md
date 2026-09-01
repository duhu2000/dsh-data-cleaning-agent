# dsh-data-cleaning-agent

> A data cleaning & completion agent plugin for DeepSeek Harness: local CSV/XLSX/JSON engine plus optional Qichacha (QCC) MCP enterprise-data enrichment. Initiated and maintained by the Qichacha (QCC) team.
>
> Current source version / 当前源码版本: **0.4.0** (release candidate; npm `latest` remains 0.3.0)

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

The model only ever receives **aggregate summaries, never raw detail rows**. Details are only
viewed and exported in the same-origin web UI, keeping customer raw data out of model context
by construction.

## Quick start

```bash
dsh plugin --profile web add dsh-data-cleaning-agent
```

Fully restart DeepSeek Harness afterwards (stop and re-run `dsh web`). Then say
"help me clean this batch of company list data" and the plugin loads its built-in Skill and
drives the clean / complete / profile tools.

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
| Skill | `data-cleaning` | guides the model through the workflow |
| QCC Skill enrichment | `enterprise-enrichment` | 0.4.0 release candidate: company panorama, ownership, governance, and historical registration |
| 0.4.0 preflight | web `/data-cleaning/api/phase2/capabilities` | Read-only 16+4 dynamic-tool check; makes no QCC or paid calls |
| QCC Host Bridge | web `/data-cleaning/api/g5/*` | 0.4.0 release candidate: real OAuth/QCC main path verified; expiry refresh and fault injection pending |

## Qichacha MCP enrichment (status and roadmap)

Besides local deterministic completion, the plugin supports Qichacha MCP enterprise-data enrichment:

- **Plan A (model-mediated, first)**: after the user connects Qichacha with
  `qcc-dsh-mcp-oauth`, the Skill guides the model to call
  `mcp__qcc-company__get_company_by_query` / `mcp__qcc-company__get_company_registration_info`
  per company name and feed the fresh registration data back into the completion tool.
- **Plan B (programmatic, 0.4.0 release candidate)**: the Host Bridge now supports batch enrichment,
  idempotency, explicit candidate-resolution resume, manual retry of retryable failures, and
  metadata-only auditing through the public `ctx.tools.execute()` runtime. Paid endpoints require
  both `confirmPaidCalls:true` and a unique `idempotencyKey`; ambiguous candidates are never
  auto-selected. A loopback-only, fail-closed E2E runner is ready. On 2026-09-01 an isolated rc.2
  Host passed real OAuth, restart recovery, and 400 QCC calls across 20 public companies; expiry-time
  token refresh and rate-limit/quota fault injection remain release-blocking gates.

The Bridge accepts both the documented `mcp__qcc-company__*` names and the legacy
`mcp__company__*` names observed from `qcc-dsh-mcp-oauth@0.1.7`. A fresh rc.2 profile must also
install the matching `@deepseek-ai/dsh-mcp-client` explicitly; see the compatibility guide.

See [the 0.4.0 release checklist](docs/RELEASE-0.4.0.md) for scope, blocking gates, and rollback steps.

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
