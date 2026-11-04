# Ruling summary: retire the legacy local planning corpus (2026-11-01)

**Ruled by:** A/EXEC-PM, the orchestrating executive PM, acting under the owner's delegation. The ruling was given to PM-ODIN during this repository's Mister Clean close on 2026-11-01.

**Scope:** the gitignored, local-only planning and dispatch history of this repository, created before it adopted `charter/` on 2026-10-31:
- the legacy planning corpus: a gitignored planning directory inside the repository (its name is withheld here because this repository's public-surface audit treats it as a private planning path);
- `.odin/dispatches/`, `.odin/tmp/` and `.odin/handoffs/`: runtime dispatch artifacts of the same era;
- one further local-only planning directory of a private tool, not named here because this repository's public-surface audit forbids that name.

**Decision:** the corpus is RETIRED and superseded by `charter/`.
- Nothing is deleted, and nothing is rewritten to conform.
- Only findings that are still live, and that an obligation needs, carry forward. None did: the three slices that were still active had all landed.

**Effect:** the roughly 2,400 pre-charter audit findings in that corpus are history, not open debt. The current state of this repository is `charter/STATE.md`.

**Why this file exists:** Mister Clean's retirement record (`charter/retirements/`) must cite a ruling committed in this repository, with a matching digest, so that an agent cannot ratify its own exemption. This file is that ruling, committed before the record.

**Source:** the full ruling text, with private paths, is kept outside this public repository; its sha256 is f298888da7271a4dc51c065be5da686880d0977bbc7bda973dd4a77250cbe84a. The first public record was charter/STATE.md, PR #18 (merged as 421986c).
