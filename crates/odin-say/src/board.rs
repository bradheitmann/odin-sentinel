//! The consumer board: seat map, dispatch check, ordered events, one posted line.
//!
//! Everything here READS the consumer's three hand-written artefacts (seat pages, the board, the
//! shell sender's proof log). The single writer is [`post`], which appends one line. Nothing is
//! moved or rewritten, and a line that cannot be parsed is reported, never dropped.

use crate::timeutil;
use serde_json::{json, Map, Value};
use std::collections::{BTreeMap, BTreeSet};
use std::io::Write;
use std::path::Path;

pub const EXIT_OK: i32 = 0;
pub const EXIT_CHECK_FAILED: i32 = 1;
pub const EXIT_USAGE: i32 = 2;
pub const EXIT_POST_REFUSED: i32 = 3;

/// The seat key rule: upper-case, a leading `C/` and every hyphen removed, so `C/DEV-15`,
/// `DEV-15` and `DEV15` are one seat.
pub fn seat_key(name: &str) -> String {
    let upper = name.trim().to_uppercase();
    let without_c = upper.strip_prefix("C/").unwrap_or(&upper);
    without_c.chars().filter(|c| *c != '-').collect()
}

// ---------------------------------------------------------------------------
// Board lines
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BoardLine {
    pub utc: String,
    pub seat: String,
    pub lane: String,
    pub state: String,
    pub pointer: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LineError {
    Fields(usize),
    Timestamp(String),
    State(String),
}

impl LineError {
    pub fn reason(&self) -> &'static str {
        match self {
            Self::Fields(_) => "MALFORMED_FIELDS",
            Self::Timestamp(_) => "BAD_TIMESTAMP",
            Self::State(_) => "BAD_STATE",
        }
    }

    pub fn detail(&self) -> String {
        match self {
            Self::Fields(n) => format!("expected 5 space-pipe-space fields, found {n}"),
            Self::Timestamp(value) => format!("timestamp {value:?} is not YYYY-MM-DDTHH:MM:SSZ"),
            Self::State(value) => format!("state {value:?} does not start with an upper-case word"),
        }
    }
}

/// `UTC | seat | lane | state | pointer`, exactly five fields, state starting with an
/// upper-case word.
pub fn parse_board_line(raw: &str) -> Result<BoardLine, LineError> {
    let fields: Vec<&str> = raw.split(" | ").collect();
    if fields.len() != 5 {
        return Err(LineError::Fields(fields.len()));
    }
    let utc = fields[0].trim();
    if !is_utc_stamp(utc) {
        return Err(LineError::Timestamp(utc.to_owned()));
    }
    let state = fields[3].trim();
    let first = state.chars().next().unwrap_or(' ');
    if !(first.is_uppercase() && first.is_alphabetic()) {
        return Err(LineError::State(state.to_owned()));
    }
    Ok(BoardLine {
        utc: utc.to_owned(),
        seat: fields[1].trim().to_owned(),
        lane: fields[2].trim().to_owned(),
        state: state.to_owned(),
        pointer: fields[4].trim().to_owned(),
    })
}

/// The state word: the first token of the state field.
pub fn state_word(state: &str) -> &str {
    state.split_whitespace().next().unwrap_or("")
}

pub fn is_utc_stamp(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() == 20
        && bytes[4] == b'-'
        && bytes[7] == b'-'
        && bytes[10] == b'T'
        && bytes[13] == b':'
        && bytes[16] == b':'
        && bytes[19] == b'Z'
        && bytes
            .iter()
            .enumerate()
            .all(|(i, b)| matches!(i, 4 | 7 | 10 | 13 | 16 | 19) || b.is_ascii_digit())
}

fn is_clock_stamp(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() == 9
        && bytes[2] == b':'
        && bytes[5] == b':'
        && bytes[8] == b'Z'
        && [0, 1, 3, 4, 6, 7]
            .iter()
            .all(|i| bytes[*i].is_ascii_digit())
}

/// Seconds since the epoch for a `YYYY-MM-DDTHH:MM:SSZ` stamp (no leap seconds).
pub fn stamp_seconds(stamp: &str) -> Option<i64> {
    if !is_utc_stamp(stamp) {
        return None;
    }
    let num = |range: std::ops::Range<usize>| stamp[range].parse::<i64>().ok();
    let (y, m, d) = (num(0..4)?, num(5..7)?, num(8..10)?);
    let (hh, mm, ss) = (num(11..13)?, num(14..16)?, num(17..19)?);
    let days = days_from_civil(y, m, d)?;
    Some(days * 86_400 + hh * 3600 + mm * 60 + ss)
}

