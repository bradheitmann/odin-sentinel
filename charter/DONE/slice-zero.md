# Done list — slice-zero (written BEFORE dispatch; does not grow during it)
Base bytes: 599b905 (release 0.8.0)
Proofs (each: name, what it guarantees, reopen step, fail-without mutant):
1. slice-zero-live: charter/slice-zero.sh builds ODIN, starts the real stdio MCP server and gets valid=true for a sent-and-acknowledged delivery proof and valid=false for a busy-pane refusal (G1).
   - Reopen: from a clean checkout of the frozen tip, run `pnpm install --frozen-lockfile && charter/slice-zero.sh`; compare the `delivered_valid=... refused_valid=...` line.
   - Fail-without mutant: change the REFUSED proof to `"submitted":true` and `DELIVERED_ACKED`; the script must print RED and exit 1.
   - reopened: OD-QA-slice-zero-fe4938a 09bf1d87352c61bdcaebe7d0c5015a5a8235faecbc52cd56b0811b0fd11f5134
2. contract-green: `charter check` exits 0 on the frozen tip (the contract itself is valid).
   - Reopen: rerun `charter check` from a clean checkout of the frozen tip.
   - Fail-without mutant: blank any INTENT.md bullet; `charter check` must refuse.
   - reopened: OD-QA-slice-zero-fe4938a 09bf1d87352c61bdcaebe7d0c5015a5a8235faecbc52cd56b0811b0fd11f5134
3. public-surface-clean: `pnpm run audit:public` passes on the frozen tip, and charter/ itself holds no home path, local agent config path or private project marker (G3).
   - Reopen: rerun `pnpm run audit:public` and `grep -rnE '/User[s]/|[~]/|open_protoco[l]s|[.]codex/|[.]claude/' charter/` (expect no matches) from a clean checkout.
   - Fail-without mutant: add a home path to README.md; the audit must fail.
   - reopened: OD-QA-slice-zero-fe4938a 09bf1d87352c61bdcaebe7d0c5015a5a8235faecbc52cd56b0811b0fd11f5134
Gates (exact commands):
- charter/slice-zero.sh
- charter check
- pnpm run audit:public
- pnpm run typecheck
Out of scope (recorded obligations, not fixed here):
- O1: add charter/ to scripts/audit/public-surface.mjs PUBLIC_ROOTS so G3 covers it mechanically (next slice).
- O2: typed non-delivery verdicts in odin.validate_cmux_delivery_proof, so refusals and INPUT_BAR_ONLY records validate as typed attempts instead of "invalid".
- O3: tests/protocol/event-registry-contention.test.ts fails under concurrent disk load (12 failures in 3 files on one full run, 1 on the next); classify flaky versus real alone before the next QA dispatch (S6).
- O4: wire `charter check --strict` into CI and hooks once charter adopt-1 lands upstream (strict currently refuses DONE/_template.md, a known upstream defect).
Owner decision points:
- Ratify INTENT.md (ratification: pending-owner).
