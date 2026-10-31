# odin-say

The ODIN sender for terminal-pane dispatch. One binary, one job: deliver ONE line to a pane,
verify it was submitted by reading the pane back, and append a proof record. Exit 0 only for
`DELIVERED_*`.

It is the sender side of the ODIN CMUX delivery proof: a dispatch is not delivered until the
text is submitted with Enter and processing is verified on the target by a read-screen.

## Usage

```
odin-say say <surface> <text...> [--poll-secs N] [--wait-secs N] [--proof FILE] [--sender-role ROLE] [--pane-rules FILE]
odin-say status <surface> [--pane-rules FILE]
```

`<surface>` may be bare (`7`) or already a locator (`surface:7`). Text is flattened to a single
line for every harness (newlines, carriage returns and tabs become spaces), because some
harnesses submit on every embedded newline.

## What it does

1. Read the pane and classify it from the pane rules: blocked, busy, stale input, idle.
2. **Blocked** (permission prompt, non-dismissible overlay): refuse at once with
   `PANE_BLOCKED_ON_PERMISSION`; nothing is typed. A dismissible overlay gets one Escape and
   the pane is re-read.
3. **Busy**: wait, re-reading every `--poll-secs` (default 5) under a `--wait-secs`
   (default 180) wall-clock budget; send as soon as the pane is idle. Only a pane still busy
   when the budget is spent is refused (`PANE_STILL_THINKING`), recording the polls made and
   the milliseconds waited. Claude Code panes queue input while working, so for them a busy
   pane is a send, not a refusal.
4. **Stale input**: an idle pane whose input bar holds text gets that text submitted first.
5. Send the flattened line, wait, send exactly one Enter, read back. If the input bar still
   shows the message, re-Enter ONCE.
6. Classify the result: `DELIVERED_ACKED` (echo/response observed), `DELIVERED_NO_ACK`
   (processing or prompt cleared), or `INPUT_BAR_ONLY` (still stranded).
7. Append a JSONL proof record.

Busy detection counts only LIVE lines: a busy word marks a pane busy only on a line that also
carries a spinner glyph or a harness status marker, or on one of the last three non-empty
lines. Leftover scrollback (for example an old `Thinking:` line above an idle prompt) never
makes a pane busy; matching busy words anywhere in the tail was a field defect that produced
false refusals.

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | delivered (`DELIVERED_ACKED` or `DELIVERED_NO_ACK`) |
| 2 | blocked pane (`PANE_BLOCKED_ON_PERMISSION`) |
| 3 | pane still busy after the wait budget (`PANE_STILL_THINKING`) |
| 4 | stale input would not submit (`INPUT_BAR_ONLY`) |
| 5 | the send itself failed (`INPUT_BAR_ONLY`) |
| 6 | the message stayed in the input bar after two Enters (`INPUT_BAR_ONLY`) |

A non-zero exit means NOT delivered.

## Proof records

One JSON object per attempt, append-only:

```json
{"record_kind":"delivery","timestamp":"2026-10-31T00:00:00Z","subcommand":"say","target_surface_locator":"surface:7","submitted":true,"verification_method":"read_screen","observed_processing_state":"DELIVERED_ACKED","sender_role":"EXEC PM","note":"echoed","polls":1,"waited_ms":0}
```

`record_kind` is `delivery` when text was submitted (whatever the verification said) and
`send_refusal` for a pre-send refusal, so a refusal can never be read as a delivery. Every
record also carries the six CMUX delivery-proof fields (`target_surface_locator`, `submitted`,
`verification_method`, `observed_processing_state`, `timestamp`, `sender_role`), the outcome
`note`, and the wait evidence (`polls`, `waited_ms`).

## Configuration

Flag, then environment, then a cloud-friendly default. No home directory, machine name or
team directory is baked into the crate.

| Setting | Flag | Environment | Default |
| --- | --- | --- | --- |
| proof log | `--proof` | `ODIN_SAY_PROOF` | `$XDG_STATE_HOME/odin/delivery-proof.jsonl`, else `~/.local/state/odin/delivery-proof.jsonl` |
| sender role | `--sender-role` | `ODIN_SAY_SENDER_ROLE` | `EXEC PM` |
| pane rules | `--pane-rules` | `ODIN_SAY_PANE_RULES` | embedded `pane-rules.json` |
| pane binary | — | `ODIN_SAY_CMUX` | `cmux` on `PATH` |
| wait poll | `--poll-secs` | — | 5 s |
| wait budget | `--wait-secs` | — | 180 s |

The proof log's directory is created on first write. `ODIN_SAY_TIME_SCALE` scales every real
sleep (end-to-end tests set it to 0).

## Pane rules as data

`pane-rules.json` is embedded at build time and can be replaced with `--pane-rules <file>` /
`ODIN_SAY_PANE_RULES`. It holds the blocked/busy vocabulary, spinner glyphs, status markers,
the dismissible overlay, Claude Code detection and the live-line window. The sender hard-codes
none of that vocabulary.

## Build and test

```
cargo fmt --check
cargo clippy --locked --all-targets -- -D warnings
cargo test --locked        # run the whole suite so examples/fake_cmux is built
```

Toolchain: 1.88.0 (`rust-toolchain.toml`), `Cargo.lock` committed.
