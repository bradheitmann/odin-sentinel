# Owner decision: semantic attestation trust for this repository (2026-11-04)

**Decided by:** the owner, on 2026-11-04.
- **The directive:** every workspace repository has its own Doppler project and an Ed25519 key for Mister Clean semantic attestation, and Doppler is canonical.
- **First approval:** the owner approved every repository's trust policy ("Approve all.") and accepted custody option (a), below.
- **Second approval:** after the rotation described below, the owner approved this repository's replacement policy ("approve odin").

PM-MISTER-CLEAN provisioned the keys and the policies. Both approvals are recorded in the mister-clean repository at charter/owner-decisions/2026-11-04-semantic-attestation-trust.md:
- "Approve all." at commit 24a202c (merged in PR #71);
- the revocation, the replacement and "approve odin" at commit 858ec1dd (PR #72), with the incident at charter/incidents/2026-11-04-odin-attestation-key-exposure.md.

**Where the key lives:**
- Doppler project `odin`, config `attest`. This is a root config in its own environment, so it inherits nothing from `dev`.
- The key material never leaves Doppler. A signer reaches it only through `doppler run --project odin --config attest -- <command>`.
- Agents inspect the config only through mister-clean's read-only `attest-inspect` helper. It prints public facts and lengths, never a secret value.
- Policies are stored without a trailing newline, and a digest is taken over the exact bytes Doppler stores.

**The active key:**
- Key id: `odin-attest-ed25519-20261104b`, algorithm Ed25519.
- Fingerprint: the public key's SPKI DER sha256 is `6f9b3aaf46da3ff3331cfbb780d9359cb97db2b6e2991a7e03fdec9e9cd3c6e1`.

**The active trust policy:**
- Trusts this one key for one role, `independent_qa`, held by the seat `OD/QA:pi:xiaomi/mimo-v2.6-flash:openrouter`. That seat's model family differs from this repository's author seats.
- Valid from 2026-11-04 to 2027-02-02, as approved.
- Policy sha256, over the stored bytes: `cc052efd1f3283b0773fd0dc55f032e73c44f45267962c93b4cdd9dca7bf1ad4`.

**Rotation (2026-11-04):**
- The first key, `odin-attest-ed25519-20261104` (SPKI sha256 `39056681657cf2ea4d74c38f323a7db79a2d16f04eb15a4d8e65585620fd937c`), and its policy were REVOKED the day they were activated, and both were deleted from Doppler.
- During review of this record, a reviewer seat ran a command meant to list secret names. It printed that key's private value to the seat's terminal, so the value reached the seat's model provider. The seat reported it unprompted.
- That key signed nothing, because no consumer in this repository signs or verifies attestations yet.
- The copy in that seat's local session log and scrollback was deliberately left in place. The key is revoked, so the copy can produce no signature that verifies, and that log is this repository's cost-measurement record. The owner may override.
- Since then, seats never compose Doppler commands against an `attest` config.

**Custody limit (option (a), accepted by the owner):**
- Every agent seat on this host runs as the same OS user with the same Doppler login. So a valid signature proves that an agent on this host signed. It does not prove that the independent seat did the review.
- Independence rests on rule: only the independent seat signs.
- The rotation shows a second limit: host custody cannot control what a seat's own transcript carries.
- The stronger options were not chosen:
  - (b) a Doppler service token held only by the independent seat;
  - (c) a separate OS user or a remote signer.

**Effect on this repository:** no consumer signs or verifies attestations here yet. This file records the trust anchor so that a later Mister Clean semantic run can cite it.
