# charter — governance

How the contract itself changes. The short version: files are cheap to change, rules are not, and the version is not a number you bump to feel productive.

## How rules change

- **Contract files** (INTENT, GUARANTEES, LOOPS, DONE lists, STATE): changed by the orchestrator or worker through the normal slice flow; `charter check` / `check --strict` validate the result on every commit, push and CI run.
- **Stop rules** (`charter/STOP-RULES.md`): agents never relax them. A change exists only as `charter/owner-decisions/<date>-<slug>.md`, recorded before or with the change (mtime-checked), and a *relaxation* (a `relaxes: S<n>` line) additionally requires **two distinct `approved_by:` signers** — one owner key and one other. `charter check` refuses otherwise.
- **The spec version** (`spec_version` in charter.toml): the version of the contract this repo is written against. The binary supports exactly one (`charter v1`, `SUPPORTED_SPEC`). `check --strict` refuses a repo asking for a newer spec, naming both versions — a newer repo needs a newer binary, never silent best-effort handling.

## How the spec version bumps

- A **patch bump** (docs clarifications, additive examples) changes no normative statement; no version change.
- A **minor bump** (an additive normative rule — a new optional field, a new command) increments the spec and the binary together; older binaries refuse the newer repo (the check above), and the release notes list the addition.
- A **major/breaking bump** (a normative statement removed or inverted: a file deleted, an exit-code meaning changed, a refusal turned into a pass) requires an owner decision record and a migration note in the adopting repository's own notes. Breaking changes are rare on purpose: every consumer re-validates at their own pace only if the old binary refuses loudly, which is why the refusal exists.

## What a breaking change is (examples)

Breaking: removing a required charter/ file; changing `charter.receipt/1`'s accepted-verdict conditions; making a warning a refusal or vice versa in the contract layer; renaming a schema field.
Not breaking: adding an optional field (e.g. `trips`, `spec_version`); adding a command; adding a strict-layer refusal (strict is opt-in); rewording a refusal message.

## Receipts and acknowledgements

Every acceptance cites the frozen bytes; every QA receipt is `charter.receipt/1`. A stop-rule relaxation is acknowledged by the verifier in the next receipt for the affected slice (recorded obligation).
