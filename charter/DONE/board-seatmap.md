# Done list — board-seatmap (written BEFORE dispatch; does not grow during it)
Base bytes: 34965e6 (main)
Authority: the repository was PARKED on 2026-11-06. The owner's plan of 2026-11-10 assigns this repository one contribution, relayed by the acting EXEC-PM; the park is lifted for this slice only.
Problem: a consumer team runs many agent seats in terminal panes. Its coordinator keeps a hand-written board (one line per state change) and sends with a shell sender that appends a delivery-proof log. Three things are done by eye today:
- knowing which seat sits on which pane: the seat list lives in prose and tables across two hand-written pages and is never compared with the live panes;
- knowing that a board line saying DISPATCHED was really delivered: the `delivered=` stamp is typed by hand from the proof log;
- reading board and deliveries as one ordered record.
Design (fixed for this slice): new `board` subcommands in crates/odin-say. They only read the consumer's files; the one writer (`post`) appends. Nothing is moved or rewritten. No new dependency.
- Board line grammar (the consumer's existing format): `UTC | seat | lane | state | pointer`, fields separated by space-pipe-space, exactly five. UTC is `YYYY-MM-DDTHH:MM:SSZ`. The state field starts with an upper-case state word. Lines starting with `#` and blank lines are skipped.
- Proof-log reader, tolerant by line. It accepts (a) the shell sender's form: a UTC timestamp, then `key=value` pairs including `target_surface_locator`, `submitted`, `observed_processing_state`, with `note=` running to end of line; (b) one JSON object per line with those keys and `timestamp`; (c) this crate's own proof records. A repeated `surface:` prefix is collapsed. A line that fits none is counted and reported, never fatal. A record is a delivery when submitted is true and the state starts with `DELIVERED_`.
- `board seat-map --source <file>... --tree-json <file or -> --out-md <file> --out-json <file>`:
  - reads seats from every markdown table whose header has a `Seat/title` cell and a `Surface` cell, and from every line starting `**Seat map:**` (entries separated by `;` or `,`, shaped `NAME=NNN detail(lane)` or `NAMENNN(detail)`, where NNN is a short id completed by the digits prefix given once on that line as `surface:<digits>` followed by an ellipsis);
  - seat key: upper-case, a leading `C/` and hyphens removed, so `C/DEV-15` and `DEV15` are one seat;
  - reads the live panes from the JSON of the terminal multiplexer's tree listing: every object, at any depth, with a `ref` starting `surface:` and a `title`;
  - status per seat: LIVE (the surface exists and its title names the seat), TITLE_MISMATCH, NOT_LIVE, NO_SURFACE, CONFLICT (sources give different surfaces);
  - writes a markdown page: a one-line count summary, one table row per seat (seat, surface, live title, status, detail from the sources, lane, source file names), then "Unparsed entries" verbatim and "Live but unlisted" (surfaces sharing a pane with a matched seat that no source names). Nothing unparsed is dropped silently. The JSON output carries the same rows.
- `board check --board <file> --proof-log <file> [--seat-map-json <file>]`: every line is typed (reasons MALFORMED_FIELDS, BAD_TIMESTAMP, BAD_STATE). Every DISPATCHED line must carry at least one `delivered=HH:MM:SSZ` (or a full UTC) in its pointer field (else DISPATCH_NO_DELIVERED), and each stamp must equal, to the second, a delivery in the proof log (else DELIVERED_NO_PROOF); the date comes from the line, or the previous day when the stamp's time of day is later than the line's. When a seat map is given and the first word after DISPATCHED names a seat in it, a matching delivery must target that seat's surface (else DELIVERED_WRONG_TARGET). For DISPATCH_NO_DELIVERED it prints the deliveries in the ten minutes before the line as fix hints. Exit 0 when every line passes, 1 when any fails, 2 on usage or read errors.
- `board events --board <file> --proof-log <file> --out <file>`: one JSON-lines event log, ordered by time then input order, each line typed `board_line` or `delivery` (deliveries and refusals from the first board line's UTC day onward). Same inputs give the same bytes. Written to a temporary file and renamed.
- `board post --board <file> --seat --lane --state --text --pointer [--surface <id> --proof-log <file> --window-secs 600]`: appends one typed line in one append write, stamped with the current UTC. A field containing a pipe or a line break is refused. State DISPATCHED requires `--surface` and a delivery to that surface inside the window; the line then carries `delivered=`. Without one it exits 3 and writes nothing.
Write scope: crates/odin-say/src/board.rs or crates/odin-say/src/board/ (new), crates/odin-say/src/lib.rs and src/main.rs (wiring only), crates/odin-say/tests/board_*.rs (new), crates/odin-say/tests/fixtures/board/ (new, synthetic: no real paths, names or message text), crates/odin-say/README.md (one section). Nothing else; PM-ODIN writes STATE at acceptance.
Proofs (each: name, what it guarantees, reopen step, fail-without mutant):
1. seat-map-readback: from fixture sources (one seat table, one seat-map line with short ids, one irregular entry) and a fixture tree, the page shows one row per seat with the right surface and status, covering LIVE, TITLE_MISMATCH, NOT_LIVE, NO_SURFACE and CONFLICT; the irregular entry appears under Unparsed; an unlisted pane neighbour appears under Live but unlisted.
   - Reopen: `cargo test --locked --test board_seat_map`.
   - Fail-without mutant: make the seat key keep its hyphen; the table seat and the seat-map-line seat must split into two rows and the test go red.
2. dispatch-delivered: `board check` exits 0 on a fixture board whose DISPATCHED lines all carry stamps matching fixture deliveries, and exits 1 naming the line and reason for each of: no stamp, a stamp with no proof record, a stamp matching only a refusal (submitted false), a stamp matching a delivery to another seat's surface, a four-field line.
   - Reopen: `cargo test --locked --test board_check`.
   - Fail-without mutant: accept records with submitted false as deliveries; the refusal case must then pass and the test go red.
3. event-log: `board events` output is ordered, typed, byte-identical across two runs, and skips nothing silently (the count of unparsed proof lines is reported on stderr and equals the fixture's junk lines).
   - Reopen: `cargo test --locked --test board_events`.
   - Fail-without mutant: drop the time sort; the ordering assertion must go red.
4. post-proved: `board post` with state DISPATCHED appends a line that `board check` passes; with no delivery in the window it exits 3 and the board bytes are unchanged; a field with a pipe is refused; existing lines are byte-identical after a post.
   - Reopen: `cargo test --locked --test board_post`.
   - Fail-without mutant: skip the window lookup and stamp the current time; the no-delivery case must then write a line and the test go red.
5. field-read: run read-only against the consumer's real pages, board and proof log (copies in a scratch directory), `seat-map` lists every seat the pages name with a status, and `check` passes every DISPATCHED line that carries a stamp and reports the rest with fix hints. QA judges whether the seat-map page can be read in under a minute.
   - Reopen: the two commands on QA's own scratch copies.
   - Fail-without mutant: n/a (field read).
6. no-regression: the crate's existing tests, format and lint stay green; `pnpm run audit:public` and `charter check --strict` are green; PR CI is green (charter job red only as NOT CHECKED) before acceptance.
   - Reopen: the gates below; `gh pr checks`.
   - Fail-without mutant: n/a (aggregate).
Gates (exact commands, in crates/odin-say unless noted):
- cargo fmt --check
- cargo clippy --locked --all-targets -- -D warnings
- cargo test --locked
- pnpm run audit:public   (repository root)
- charter check --strict   (repository root, pin ef2b92e)
Out of scope (recorded obligations, not fixed here):
- Sending: the consumer keeps its own sender; this slice reads its proof log.
- A message text or hash in proof records (the shell sender logs neither, so a stamp proves surface and time only).
- npm packaging: the crate is not shipped in the package.
Owner decision points:
- none.