fn days_from_civil(y: i64, m: i64, d: i64) -> Option<i64> {
    if !(1..=12).contains(&m) || !(1..=31).contains(&d) {
        return None;
    }
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let mp = if m > 2 { m - 3 } else { m + 9 };
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    Some(era * 146_097 + doe - 719_468)
}

fn date_of(stamp: &str) -> &str {
    &stamp[..10]
}

// ---------------------------------------------------------------------------
// Proof log
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Delivery {
    pub timestamp: String,
    pub surface: String,
    pub submitted: bool,
    pub state: String,
}

impl Delivery {
    /// A delivery is submitted text whose observed state is a DELIVERED_* verdict. A refusal
    /// record is never a delivery, whatever its stamp says.
    pub fn is_delivery(&self) -> bool {
        self.submitted && self.state.starts_with("DELIVERED_")
    }
}

#[derive(Debug, Default, Clone)]
pub struct ProofLog {
    pub records: Vec<Delivery>,
    pub unparsed: usize,
}

/// Collapse a repeated `surface:` prefix: some hand-written rows carry `surface:surface:1000`.
pub fn normalise_surface(value: &str) -> String {
    let mut rest = value.trim();
    while let Some(tail) = rest.strip_prefix("surface:") {
        rest = tail;
    }
    rest.trim().to_owned()
}

/// Tolerant by line: the shell sender's key=value form, one JSON object per line, or this
/// crate's own records. A line that fits none is counted and never fatal.
pub fn read_proof_log(text: &str) -> ProofLog {
    let mut log = ProofLog::default();
    for raw in text.lines() {
        let line = raw.trim();
        if line.is_empty() {
            continue;
        }
        let parsed = if line.starts_with('{') {
            parse_json_record(line)
        } else {
            parse_key_value_record(line)
        };
        match parsed {
            Some(record) => log.records.push(record),
            None => log.unparsed += 1,
        }
    }
    log
}

fn parse_json_record(line: &str) -> Option<Delivery> {
    let value: Value = serde_json::from_str(line).ok()?;
    let timestamp = value.get("timestamp")?.as_str()?.to_owned();
    let surface = normalise_surface(value.get("target_surface_locator")?.as_str()?);
    let submitted = value.get("submitted")?.as_bool()?;
    let state = value.get("observed_processing_state")?.as_str()?.to_owned();
    if !is_utc_stamp(&timestamp) || surface.is_empty() || state.is_empty() {
        return None;
    }
    Some(Delivery {
        timestamp,
        surface,
        submitted,
        state,
    })
}

fn parse_key_value_record(line: &str) -> Option<Delivery> {
    let mut parts = line.split_whitespace();
    let timestamp = parts.next()?;
    if !is_utc_stamp(timestamp) {
        return None;
    }
    let mut locator = None;
    let mut submitted = None;
    let mut state = None;
    let mut saw_note = false;
    let rest = &line[timestamp.len()..];
    for token in rest.split_whitespace() {
        if saw_note {
            break;
        }
        let Some((key, value)) = token.split_once('=') else {
            continue;
        };
        match key {
            "target_surface_locator" => locator = Some(normalise_surface(value)),
            "submitted" => submitted = Some(matches!(value, "true" | "1")),
            "observed_processing_state" => state = Some(value.to_owned()),
            // `note=` runs to end of line, so nothing after it is a key.
            "note" => saw_note = true,
            _ => {}
        }
    }
    Some(Delivery {
        timestamp: timestamp.to_owned(),
        surface: locator?,
        submitted: submitted?,
        state: state?,
    })
}

// ---------------------------------------------------------------------------
// Seat map
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SeatEntry {
    pub key: String,
    /// The spelling the sources used first (kept for the page).
    pub label: String,
    pub surfaces: BTreeSet<String>,
    pub detail: String,
    pub lane: String,
    pub sources: BTreeSet<String>,
}

#[derive(Debug, Default, Clone)]
pub struct SeatSources {
    pub seats: BTreeMap<String, SeatEntry>,
    pub unparsed: Vec<String>,
}

impl SeatSources {
    fn entry(&mut self, label: &str, source: &str) -> &mut SeatEntry {
        let key = seat_key(label);
        self.seats
            .entry(key.clone())
            .or_insert_with(|| SeatEntry {
                key,
                label: label.trim().to_owned(),
                surfaces: BTreeSet::new(),
                detail: String::new(),
                lane: String::new(),
                sources: BTreeSet::new(),
            })
            .tap_source(source)
    }
}

trait TapSource {
    fn tap_source(&mut self, source: &str) -> &mut Self;
}

