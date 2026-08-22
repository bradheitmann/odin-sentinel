# Governance-displacement Wave-0 fixtures

`baseline-manifest.json` is the frozen sha256 manifest of `protocol/`,
`src/protocol/`, and `src/mcp/` for EPIC-052 Wave 0.

Regenerate (do not hand-edit):

```
node scripts/audit/generate-govdisp-baseline.mjs
```

The committed fixture must match regeneration byte-for-byte. Tests in
`tests/protocol/govdisp-baseline.test.ts` prove reproducibility and that
`src/protocol/event-registry/types.ts` is not imported by runtime paths.
