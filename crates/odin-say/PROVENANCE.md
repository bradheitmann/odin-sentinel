# Provenance

This crate is an ingest of the sender half of a field team's reveng-ops crate (export of
2026-10-31). Only the sender was taken: the pane seam, screen classification, the say flow,
the proof record writer, the fake-pane test double, the screen fixtures and the pane rules.
Inbox, status forwarding, control lines, finish-line rendering, run-content watching and the
hard-coded path module were deliberately left out.

Every ingested file was checked against the export's `MANIFEST.sha256` before copying
(`shasum -a 256 -c`), and the checked digests are recorded here. Paths below are
export-relative inside that sender crate. Files were then renamed to this crate (crate,
binary, library and environment-variable prefixes), paths were replaced by configuration, and
the busy-detection and wait behaviour were changed per the slice contract. Each digest
identifies the SOURCE bytes, not the current files.

| Source file | sha256 |
| --- | --- |
| `src/cmux.rs` | `1bdd15f1352e25c5e5be2b264bd60cb71850813e0a4304179cd5270082fb7a39` |
| `src/say.rs` | `4152be9c63639bf040c0b63a62ff0164992c832bee02396a477cb9c3d54b6514` |
| `src/proof.rs` | `893bf0862e5e0c2934951bfcf0f77734431f9f7919a719cfc68df699dc55c31d` |
| `src/timeutil.rs` | `a074d539b8f53720a93bf26990ae1daf491dab28ab6da49991de30fc103aae87` |
| `src/main.rs` | `6843d0bbcb3129d5b75374a9abeb67a5031b16ca26210fda51d65e2d474be37f` |
| `examples/fake_cmux.rs` | `a90ff6667c49573d3ca9d3cfa1b13f821d88e8d9b05813b000162a3815001c3d` |
| `tests/say_screens.rs` | `104070e6beb071d40b0f8f84504adf51d65d5536dd61fe3a3db3afad74437184` |
| `tests/cli.rs` | `3046fedc0a70adb2ab9998277b6b41e976c4606c2ee0cb4d1fde0ad2b3945740` |
| `Cargo.toml` | `93f6dd2d5c74f9603bfaa821c52857feca9ef59dc2e2a1ccf4d9e68e13179831` |
| `Cargo.lock` | `ff9ce75bbb4b0107bb2f9caa2f53afb6bc5d2a4697d7bbb7ba989bb9f537a489` |
| `rust-toolchain.toml` | `fdaf5c39586fd9584852826851a351483d1392a08014fb0925fb1b23da758cd6` |
| `README.md` | `1ef6ab5bf0b2103e19a9c0429c92908c083652e9f39d39e6401b3dbc2cd85d69` |
| pane rules (`pane-rules/pane-rules.json` in the export root) | `cd54927366ccd1fd8bf0bb4c08d4ab689fd07da6511c0a5e116d4f20d23ff30c` |
| delivery lessons (`LESSONS.md` in the export root) | `959744a7e92f9066cdecb1f0e94649a32547b6c793f3800e254bbef40850726d` |

Screen fixtures (all 11, from `tests/fixtures/screens/` in the sender crate) were copied
byte-for-byte from the export; their digests are listed in the export's manifest. One fixture
was synthesized here because no capture existed: `opencode_thinking_scrollback.txt` (an idle
OpenCode pane with leftover `Thinking:` scrollback), built from the idle and footer markers in
the exported pane rules.

## Deliberate changes from the source

- **Busy detection**: the source matched busy words anywhere in the last 14 lines, so a busy
  word left in scrollback read as busy (a false `PANE_STILL_THINKING`). This crate matches a
  busy word only on a live line (spinner glyph or status marker present, or one of the last
  three non-empty lines); a spinner glyph alone is still activity.
- **Wait**: the source waited six fixed 10 s rounds for a busy non-Claude pane. This crate
  waits under a wall-clock budget (`--wait-secs`, default 180) polling every `--poll-secs`
  (default 5), decides on a monotonic clock, and records the polls and milliseconds waited.
- **Paths and identity**: the source had no path module ingested here; the proof log defaults
  to the XDG state directory, the sender role to `EXEC PM`, and every prefix is `ODIN_SAY_*`.
- **Rules as data**: the busy/blocked vocabulary, spinner glyphs and harness detection moved
  from constants in the source into `pane-rules.json`, embedded at build time.

