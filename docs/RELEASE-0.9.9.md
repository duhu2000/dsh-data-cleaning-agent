# 0.9.9 · Native home title compatibility

Status: stable release. Date: 2026-09-13.

## Scope

- Adapt the reversible native Hero title bridge to Host layouts where the plugin marker and headline live in sibling branches below the composer container.
- Keep the data-cleaning home title fixed at “数据清洗补全智能体” without modifying another business plugin's headline, prompt UI or input focus.
- Preserve the 0.9.8 Profile history ownership, origin Workspace/Session checks and artifact-download behavior.

## Verification

- The coexistence fixture now exercises a sibling-slot Host structure rather than the obsolete nested Hero structure.
- `npm run check` covers syntax, documentation version consistency, marketing metadata, package allowlist and the full Node test suite.
- The React/Chromium layout matrix remains a separate isolated UI gate; real DSH and production QCC Provider behavior require post-install acceptance.

## Install and rollback

```sh
dsh plugin --profile web add dsh-data-cleaning-agent@0.9.9
```

Rollback package: `dsh plugin --profile web add dsh-data-cleaning-agent@0.9.8`.
Do not move or overwrite existing tags or npm versions.
