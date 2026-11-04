# Done list — attest-trust-record (written BEFORE dispatch; does not grow during it)
Base bytes: 09906bb (main)

## Problem
On 2026-11-04 the owner directed that each workspace repository has its own Doppler project and an Ed25519 key for Mister Clean semantic attestation, with Doppler canonical. PM-MISTER-CLEAN provisioned odin's key and drafted odin's trust policy. The owner approved every policy ("Approve all.") and accepted custody option (a).

During this slice's first QA, odin's first key (odin-attest-ed25519-20261104) was exposed: a reviewer seat's command printed it to its terminal. That key and its policy were revoked and deleted. The owner approved the replacement ("approve odin"): key odin-attest-ed25519-20261104b, policy sha256 cc052efd….

The approvals are recorded in mister-clean's charter/owner-decisions/2026-11-04-semantic-attestation-trust.md:
- "Approve all." at 24a202c (merged in PR #71, main a0ed0f5);
- the revocation, the replacement and "approve odin" at 858ec1dd (PR #72), with the incident at charter/incidents/2026-11-04-odin-attestation-key-exposure.md.

odin must record the active trust anchor and the rotation in its own charter. This DONE list was re-pinned after the rotation, before the second QA.

## Design (fixed for this slice)
- New file charter/owner-decisions/2026-11-04-semantic-attestation-trust.md, a public-safe record. It names:
  - the owner's directive and both approvals, with the mister-clean record and commits;
  - the rotation: the revoked key id and fingerprint, why it was revoked, that it signed nothing, and the incident record;
  - the Doppler project and config holding the key (`odin` / `attest`). Key material never leaves Doppler, and signers reach it only through `doppler run --project odin --config attest`. Agents inspect the config only through mister-clean's read-only `attest-inspect` helper;
  - the key id, algorithm and SPKI fingerprint;
  - the trusted seat, role, validity and policy id;
  - the policy sha256, over the exact stored bytes with no trailing newline;
  - the custody limit, option (a): every seat on the host shares one OS user and one Doppler login, so a signature proves an agent on this host signed, not that the independent seat reviewed. Independence rests on rule.
- PM-ODIN writes STATE at acceptance.
- No other file changes. No secret value appears anywhere.

## Write scope
- charter/owner-decisions/2026-11-04-semantic-attestation-trust.md (new)

PM-ODIN writes STATE at acceptance.

## Proofs
For each proof: what it guarantees, how to reopen it, and its fail-without mutant.

1. **values-match-doppler.** Every value in the record that `attest-inspect odin` prints matches it:
   - the active key id and the public key's SPKI DER sha256;
   - the private key present and matching the public key (length only);
   - the active policy sha256, computed over the stored bytes, equal to the recorded sha;
   - no draft policy;
   - the revocation note naming the old key and its fingerprint.

   The policy's fields (policy_id, actor, role, validity) cannot be read through the helper. They are stated as approved and are bound by that sha.
   - Reopen: `$HOME/.local/state/mister-clean/attestation/attest-inspect odin`, and nothing else against Doppler.
   - Fail-without mutant: change one hex digit of the policy sha in a scratch copy of the record; it no longer equals the helper's output.
2. **approval-cited.** The mister-clean commits cited by the record exist. 24a202c holds the owner's words "Approve all.". 858ec1dd holds "approve odin", the revocation of the first key and the replacement key and policy sha. 24a202c is in mister-clean main.
   - Reopen: `git -C <mister-clean clone> show <commit>:charter/owner-decisions/2026-11-04-semantic-attestation-trust.md` for each commit; `git -C <mister-clean clone> merge-base --is-ancestor 24a202c origin/main`.
   - Fail-without mutant: show the same file at a commit before 858ec1dd; "approve odin" is absent.
3. **no-secret.** Neither the record nor any other changed file contains a private key, a PEM block, a Doppler token or any secret-looking string, and no home path or private marker.
   - Reopen: `pnpm run audit:public`, run bare so its own exit status is read; a grep for PEM key header lines and Doppler service-token prefixes over only the files this slice changes (`git diff --name-only 09906bb`), expecting no match. tests/ keeps deliberately fake token fixtures, so a tree-wide grep is the wrong scope.
   - Fail-without mutant: plant a PEM private-key header line in a scratch copy; the grep matches.
4. **no-regression.** `charter check --strict` (b9323cd1) passes, and PR CI is green before acceptance.
   - Reopen: the same commands.
   - Fail-without mutant: n/a (aggregate).

## Gates (exact commands)
- pnpm run audit:public
- charter check --strict (charter b9323cd1, $HOME/.local/share/charter/bin/b9323cd119f2ef2fe83db21b8ed8f844215e8852/bin/charter)

## Out of scope
- Signing or verifying any attestation (no consumer in odin yet).
- Custody options (b) or (c) (owner chose (a)).

## Owner decision points
- none (the owner decided on 2026-11-04, twice; this records it).
- Recorded, not decided here: PM-ODIN chose not to scrub the exposed copy in the reviewer seat's session log and scrollback, because the key is revoked and the log is the cost-measurement record. The owner may override.
