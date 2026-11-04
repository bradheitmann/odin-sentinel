# Owner decision: semantic attestation trust for this repository (2026-11-04)

**Decided by:** the owner, on 2026-11-04, in two steps.
- **The directive:** every workspace repository has its own Doppler project and an Ed25519 key for Mister Clean semantic attestation, and Doppler is canonical.
- **The approval:** the owner approved every repository's trust policy ("Approve all.") and accepted custody option (a), below.

PM-MISTER-CLEAN provisioned the key and the policy. Both the directive and the approval are recorded in the mister-clean repository at charter/owner-decisions/2026-11-04-semantic-attestation-trust.md, commit 24a202c (PR #71, still open when this file was written). That record's table lists this repository's row with the same seat and policy digest as below.

**Where the key lives:**
- Doppler project `odin`, config `attest`. This is a root config in its own environment, so it inherits nothing from `dev`.
- The key material never leaves Doppler. A signer reaches it only through `doppler run --project odin --config attest -- <command>`.
- Policies and keys are materialized with `printf '%s'`. A digest is taken over the exact bytes Doppler stores, with no trailing newline.

**The key:**
- Key id: `odin-attest-ed25519-20261104`, algorithm Ed25519.
- Fingerprint: the public key's SPKI DER sha256 begins `39056681657cf2ea`.

**The trust policy:**
- policy_id: `odin-semantic-trust-2026-11-04`, record type `mister-clean.semantic-trust-policy`, schema 1.0.
- Trusts one key for one role: `independent_qa`, held by the seat `OD/QA:pi:xiaomi/mimo-v2.6-flash:openrouter`. That seat's model family differs from this repository's author seats.
- Valid from 2026-11-04T00:00:00Z to 2027-02-02T00:00:00Z.
- Policy sha256, over the stored bytes: `2dce07712af270bd133ba6e0603e0d494c5c0abc581524bc297a232724b459dd`.

**Custody limit (option (a), accepted by the owner):**
- Every agent seat on this host runs as the same OS user with the same Doppler login. So a valid signature proves that an agent on this host signed. It does not prove that the independent seat did the review.
- Independence rests on rule: only the independent seat signs.
- The stronger options were not chosen:
  - (b) a Doppler service token held only by the independent seat;
  - (c) a separate OS user or a remote signer.

**Effect on this repository:** no consumer signs or verifies attestations here yet. This file records the trust anchor so that a later Mister Clean semantic run can cite it.