impl TapSource for SeatEntry {
    fn tap_source(&mut self, source: &str) -> &mut Self {
        self.sources.insert(source.to_owned());
        self
    }
}

/// Read every seat a page names: markdown tables whose header has `Seat/title` and `Surface`
/// cells, and every `**Seat map:**` line. Anything shaped like an entry that cannot be read is
/// kept verbatim under `unparsed`.
pub fn read_seat_sources(sources: &[(String, String)]) -> SeatSources {
    let mut out = SeatSources::default();
    for (name, text) in sources {
        read_tables(name, text, &mut out);
        read_seat_map_lines(name, text, &mut out);
    }
    out
}

fn read_tables(source: &str, text: &str, out: &mut SeatSources) {
    let lines: Vec<&str> = text.lines().collect();
    let mut i = 0;
    while i < lines.len() {
        let line = lines[i].trim();
        if !line.starts_with('|') {
            i += 1;
            continue;
        }
        let header: Vec<String> = split_row(line);
        let seat_col = header.iter().position(|c| c.trim() == "Seat/title");
        let surface_col = header.iter().position(|c| c.trim() == "Surface");
        if let (Some(seat_col), Some(surface_col)) = (seat_col, surface_col) {
            let mut j = i + 1;
            if j < lines.len() && is_separator(lines[j]) {
                j += 1;
            }
            while j < lines.len() && lines[j].trim().starts_with('|') {
                let cells = split_row(lines[j].trim());
                let label = cells.get(seat_col).map(|c| c.trim()).unwrap_or("");
                let surface = cells.get(surface_col).map(|c| c.trim()).unwrap_or("");
                if !label.is_empty() {
                    // A row naming a seat with an empty Surface cell is a seat with NO_SURFACE,
                    // not a row to drop silently.
                    let entry = out.entry(label, source);
                    if !surface.is_empty() {
                        entry.surfaces.insert(surface.to_owned());
                    }
                }
                j += 1;
            }
            i = j;
            continue;
        }
        i += 1;
    }
}

fn is_separator(line: &str) -> bool {
    let cells = split_row(line.trim());
    !cells.is_empty()
        && cells
            .iter()
            .all(|c| c.trim().chars().all(|ch| matches!(ch, '-' | ':' | ' ')))
}

fn split_row(line: &str) -> Vec<String> {
    line.trim()
        .trim_matches('|')
        .split('|')
        .map(|c| c.to_owned())
        .collect()
}

fn read_seat_map_lines(source: &str, text: &str, out: &mut SeatSources) {
    for raw in text.lines() {
        let Some(rest) = raw.trim().strip_prefix("**Seat map:**") else {
            continue;
        };
        let prefix = digits_prefix(rest);
        // Everything up to and including the `surface:<digits>…` marker is prose (the workspace
        // name and the full-refs note); the entries start after it.
        let entries_text = match rest.find('\u{2026}') {
            Some(at) => &rest[at + '\u{2026}'.len_utf8()..],
            None => match rest.find("...") {
                Some(at) => &rest[at + 3..],
                None => rest,
            },
        };
        let entries_text = entries_text.trim_start_matches([':', ',', ' ', '\t'].as_slice());
        for entry in split_entries(entries_text) {
            let entry = entry.trim();
            if entry.is_empty() {
                continue;
            }
            match parse_seat_entry(entry, prefix.as_deref()) {
                Some((label, short, detail, lane)) => {
                    let long_label = label.trim().to_owned();
                    let seat = out.entry(&long_label, source);
                    if let Some(full) = make_surface(prefix.as_deref(), &short) {
                        seat.surfaces.insert(full);
                    }
                    if !detail.is_empty() {
                        seat.detail = detail;
                    }
                    if !lane.is_empty() {
                        seat.lane = lane;
                    }
                }
                None => {
                    // Prose before the prefix (a workspace name, for example) is not a seat
                    // entry; anything shaped like one that failed to parse is kept verbatim.
                    let looks_like_a_seat = entry
                        .chars()
                        .next()
                        .is_some_and(|c| c.is_uppercase() || c.is_ascii_digit());
                    if entry.len() > 1 && looks_like_a_seat {
                        out.unparsed.push(entry.to_owned());
                    }
                }
            }
        }
    }
}

