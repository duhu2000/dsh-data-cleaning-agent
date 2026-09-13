# 0.9.10 · Delayed home branding

## Scope

Preserves 0.9.9 sibling-branch compatibility and 0.9.8 Session ownership. Adds observation
of Host settling-to-hero layout transitions and headline text-node updates. The home displays
the blue database logo plus “数据清洗补全智能体”. Both Chinese Host headline variants work.
Unknown layout never falls back to rewriting document.body. Cleanup restores native branding.

## Verification and boundary

Node regression covers delayed mounting, text refresh, reversible cleanup and ordinary-session
isolation. Real React/Chromium matrix exercises settling-to-hero before checking logo placement,
light/dark responsive layouts and active/ordinary Session transitions. Existing workflow tests
remain mandatory. Run npm run check and npm run test:ui before release.

The live localhost DSH tab still requires authentication; no live-host success is claimed.
After upgrading/restarting, click 数据清洗补全, confirm logo/title, then switch to an ordinary
Session and confirm native branding. No paid MCP, OCR or production data is used in tests.

## Publishing

Use PR/main CI gates before annotated v0.9.10, existing GitHub OIDC/provenance workflow,
then registry version/gitHead and tarball read-back. Rollback: 0.9.9 (may miss delayed hero).
