//! Proof 1 (seat-map-readback): the page shows one row per seat with the right surface and
//! status, covering LIVE, TITLE_MISMATCH, NOT_LIVE, NO_SURFACE and CONFLICT; the irregular entry
//! is under Unparsed; an unlisted pane neighbour is under Live but unlisted.

use odin_say::board::{
    build_seat_map, read_seat_sources, read_tree_json, seat_key, seat_map_markdown, SeatStatus,
};

fn fixtures() -> std::path::PathBuf {
    std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/board")
}

fn load() -> (Vec<(String, String)>, Vec<odin_say::board::Pane>) {
    let dir = fixtures();
    let sources = vec![
        (
            "staffing.md".to_owned(),
            std::fs::read_to_string(dir.join("staffing.md")).expect("staffing"),
        ),
        (
            "custody.md".to_owned(),
            std::fs::read_to_string(dir.join("custody.md")).expect("custody"),
        ),
    ];
    let tree = std::fs::read_to_string(dir.join("tree.json")).expect("tree");
    (sources, read_tree_json(&tree).expect("tree json"))
}

#[test]
fn repair1_d1_sources_are_base_names_only() {
    let dir = fixtures();
    let sources = vec![
        (
            dir.join("staffing.md").to_string_lossy().into_owned(),
            std::fs::read_to_string(dir.join("staffing.md")).expect("staffing"),
        ),
        (
            dir.join("custody.md").to_string_lossy().into_owned(),
            std::fs::read_to_string(dir.join("custody.md")).expect("custody"),
        ),
    ];
    let panes = read_tree_json(&std::fs::read_to_string(dir.join("tree.json")).expect("tree"))
        .expect("tree json");
    let map = build_seat_map(&read_seat_sources(&sources), &panes);
    let page = seat_map_markdown(&map);
    let json = odin_say::board::seat_map_json(&map);
    for row in &map.rows {
        for source in &row.sources {
            assert!(!source.contains('/'), "source {source} carries a path");
        }
    }
    assert!(
        !json.to_string().contains(&dir.to_string_lossy()[..]),
        "JSON carries a path"
    );
    assert!(
        !page.contains(&dir.to_string_lossy()[..]),
        "page carries a path"
    );
    assert!(page.contains("staffing.md"));
}

#[test]
fn repair1_d2_an_entry_after_the_marker_loses_its_prefix_and_emphasis() {
    let (sources, panes) = load();
    let map = build_seat_map(&read_seat_sources(&sources), &panes);
    let root = map
        .rows
        .iter()
        .find(|row| row.seat == "ROOT")
        .expect("ROOT row");
    assert_eq!(root.surface, "1000000110");
    assert_eq!(root.detail, "Codex, PAUSED");
    // The comma inside the parenthesis did not split the entry.
    assert!(map
        .rows
        .iter()
        .all(|row| row.seat != "CODEX" && row.seat != "PAUSED"));
}

#[test]
fn repair1_d3_detail_stops_at_its_parenthesis_and_tails_are_unparsed() {
    let (sources, panes) = load();
    let map = build_seat_map(&read_seat_sources(&sources), &panes);
    let dev7 = map
        .rows
        .iter()
        .find(|row| row.seat == "DEV7")
        .expect("DEV7 row");
    assert_eq!(dev7.detail, "Model-E, assigned medium");
    assert_eq!(dev7.lane, "in flight, a; b");
    let qa8 = map
        .rows
        .iter()
        .find(|row| row.seat == "QA8")
        .expect("QA8 row");
    assert_eq!(qa8.detail, "Model-B idle");
    assert!(map
        .unparsed
        .iter()
        .any(|entry| entry == "Old contexts are not to receive work"));
}

#[test]
fn the_seat_key_rule_joins_the_two_spellings() {
    assert_eq!(seat_key("C/DEV-15"), "DEV15");
    assert_eq!(seat_key("DEV15"), "DEV15");
    assert_eq!(seat_key("c/qa-2"), "QA2");
    assert_eq!(seat_key("  C/DEV-1 "), "DEV1");
}