## Slice 2 additions (mid-turn policy)

The harness table in `pane-rules.json` (identity markers, mid-turn policy and queue-evidence
markers) is new here; it was not in the slice 1 source.

Two screen fixtures are REAL captures rather than synthesized or exported text:

| Fixture | What it shows |
| --- | --- |
| `tests/fixtures/screens/pi_busy.txt` | a live Pi pane mid-turn: spinner status line `⠴ Working`, footer `↑165k ↓143k … (auto)` and the model line |
| `tests/fixtures/screens/pi_busy_steer_queued.txt` | the same pane after a steer was typed mid-turn: `Steering: …` with `↳ Option+Up to edit all queued messages` |

Captured 2026-10-31 from a live Pi pane and supplied by the project manager for this slice.
The only redactions are placeholders: the working directory shown in the footer was replaced
with `/workspace/repo`, and no user, host or team name is retained. The queue-evidence markers
in the rules table (`Steering:`, `Option+Up to edit all queued messages`) are read from what
that second capture actually displays; they were not guessed. The provisional stand-ins used
while the captures were being obtained (`*_PROVISIONAL.txt`) are not committed.

## Slice 3 additions (seat cap)

The `capped` block in `pane-rules.json` (markers, turn-output markers, the reset header) is new
here; it was not in the slice 1 source.

Three screen fixtures are REAL captures of agent seats stopped by a provider's free-tier daily
cap, taken 2026-11-02 from panes whose cap errors sat in the newest output block:

| Fixture | What it shows |
| --- | --- |
| `tests/fixtures/screens/seat_capped_reset.txt` | a capped seat whose error payload includes `X-RateLimit-Reset` (epoch ms) |
| `tests/fixtures/screens/seat_capped_box.txt` | a capped seat in a box-drawing harness, footer mode label "thinking" while capped |
| `tests/fixtures/screens/seat_capped_footer_thinking.txt` | the same harness shape, cap error above a footer that labels itself "thinking" |

Sanitization only: repository paths, seat names, surface ids and message text were replaced with
placeholders (`/workspace/repo`, `EXEC PM`, `Earlier message to this seat (redacted).`); every cap
line, including its JSON payload, the reset value and the footer chrome, is verbatim. Two further
fixtures are CONSTRUCTED from the first capture and labelled as such in the tests:
`seat_capped_stale.txt` (a later turn response appended after the cap, so it is a stale cap) and
`seat_capped_busy.txt` (a live spinner status line added, so the pane is busy and refuses).

## Claude Code queue captures (2026-11-10)

Four screens captured from a live Claude Code pane on 2026-11-10, kept for their STRUCTURE: every
content line above the spinner/status line is replaced line for line by the placeholder
`  <private line removed>` (two leading spaces), so no prose, tool call, tool output, hook message,
repository name, run number, date, surface id or file name survives. The two sub-agent task
descriptions carry the second placeholder `<task description removed>` with their glyphs, agent type
names and timings kept. Byte for byte the fixtures keep: blank lines, the spinner/status line, the
token-count line, both rule lines, the bar line, the footer line, and — in the queued capture — the
queued-text line with the ODIN-SELFTEST probe text and the `ctrl+enter to send now` line. The private
originals stay outside this repository; each sha256 below is of its private original, as captured.

| fixture | private original | sha256 |
| --- | --- | --- |
| `tests/fixtures/screens/claude_busy_self.txt` | `self-busy-before-150930.txt` | `ed18df9c74a9fe7c753e790868199ed9adf7aa055f8f46096b365b6c2daf22b6` |
| `tests/fixtures/screens/claude_busy_typed_not_entered.txt` | `self-typed-not-entered-150931.txt` | `ccef151af5de6cd9ba8445a97dfb91b92b04524cff672b6c29799b474b86e3a5` |
| `tests/fixtures/screens/claude_busy_queued_capture.txt` | `self-queued-150934.txt` | `51fa4bef62f5cc20d655251802d820d8532ab106e16a9db6621587091e95ae45` |
| `tests/fixtures/screens/claude_subagent_selector.txt` | `refused-stale-137-150740.txt` | `a6b2d571e98e095645e9dbbf010b7a6609ec64a58f378867335253d460020c63` |