/// The digits prefix that a seat-map line gives once: `surface:<digits>` followed by an
/// ellipsis (Unicode or ASCII).
fn digits_prefix(text: &str) -> Option<String> {
    let at = text.find("surface:")?;
    let after = &text[at + "surface:".len()..];
    let digits: String = after.chars().take_while(|c| c.is_ascii_digit()).collect();
    if digits.is_empty() {
        return None;
    }
    // The prefix is usually wrapped in backticks and may be separated from the ellipsis by
    // formatting characters: `surface:1000020`…
    let rest = after[digits.len()..].trim_start_matches(['`', ' ', '\t', '*'].as_slice());
    let has_ellipsis = rest.starts_with('\u{2026}') || rest.starts_with("...");
    if has_ellipsis {
        Some(digits)
    } else {
        None
    }
}

/// Entries are separated by `;` or `,`, but a separator inside parentheses (a detail such as
/// `Root110(Codex, PAUSED)`) does not split.
fn split_entries(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut current = String::new();
    let mut depth = 0usize;
    for ch in text.chars() {
        match ch {
            '(' => {
                depth += 1;
                current.push(ch);
            }
            ')' => {
                depth = depth.saturating_sub(1);
                current.push(ch);
            }
            ';' if depth == 0 => {
                out.push(std::mem::take(&mut current));
            }
            ',' if depth == 0 => {
                out.push(std::mem::take(&mut current));
            }
            _ => current.push(ch),
        }
    }
    out.push(current);
    out
}

/// `NAME=NNN detail(lane)` or `NAMENNN(detail)`.
fn parse_seat_entry(entry: &str, prefix: Option<&str>) -> Option<(String, String, String, String)> {
    if let Some((left, rest)) = entry.split_once('=') {
        let label = left.trim();
        let mut parts = rest.splitn(2, char::is_whitespace);
        let short = parts.next().unwrap_or("").trim();
        if label.is_empty() || short.len() != 3 || !short.chars().all(|c| c.is_ascii_digit()) {
            return None;
        }
        let tail = parts.next().unwrap_or("").trim();
        let (detail, lane) = split_detail(tail);
        return Some((label.to_owned(), short.to_owned(), detail, lane));
    }
    let open = entry.find('(')?;
    let close = entry.rfind(')')?;
    if close < open {
        return None;
    }
    let head = entry[..open].trim();
    if head.len() < 4 {
        return None;
    }
    let (label, short) = head.split_at(head.len() - 3);
    if !short.chars().all(|c| c.is_ascii_digit()) || !label.chars().any(|c| c.is_alphabetic()) {
        return None;
    }
    if prefix.is_none() && short.is_empty() {
        return None;
    }
    let detail = entry[open + 1..close].trim().to_owned();
    Some((label.to_owned(), short.to_owned(), detail, String::new()))
}

/// `detail(lane)`: parenthesised tail is the lane, the rest is the detail.
fn split_detail(tail: &str) -> (String, String) {
    if let (Some(open), Some(close)) = (tail.find('('), tail.rfind(')')) {
        if close > open {
            return (
                tail[..open].trim().to_owned(),
                tail[open + 1..close].trim().to_owned(),
            );
        }
    }
    (tail.trim().to_owned(), String::new())
}

