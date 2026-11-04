# Done list — attest-trust-record (written BEFORE dispatch; does not grow during it)
Base bytes: 09906bb (main)

## Problem
On 2026-11-04 the owner directed that each workspace repository has its own Doppler project and an Ed25519 key for Mister Clean semantic attestation, with Doppler canonical. PM-MISTER-CLEAN provisioned odin's key and drafted odin's trust policy. The owner approved every policy ("Approve all.") and accepted custody option (a). odin's policy is active.

The approval is recorded in mister-clean's charter/owner-decisions/2026-11-04-semantic-attestation-trust.md at commit 24a202c (PR #71). odin must record the activation in its own charter.

## Design (fixed for this slice)
- New file charter/owner-decisions/2026-11-04-semantic-attestation-trust.md, a public-safe record. It names:
  - the owner's directive and approval, with the mister-clean record and commit;
  - the Doppler project and config holding the key (`odin` / `attest`; key material never leaves Doppler, and signers reach it only through `doppler run --project odin --config attest`);
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

1. **values-match-doppler.** The key id, the public key's SPKI DER sha256 prefix, and the policy's sha256, policy_id, actor, role and validity in the record equal what Doppler holds. The policy sha256 is computed over the exact stored bytes. No private value is read; the private key is checked by length only.
   - Reopen: `doppler run --project odin --config attest -- sh -c '...'`, computing `printf '%s' "$MISTER_CLEAN_TRUST_POLICY_JSON" | shasum -a 256` and comparing it with `$MISTER_CLEAN_TRUST_POLICY_SHA256`; the public key fingerprint via `openssl pkey -pubin -outform DER | shasum -a 256`; the policy fields via jq.
   - Fail-without mutant: change one hex digit of the policy sha in a scratch copy of the record; the comparison fails.
2. **approval-cited.** The mister-clean commit cited by the record exists and contains the owner's words "Approve all." and odin's row with the same seat and policy sha.
   - Reopen: `git -C <mister-clean clone> show 24a202c -- charter/owner-decisions/2026-11-04-semantic-attestation-trust.md`.
   - Fail-without mutant: show the same file at a commit before 24a202c; the approval section is absent.
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
- none (the owner decided on 2026-11-04; this records it).
