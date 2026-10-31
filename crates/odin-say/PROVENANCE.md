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