fn make_surface(prefix: Option<&str>, short: &str) -> Option<String> {
    if short.is_empty() {
        return None;
    }
    match prefix {
        Some(prefix) => Some(format!("{prefix}{short}")),
        None => Some(short.to_owned()),
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Pane {
    pub surface: String,
    pub title: String,
    pub pane_ref: String,
}

/// Every object at any depth with a `ref` starting `surface:` and a `title`.
pub fn read_tree_json(text: &str) -> Result<Vec<Pane>, String> {
    let value: Value = serde_json::from_str(text).map_err(|e| format!("tree JSON: {e}"))?;
    let mut panes = Vec::new();
    walk_tree(&value, &mut panes);
    Ok(panes)
}

fn walk_tree(value: &Value, out: &mut Vec<Pane>) {
    match value {
        Value::Object(map) => {
            if let (Some(reference), Some(title)) = (
                map.get("ref").and_then(Value::as_str),
                map.get("title").and_then(Value::as_str),
            ) {
                if reference.starts_with("surface:") {
                    out.push(Pane {
                        surface: normalise_surface(reference),
                        title: title.to_owned(),
                        pane_ref: map
                            .get("pane_ref")
                            .and_then(Value::as_str)
                            .unwrap_or("")
                            .to_owned(),
                    });
                }
            }
            for child in map.values() {
                walk_tree(child, out);
            }
        }
        Value::Array(items) => {
            for child in items {
                walk_tree(child, out);
            }
        }
        _ => {}
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SeatStatus {
    Live,
    TitleMismatch,
    NotLive,
    NoSurface,
    Conflict,
}

impl SeatStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Live => "LIVE",
            Self::TitleMismatch => "TITLE_MISMATCH",
            Self::NotLive => "NOT_LIVE",
            Self::NoSurface => "NO_SURFACE",
            Self::Conflict => "CONFLICT",
        }
    }
}

#[derive(Debug, Clone)]
pub struct SeatRow {
    pub seat: String,
    pub label: String,
    pub surface: String,
    pub live_title: String,
    pub status: SeatStatus,
    pub detail: String,
    pub lane: String,
    pub sources: Vec<String>,
}

#[derive(Debug, Default, Clone)]
pub struct SeatMap {
    pub rows: Vec<SeatRow>,
    pub unparsed: Vec<String>,
    pub unlisted: Vec<Pane>,
}

/// Combine the sources with the live panes. Titles are compared with the seat-key rule, so a
/// pane titled `C/DEV-15` names seat `DEV15`.
pub fn build_seat_map(sources: &SeatSources, panes: &[Pane]) -> SeatMap {
    let mut rows = Vec::new();
    let mut matched_surfaces: BTreeSet<String> = BTreeSet::new();
    let mut matched_panes: BTreeSet<String> = BTreeSet::new();
    for seat in sources.seats.values() {
        let (surface, status) = match seat.surfaces.len() {
            0 => (String::new(), SeatStatus::NoSurface),
            1 => {
                let surface = seat.surfaces.iter().next().cloned().unwrap_or_default();
                match panes.iter().find(|pane| pane.surface == surface) {
                    None => (surface, SeatStatus::NotLive),
                    Some(pane) => {
                        matched_surfaces.insert(surface.clone());
                        if !pane.pane_ref.is_empty() {
                            matched_panes.insert(pane.pane_ref.clone());
                        }
                        if seat_key(&pane.title) == seat.key {
                            (surface, SeatStatus::Live)
                        } else {
                            (surface, SeatStatus::TitleMismatch)
                        }
                    }
                }
            }
            _ => (
                seat.surfaces.iter().cloned().collect::<Vec<_>>().join(", "),
                SeatStatus::Conflict,
            ),
        };
        let live_title = panes
            .iter()
            .find(|pane| pane.surface == surface)
            .map(|pane| pane.title.clone())
            .unwrap_or_default();
        rows.push(SeatRow {
            seat: seat.key.clone(),
            label: seat.label.clone(),
            surface,
            live_title,
            status,
            detail: seat.detail.clone(),
            lane: seat.lane.clone(),
            sources: seat.sources.iter().cloned().collect(),
        });
    }
    rows.sort_by(|a, b| a.seat.cmp(&b.seat));
    // Live but unlisted: a pane sharing a pane with a matched seat that no source names.
    let unlisted = panes
        .iter()
        .filter(|pane| !matched_surfaces.contains(&pane.surface))
        .filter(|pane| !pane.pane_ref.is_empty() && matched_panes.contains(&pane.pane_ref))
        .cloned()
        .collect();
    SeatMap {
        rows,
        unparsed: sources.unparsed.clone(),
        unlisted,
    }
}

/// The markdown page: a count summary, one row per seat, then the unparsed entries and the live
/// but unlisted panes. Nothing is dropped.
pub fn seat_map_markdown(map: &SeatMap) -> String {
    let live = map
        .rows
        .iter()
        .filter(|r| r.status == SeatStatus::Live)
        .count();
    let mut out = String::new();
    out.push_str(&format!(
        "Seat map: {} seats, {live} live, {} not live, {} title mismatch, {} no surface, {} conflict, {} unparsed, {} live but unlisted.\n\n",
        map.rows.len(),
        map.rows.iter().filter(|r| r.status == SeatStatus::NotLive).count(),
        map.rows.iter().filter(|r| r.status == SeatStatus::TitleMismatch).count(),
        map.rows.iter().filter(|r| r.status == SeatStatus::NoSurface).count(),
        map.rows.iter().filter(|r| r.status == SeatStatus::Conflict).count(),
        map.unparsed.len(),
        map.unlisted.len()
    ));
    out.push_str("| Seat | Surface | Live title | Status | Detail | Lane | Sources |\n");
    out.push_str("|---|---|---|---|---|---|---|\n");
    for row in &map.rows {
        out.push_str(&format!(
            "| {} | {} | {} | {} | {} | {} | {} |\n",
            row.seat,
            cell(&row.surface),
            cell(&row.live_title),
            row.status.as_str(),
            cell(&row.detail),
            cell(&row.lane),
            cell(&row.sources.join(", "))
        ));
    }
    out.push_str("\n### Unparsed entries\n\n");
    if map.unparsed.is_empty() {
        out.push_str("(none)\n");
    } else {
        for entry in &map.unparsed {
            out.push_str(&format!("- {entry}\n"));
        }
    }
    out.push_str("\n### Live but unlisted\n\n");
    if map.unlisted.is_empty() {
        out.push_str("(none)\n");
    } else {
        for pane in &map.unlisted {
            out.push_str(&format!(
                "- surface:{} title={} pane={}\n",
                pane.surface,
                cell(&pane.title),
                cell(&pane.pane_ref)
            ));
        }
    }
    out
}

fn cell(value: &str) -> String {
    value.replace('|', "\\|").replace('\n', " ")
}

pub fn seat_map_json(map: &SeatMap) -> Value {
    json!({
        "rows": map.rows.iter().map(|row| json!({
            "seat": row.seat,
            "label": row.label,
            "surface": row.surface,
            "live_title": row.live_title,
            "status": row.status.as_str(),
            "detail": row.detail,
            "lane": row.lane,
            "sources": row.sources,
        })).collect::<Vec<_>>(),
        "unparsed": map.unparsed,
        "unlisted": map.unlisted.iter().map(|pane| json!({
            "surface": pane.surface, "title": pane.title, "pane_ref": pane.pane_ref
        })).collect::<Vec<_>>(),
    })
}

// ---------------------------------------------------------------------------
// Check
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
pub struct Finding {
    pub line_no: usize,
    pub reason: &'static str,
    pub detail: String,
    pub hints: Vec<String>,
}

#[derive(Debug, Default, Clone)]
pub struct CheckReport {
    pub checked: usize,
    pub dispatched: usize,
    pub findings: Vec<Finding>,
}

pub fn check_board(board: &str, log: &ProofLog, seat_map: Option<&Value>) -> CheckReport {
    let mut report = CheckReport::default();
    let mut previous_date: Option<String> = None;
    for (index, raw) in board.lines().enumerate() {
        let line_no = index + 1;
        let trimmed = raw.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        report.checked += 1;
        let line = match parse_board_line(trimmed) {
            Ok(line) => line,
            Err(error) => {
                report.findings.push(Finding {
                    line_no,
                    reason: error.reason(),
                    detail: error.detail(),
                    hints: Vec::new(),
                });
                continue;
            }
        };
        let date = date_of(&line.utc).to_owned();
        previous_date = Some(date.clone());
        if state_word(&line.state) != "DISPATCHED" {
            continue;
        }
        report.dispatched += 1;
        let mut stamps = delivered_stamps(&line.pointer);
        let stamp_field = if stamps.is_empty() {
            stamps = delivered_stamps(&line.state);
            "state"
        } else {
            "pointer"
        };
        if stamps.is_empty() {
            let hints = hints_before(&date, &line.utc, log);
            report.findings.push(Finding {
                line_no,
                reason: "DISPATCH_NO_DELIVERED",
                detail: format!(
                    "no delivered= stamp in the pointer or state field; {}",
                    line.state
                ),
                hints,
            });
            continue;
        }
        let _ = stamp_field;
        let seat = line
            .state
            .split_whitespace()
            .nth(1)
            .map(seat_key)
            .filter(|key| !key.is_empty());
        let seat_surface = seat
            .as_ref()
            .and_then(|key| seat_surface_from_map(seat_map, key));
        for stamp in &stamps {
            let Some(full) = resolve_stamp(&date, stamp) else {
                report.findings.push(Finding {
                    line_no,
                    reason: "BAD_TIMESTAMP",
                    detail: format!("unreadable delivered= stamp {stamp:?}"),
                    hints: Vec::new(),
                });
                continue;
            };
            let matching: Vec<&Delivery> =
                log.records.iter().filter(|r| r.timestamp == full).collect();
            if matching.is_empty() {
                report.findings.push(Finding {
                    line_no,
                    reason: "DELIVERED_NO_PROOF",
                    detail: format!("delivered={stamp} matches no proof-log record"),
                    hints: Vec::new(),
                });
                continue;
            }
            if !matching.iter().any(|record| record.is_delivery()) {
                report.findings.push(Finding {
                    line_no,
                    reason: "DELIVERED_NO_PROOF",
                    detail: format!("delivered={stamp} matches only a refusal (submitted false)"),
                    hints: Vec::new(),
                });
                continue;
            }
            if let Some(wanted) = &seat_surface {
                let ok = matching
                    .iter()
                    .any(|record| record.is_delivery() && &record.surface == wanted);
                if !ok {
                    report.findings.push(Finding {
                        line_no,
                        reason: "DELIVERED_WRONG_TARGET",
                        detail: format!(
                            "delivered={stamp} proves surface {} but seat {} is on {wanted}",
                            matching
                                .iter()
                                .map(|r| r.surface.as_str())
                                .collect::<Vec<_>>()
                                .join(","),
                            seat.clone().unwrap_or_default()
                        ),
                        hints: Vec::new(),
                    });
                }
            }
        }
    }
    let _ = previous_date;
    report
}

fn delivered_stamps(pointer: &str) -> Vec<String> {
    let mut out = Vec::new();
    for token in pointer.split_whitespace() {
        let Some(value) = token.strip_prefix("delivered=") else {
            continue;
        };
        let value = value.trim_matches(|c: char| matches!(c, ',' | ';' | ')' | '.'));
        if is_clock_stamp(value) || is_utc_stamp(value) {
            out.push(value.to_owned());
        }
    }
    out
}

/// A `HH:MM:SSZ` stamp belongs to the line's date, or to the previous day when its time of day
/// is later than the line's own (a board written after midnight about the evening before).
fn resolve_stamp(date: &str, stamp: &str) -> Option<String> {
    if is_utc_stamp(stamp) {
        return Some(stamp.to_owned());
    }
    if !is_clock_stamp(stamp) {
        return None;
    }
    let candidate = format!("{date}T{stamp}");
    Some(candidate)
}

fn hints_before(date: &str, utc: &str, log: &ProofLog) -> Vec<String> {
    let Some(line_seconds) = stamp_seconds(utc) else {
        return Vec::new();
    };
    let mut hints: Vec<String> = log
        .records
        .iter()
        .filter(|record| record.is_delivery())
        .filter_map(|record| stamp_seconds(&record.timestamp).map(|s| (s, record)))
        .filter(|(seconds, _)| *seconds <= line_seconds && line_seconds - *seconds <= 600)
        .map(|(_, record)| {
            format!(
                "delivery {} to surface:{} ({}) within 10 minutes before the line",
                record.timestamp, record.surface, record.state
            )
        })
        .collect();
    hints.truncate(12);
    let _ = date;
    hints
}

fn seat_surface_from_map(seat_map: Option<&Value>, key: &str) -> Option<String> {
    let map = seat_map?;
    let rows = map.get("rows")?.as_array()?;
    for row in rows {
        let row_key = row.get("seat").and_then(Value::as_str).unwrap_or("");
        if seat_key(row_key) != key {
            continue;
        }
        let surface = row.get("surface").and_then(Value::as_str).unwrap_or("");
        if !surface.is_empty() {
            return Some(normalise_surface(surface));
        }
    }
    None
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

/// One JSON object per line, ordered by time then input order: board lines first, then the
/// deliveries and refusals from the first board line's UTC day onward.
pub fn event_log(board: &str, log: &ProofLog) -> Result<String, String> {
    let mut entries: Vec<(i64, u8, usize, Value)> = Vec::new();
    let mut order = 0usize;
    let mut first_day: Option<String> = None;
    let mut unparsed_board = 0usize;
    for (index, raw) in board.lines().enumerate() {
        let trimmed = raw.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        match parse_board_line(trimmed) {
            Ok(line) => {
                if first_day.is_none() {
                    first_day = Some(date_of(&line.utc).to_owned());
                }
                let seconds = stamp_seconds(&line.utc).unwrap_or_default();
                entries.push((
                    seconds,
                    0,
                    order,
                    json!({
                        "kind": "board_line",
                        "line": index + 1,
                        "timestamp": line.utc,
                        "seat": line.seat,
                        "lane": line.lane,
                        "state": line.state,
                        "pointer": line.pointer,
                        "state_word": state_word(&line.state),
                    }),
                ));
            }
            Err(error) => {
                unparsed_board += 1;
                entries.push((
                    i64::MIN,
                    2,
                    order,
                    json!({
                        "kind": "board_line_unparsed",
                        "line": index + 1,
                        "reason": error.reason(),
                        "detail": error.detail(),
                        "raw": trimmed,
                    }),
                ));
            }
        }
        order += 1;
    }
    let day = first_day.unwrap_or_else(|| "0000-00-00".to_owned());
    for record in &log.records {
        if date_of(&record.timestamp) < day.as_str() {
            continue;
        }
        let seconds = stamp_seconds(&record.timestamp).unwrap_or_default();
        entries.push((
            seconds,
            1,
            order,
            json!({
                "kind": "delivery",
                "timestamp": record.timestamp,
                "surface": record.surface,
                "submitted": record.submitted,
                "state": record.state,
                "is_delivery": record.is_delivery(),
            }),
        ));
        order += 1;
    }
    entries.sort_by_key(|(seconds, rank, order, _)| (*seconds, *rank, *order));
    let mut out = String::new();
    for (_, _, _, value) in entries {
        out.push_str(&value.to_string());
        out.push('\n');
    }
    let _ = unparsed_board;
    Ok(out)
}

// ---------------------------------------------------------------------------
// Post
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
pub struct PostRequest {
    pub seat: String,
    pub lane: String,
    pub state: String,
    pub text: String,
    pub pointer: String,
    pub surface: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PostRefusal {
    Field(String),
    NoDelivery(String),
}

impl PostRefusal {
    pub fn message(&self) -> String {
        match self {
            Self::Field(field) => format!("field {field} contains a pipe or a line break"),
            Self::NoDelivery(detail) => detail.clone(),
        }
    }

    pub fn exit_code(&self) -> i32 {
        match self {
            Self::Field(_) => EXIT_USAGE,
            Self::NoDelivery(_) => EXIT_POST_REFUSED,
        }
    }
}

/// Build the line `post` would append, stamped with `now` (unix seconds). A DISPATCHED line
/// requires a surface and a delivery to it inside the window; without one this refuses.
pub fn build_post_line(
    request: &PostRequest,
    now_unix: u64,
    log: Option<&ProofLog>,
    window_secs: u64,
) -> Result<String, PostRefusal> {
    for (name, value) in [
        ("seat", &request.seat),
        ("lane", &request.lane),
        ("state", &request.state),
        ("text", &request.text),
        ("pointer", &request.pointer),
    ] {
        if value.contains('|') || value.contains('\n') || value.contains('\r') {
            return Err(PostRefusal::Field(name.to_owned()));
        }
    }
    let state = format!("{} {}", state_word(&request.state), request.text.trim())
        .trim()
        .to_owned();
    let mut pointer = request.pointer.trim().to_owned();
    if state_word(&state) == "DISPATCHED" {
        let Some(surface) = request.surface.as_deref().map(normalise_surface) else {
            return Err(PostRefusal::NoDelivery(
                "state DISPATCHED requires --surface and a delivery to it".to_owned(),
            ));
        };
        let Some(log) = log else {
            return Err(PostRefusal::NoDelivery(
                "state DISPATCHED requires --proof-log with a delivery to --surface".to_owned(),
            ));
        };
        let now = now_unix as i64;
        let found = log
            .records
            .iter()
            .filter(|record| record.is_delivery() && record.surface == surface)
            .filter_map(|record| stamp_seconds(&record.timestamp).map(|s| (s, record)))
            .filter(|(seconds, _)| *seconds <= now && now - *seconds <= window_secs as i64)
            .max_by_key(|(seconds, _)| *seconds);
        let Some((seconds, record)) = found else {
            return Err(PostRefusal::NoDelivery(format!(
                "no delivery to surface:{surface} within the last {window_secs}s; nothing written"
            )));
        };
        let stamp = &record.timestamp[11..20];
        pointer = format!("{pointer} delivered={stamp}");
        let _ = seconds;
    }
    Ok(format!(
        "{} | {} | {} | {} | {}",
        timeutil::format_utc(now_unix),
        request.seat.trim(),
        request.lane.trim(),
        state,
        pointer
    ))
}

/// Append the line with ONE append write. Returns the bytes written.
pub fn append_line(path: &Path, line: &str) -> std::io::Result<usize> {
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)?;
    let payload = format!("{line}\n");
    file.write_all(payload.as_bytes())?;
    file.sync_all()?;
    Ok(payload.len())
}

/// Write `contents` to `path` through a temporary file in the same directory, then rename.
pub fn write_renamed(path: &Path, contents: &str) -> std::io::Result<()> {
    let tmp = path.with_extension(format!(
        "{}.tmp",
        path.extension().and_then(|e| e.to_str()).unwrap_or("out")
    ));
    std::fs::write(&tmp, contents)?;
    std::fs::rename(&tmp, path)
}

/// Read a file, or stdin when the path is `-`.
pub fn read_source(path: &str) -> Result<String, String> {
    if path == "-" {
        use std::io::Read;
        let mut buffer = String::new();
        std::io::stdin()
            .read_to_string(&mut buffer)
            .map_err(|e| format!("stdin: {e}"))?;
        return Ok(buffer);
    }
    std::fs::read_to_string(path).map_err(|e| format!("{path}: {e}"))
}

/// The JSON row set `board check` accepts as `--seat-map-json`.
pub fn seat_map_rows(map: &SeatMap) -> Map<String, Value> {
    match seat_map_json(map) {
        Value::Object(map) => map,
        _ => Map::new(),
    }
}