#[test]
fn one_row_per_seat_with_every_status_covered() {
    let (sources, panes) = load();
    let parsed = read_seat_sources(&sources);
    let map = build_seat_map(&parsed, &panes);

    let seats: Vec<&str> = map.rows.iter().map(|row| row.seat.as_str()).collect();
    assert_eq!(
        seats,
        vec!["DEV1", "DEV3", "DEV4", "DEV5", "DEV6", "DEV7", "QA2", "QA8", "ROOT"]
    );

    let status = |seat: &str| {
        map.rows
            .iter()
            .find(|row| row.seat == seat)
            .map(|row| row.status)
            .expect("seat present")
    };
    assert_eq!(status("DEV1"), SeatStatus::Live);
    assert_eq!(status("QA2"), SeatStatus::TitleMismatch);
    assert_eq!(status("DEV5"), SeatStatus::NotLive);
    assert_eq!(status("DEV6"), SeatStatus::NoSurface);
    assert_eq!(status("DEV3"), SeatStatus::Conflict);
    assert_eq!(status("DEV4"), SeatStatus::Live);
    assert_eq!(status("DEV7"), SeatStatus::NotLive);
    assert_eq!(status("ROOT"), SeatStatus::NotLive);
}

#[test]
fn a_seat_named_by_two_sources_is_one_row_with_both_sources() {
    let (sources, panes) = load();
    let map = build_seat_map(&read_seat_sources(&sources), &panes);
    let dev1 = map
        .rows
        .iter()
        .find(|row| row.seat == "DEV1")
        .expect("DEV1");
    assert_eq!(dev1.surface, "1000000111");
    assert_eq!(dev1.sources, vec!["custody.md", "staffing.md"]);
    assert_eq!(dev1.lane, "sharedfix");
    // The table seat and the seat-map-line seat are ONE row, not two.
    assert_eq!(map.rows.iter().filter(|row| row.seat == "DEV1").count(), 1);
}

#[test]
fn the_irregular_entry_is_reported_verbatim_and_the_neighbour_is_listed() {
    let (sources, panes) = load();
    let map = build_seat_map(&read_seat_sources(&sources), &panes);
    assert_eq!(
        map.unparsed,
        vec![
            "DEV9(prose only, no id)".to_owned(),
            "Old contexts are not to receive work".to_owned()
        ]
    );
    let unlisted: Vec<&str> = map
        .unlisted
        .iter()
        .map(|pane| pane.surface.as_str())
        .collect();
    assert_eq!(unlisted, vec!["1000000199"]);
}

#[test]
fn the_page_carries_the_summary_rows_and_both_sections() {
    let (sources, panes) = load();
    let map = build_seat_map(&read_seat_sources(&sources), &panes);
    let page = seat_map_markdown(&map);
    assert!(page.starts_with("Seat map: 9 seats, 2 live, 4 not live, 1 title mismatch, 1 no surface, 1 conflict, 2 unparsed, 1 live but unlisted."), "{page}");
    for header in [
        "| Seat | Surface | Live title | Status | Detail | Lane | Sources |",
        "### Unparsed entries",
        "### Live but unlisted",
    ] {
        assert!(page.contains(header), "{header} missing from {page}");
    }
    assert!(page.contains("| DEV1 | 1000000111 | C/DEV-1 | LIVE |"));
    assert!(page.contains("DEV9(prose only, no id)"));
    assert!(page.contains("surface:1000000199"));
}

#[test]
fn the_json_rows_carry_the_same_seats_and_statuses() {
    let (sources, panes) = load();
    let map = build_seat_map(&read_seat_sources(&sources), &panes);
    let json = odin_say::board::seat_map_json(&map);
    let rows = json["rows"].as_array().expect("rows");
    assert_eq!(rows.len(), 9);
    let dev3 = rows.iter().find(|row| row["seat"] == "DEV3").expect("DEV3");
    assert_eq!(dev3["status"], "CONFLICT");
    assert_eq!(json["unparsed"][0], "DEV9(prose only, no id)");
    assert_eq!(json["unparsed"][1], "Old contexts are not to receive work");
}
