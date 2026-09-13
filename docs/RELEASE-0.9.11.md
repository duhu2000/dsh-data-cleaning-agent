# 0.9.11 · Real Host home phase

The real DSH Session snapshot does not expose composerPhase. Versions 0.9.9/0.9.10
adapted the DOM rewrite but its caller never enabled it. The former React fixture
supplied that nonexistent property and masked the integration bug.

The cleaning experience now observes data-phase on its own marker's closest Host
root. It never derives the phase from input text or other Sessions. Unknown or active
roots are not treated as home. The observer disconnects on Session changes/unmount.
Hero changes retain the existing reversible logo/title behavior.

Session-scoped factories can also mount after the root ownership event. Restore
ownership from the explicit independently-created cleaning Session namespace;
never infer it from another Session, a task history selection or draft text.

Tests must omit composerPhase, cover settling/hero/active and ordinary Session cleanup.
Real logged-in DSH visual acceptance and final registry evidence are recorded in Release notes.
No paid QCC/OCR calls are needed for branding acceptance. Rollback: 0.9.10 (known title bug).
