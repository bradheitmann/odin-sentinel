#!/usr/bin/env bash
set -euo pipefail

# Master resolution is STRUCTURAL: this script lives inside the skill directory
# it propagates, so the default master is that directory itself — resolved from
# the script's own location, never from a machine-local path that can silently
# fall behind the repository. SCP_SKILL_MASTER remains an explicit override.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
DEFAULT_MASTER="$(cd "${SCRIPT_DIR}/.." && pwd -P)"
MASTER="${SCP_SKILL_MASTER:-${DEFAULT_MASTER}}"
VERIFY_ONLY=false
DRY_RUN=false
REPORT_PATH=""

usage() {
  cat <<'USAGE'
Usage: sync-installations.sh [--verify-only] [--dry-run] [--emit-report PATH]

Syncs the master odin-scp skill to runtime copies, generates the harness
adapters from the master SKILL.md, and verifies every installation by exact
content. --verify-only inspects the current fleet and writes nothing.
--dry-run reports what a sync would do and writes nothing at all: no directory
is created and no existing byte is modified.

Installed copies are synchronized snapshots, not intentional forks. A native
target is verified only when its SKILL.md is byte-identical to the master
SKILL.md AND its whole directory tree is identical to the master directory
(`diff -rq`: no changed, extra, or missing file), and an adapter only when it is
byte-identical to the adapter bytes generated from that same master SKILL.md. An installation that is ABSENT is reported by name, is
never counted as verified, and makes the run exit non-zero in every mode.

Adapter generation is deterministic: an adapter is a fixed generated-file header
line, a blank line, and the canonical SKILL.md verbatim. It carries no
timestamp, hostname, or machine-local path, so two generations from the same
master produce byte-identical adapters.

Master resolution: the default master is the skill directory CONTAINING this
script (the repository checkout when run from the repository). The script only
reads master and writes targets; a native target or adapter whose physical
write location (symlinks resolved by the kernel, compared with master by
filesystem identity rather than path spelling) is master, lies inside master,
or is an existing ancestor of master, and an adapter file that shares an inode
with any master file, is skipped (verification still judges it by exact
content), so nothing ever writes back into master. A location that cannot be
attributed (a symlink loop, a newline in a path or link text) is skipped too.

Verify the master link is intact (run from anywhere):
  bash <skill-dir>/scripts/sync-installations.sh --verify-only
With SCP_SKILL_MASTER unset, the reported "master:" line must name <skill-dir>
itself and the reported "skill_sha256:" must equal
  shasum -a 256 <skill-dir>/SKILL.md
If either differs, the structural link is broken and no sync should be run.

Environment overrides:
  SCP_SKILL_MASTER        Master skill directory override. Defaults to the
                          skill directory containing this script.
  SCP_SKILL_TARGETS_FILE  Optional newline-delimited native target directory list.
  SCP_ADAPTER_TARGETS_FILE Optional newline-delimited adapter file list.
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --verify-only)
      VERIFY_ONLY=true
      shift
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --emit-report)
      if [[ $# -lt 2 ]]; then
        echo "--emit-report requires a path" >&2
        exit 2
      fi
      REPORT_PATH="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ "$VERIFY_ONLY" == true && "$DRY_RUN" == true ]]; then
  echo "--verify-only and --dry-run are mutually exclusive" >&2
  exit 2
fi

if [[ -n "$REPORT_PATH" ]]; then
  mkdir -p "$(dirname "$REPORT_PATH")"
  : > "$REPORT_PATH"
fi

emit() {
  if [[ -n "$REPORT_PATH" ]]; then
    printf '%s\n' "$*" | tee -a "$REPORT_PATH"
  else
    printf '%s\n' "$*"
  fi
}

TARGETS=(
  "${HOME}/.agents/skills/odin-scp"
  "${HOME}/.codex/skills/odin-scp"
  "${HOME}/.claude/skills/odin-scp"
  "${HOME}/.config/goose/skills/odin-scp"
  "${HOME}/.config/opencode/skills/odin-scp"
  "${HOME}/.opencode/skills/odin-scp"
  "${HOME}/.crush/skills/odin-scp"
  "${HOME}/.cursor/skills/odin-scp"
  "${HOME}/.cursor/skills-cursor/odin-scp"
  "${HOME}/.kilocode/skills/odin-scp"
  "${HOME}/.openhands/skills/odin-scp"
  "${HOME}/.pi/agent/skills/odin-scp"
  "${HOME}/.zed/skills/odin-scp"
)

ADAPTERS=(
  "${HOME}/.config/droid/prompts/odin-scp.md"
  "${HOME}/.droid/prompts/odin-scp.md"
  "${HOME}/.crush/commands/odin-scp.md"
)

read_targets_file() {
  target_var="$1"
  target_file="$2"

  if [[ ! -f "$target_file" ]]; then
    echo "missing targets file: $target_file" >&2
    exit 1
  fi

  eval "$target_var=()"
  while IFS= read -r line || [[ -n "$line" ]]; do
    case "$line" in
      ""|\#*) continue ;;
      ~/*) line="${HOME}/${line#~/}" ;;
    esac
    eval "$target_var+=(\"\$line\")"
  done < "$target_file"
}

if [[ -n "${SCP_SKILL_TARGETS_FILE:-}" ]]; then
  read_targets_file TARGETS "$SCP_SKILL_TARGETS_FILE"
fi

if [[ -n "${SCP_ADAPTER_TARGETS_FILE:-}" ]]; then
  read_targets_file ADAPTERS "$SCP_ADAPTER_TARGETS_FILE"
fi

MARKERS=(
  "SCP_BOOT_RECEIPT"
  "SCP-TEAM-MANIFEST"
  "self-bootstrap"
  "terminal_locator"
  "vt_state_snapshot"
  "terminal_instance_ref"
  "active_screen"
  "cursor_x"
  "cursor_y"
  "scrollback_rows"
  "render_dirty"
  "workspace_ref"
  "workspace_id"
  "pane_ref"
  "pane_id"
  "surface_ref"
  "surface_id"
  "authority_layer"
  "may_implement"
  "worker_exception_authority"
  "control-plane non-implementation"
  "[SCP-DELEGATE]"
  "[SCP-TERMINAL-DELIVERY]"
  "[SCP-CMUX-DELIVERY]"
  "[SCP-COORDINATION]"
  "[SCP-FINISH]"
  "\$odin-scp --finish"
  "HOOK-EXCEPTION"
  "BLOCKED_BY_LIMIT"
  "post-run hygiene reset"
  "active canonical SCP skill directory"
)

if [[ ! -f "$MASTER/SKILL.md" ]]; then
  echo "missing master SKILL.md: $MASTER/SKILL.md" >&2
  exit 1
fi
# Physical master, resolved by the kernel (`cd -P`) exactly as the reads of
# "$MASTER/SKILL.md" and rsync of "$MASTER/" resolve it; a sentinel keeps any
# trailing newline in the name. The overlap guard compares against this.
MASTER_REAL="$(cd -P "$MASTER" && pwd -P && printf x)"
MASTER_REAL="${MASTER_REAL%x}"
MASTER_REAL="${MASTER_REAL%$'\n'}"
if [[ "$MASTER_REAL" == *$'\n'* ]]; then
  echo "refusing a master path containing a newline: $MASTER" >&2
  exit 1
fi

# Marker presence on the MASTER remains a precondition: it guards against
# propagating a truncated or wrong-file master. It is NOT the verification rule
# for installed copies — those are verified by exact content below, so a copy
# that drifted while still containing every marker fails.
for marker in "${MARKERS[@]}"; do
  grep -Fq "$marker" "$MASTER/SKILL.md" || {
    echo "missing marker in master SKILL.md: $marker" >&2
    exit 1
  }
done

# Deterministic adapter derivation from the canonical SKILL.md. No timestamp, no
# hostname, no machine-local path, no run-varying input of any kind.
ADAPTER_HEADER="<!-- GENERATED FILE: odin-scp adapter derived from the canonical SKILL.md. Do not hand-edit; re-run sync-installations.sh. -->"

adapter_canonical_bytes() {
  printf '%s\n\n' "$ADAPTER_HEADER"
  cat "$MASTER/SKILL.md"
}

master_hash="$(shasum -a 256 "$MASTER/SKILL.md" | awk '{print $1}')"
adapter_hash="$(adapter_canonical_bytes | shasum -a 256 | awk '{print $1}')"

# Master-overlap guard. Nothing ever writes back into master, so every target
# and adapter is attributed to the directory a write would physically land in
# and compared with master by filesystem identity (`-ef`: device + inode),
# never by path spelling. Identity is immune to case-insensitive spellings,
# `link/..` text, symlinked intermediate directories, and hard links.

strip_trailing_slashes() {
  local path="$1"
  while [[ "$path" == */ && "$path" != "/" ]]; do
    path="${path%/}"
  done
  printf '%s\n' "$path"
}

# Set ANCHOR to the physical directory a write to PATH lands in: PATH itself
# when it is (or links to) an existing directory, otherwise the nearest existing
# ancestor of the location a symlinked final component points at (dangling
# links included). Every existing component is resolved by the kernel
# (`cd -P`), never lexically, and the physical path is captured with a sentinel
# so no trailing newline is lost. Returns 1 when the location cannot be
# attributed (a newline in the path, in any link text, or in the physical
# anchor, a symlink loop, a
# dangling intermediate link, or `.`/`..` inside the not-yet-existing part);
# callers treat that as an overlap and skip.
ANCHOR=""
write_anchor() {
  local path link part hops=0
  ANCHOR=""
  if [[ "$1" == *$'\n'* ]]; then
    return 1
  fi
  path="$(strip_trailing_slashes "$1")"
  while [[ -L "$path" ]]; do
    hops=$((hops + 1))
    if (( hops > 40 )); then
      return 1
    fi
    # `-n` prints the link text alone: without it the reader's own terminator
    # makes a text ending in a newline indistinguishable from one without.
    link="$(readlink -n "$path" && printf x)"
    link="${link%x}"
    if [[ -z "$link" || "$link" == *$'\n'* ]]; then
      return 1
    fi
    case "$link" in
      /*) path="$link" ;;
      *) path="$(dirname "$path")/$link" ;;
    esac
    path="$(strip_trailing_slashes "$path")"
  done
  if [[ ! -d "$path" ]]; then
    while :; do
      part="$(basename "$path")"
      path="$(dirname "$path")"
      case "$part" in
        .|..) return 1 ;;
      esac
      if [[ -d "$path" ]]; then
        break
      fi
      if [[ -L "$path" ]]; then
        return 1
      fi
    done
  fi
  ANCHOR="$(cd -P "$path" && pwd -P && printf x)" || return 1
  ANCHOR="${ANCHOR%x}"
  ANCHOR="${ANCHOR%$'\n'}"
  # A newline anywhere in the physical path (an intermediate link or directory
  # name) cannot be walked safely by the dirname-based ancestry checks below.
  if [[ "$ANCHOR" == *$'\n'* ]]; then
    ANCHOR=""
    return 1
  fi
}

# True when the existing physical directory $1 is master or lies inside it.
dir_within_master() {
  local dir="$1"
  while :; do
    if [[ "$dir" -ef "$MASTER_REAL" ]]; then
      return 0
    fi
    if [[ "$dir" == "/" || "$dir" == "." || -z "$dir" ]]; then
      return 1
    fi
    dir="$(dirname "$dir")"
  done
}

# True when the existing directory $1 is a proper ancestor of master.
dir_is_master_ancestor() {
  local dir="$MASTER_REAL"
  while [[ "$dir" != "/" && "$dir" != "." && -n "$dir" ]]; do
    dir="$(dirname "$dir")"
    if [[ "$dir" -ef "$1" ]]; then
      return 0
    fi
  done
  return 1
}

# A native target overlaps master when rsync would write inside master, or
# when it is an existing directory above master (rsync --delete would reach it).
target_overlaps_master() {
  local anchor
  write_anchor "$1" || return 0
  anchor="$ANCHOR"
  if dir_within_master "$anchor"; then
    return 0
  fi
  if [[ -d "$(strip_trailing_slashes "$1")" ]] && dir_is_master_ancestor "$anchor"; then
    return 0
  fi
  return 1
}

# An adapter overlaps master when its write would land inside master, or when
# the existing adapter file shares an inode with any master file (a hard link,
# or a symlink that resolves to one).
adapter_overlaps_master() {
  local adapter anchor master_file
  adapter="$(strip_trailing_slashes "$1")"
  write_anchor "$adapter" || return 0
  anchor="$ANCHOR"
  if dir_within_master "$anchor"; then
    return 0
  fi
  if [[ -e "$adapter" ]]; then
    while IFS= read -r -d '' master_file; do
      if [[ "$adapter" -ef "$master_file" ]]; then
        return 0
      fi
    done < <(find "$MASTER_REAL" -type f -print0)
  fi
  return 1
}

mode="sync"
if [[ "$VERIFY_ONLY" == true ]]; then
  mode="verify-only"
elif [[ "$DRY_RUN" == true ]]; then
  mode="dry-run"
fi

if [[ "$mode" == "sync" ]]; then
  for target in "${TARGETS[@]}"; do
    if target_overlaps_master "$target"; then
      emit "skipping target that resolves to master (nothing ever writes back into master): $target"
      continue
    fi
    mkdir -p "$target"
    rsync -a --delete "$MASTER/" "$target/"
  done

  for adapter in "${ADAPTERS[@]}"; do
    adapter_dir="$(dirname "$adapter")"
    if adapter_overlaps_master "$adapter"; then
      emit "skipping adapter that resolves into master (nothing ever writes back into master): $adapter"
      continue
    fi
    mkdir -p "$adapter_dir"
    adapter_canonical_bytes > "$adapter"
    emit "generated adapter: $adapter"
  done
elif [[ "$mode" == "dry-run" ]]; then
  # A dry run reports the plan and writes NOTHING: no mkdir, no rsync, no
  # adapter write. The verification pass below then reports the real fleet
  # state, and any absence or drift makes the run exit non-zero.
  for target in "${TARGETS[@]}"; do
    if target_overlaps_master "$target"; then
      emit "DRY-RUN would skip target that resolves to master: $target"
    else
      emit "DRY-RUN would sync native target: $target"
    fi
  done
  for adapter in "${ADAPTERS[@]}"; do
    if adapter_overlaps_master "$adapter"; then
      emit "DRY-RUN would skip adapter that resolves into master: $adapter"
    else
      emit "DRY-RUN would generate adapter: $adapter"
    fi
  done
fi

# --- verification by exact content ------------------------------------------
# A native target is a whole-directory snapshot of master: a matching SKILL.md
# with a changed, extra, or missing file anywhere else in the tree is drift.
absent_targets=()
drifted_targets=()
drifted_details=()
verified_targets=0
for target in "${TARGETS[@]}"; do
  if [[ ! -f "$target/SKILL.md" ]]; then
    absent_targets+=("$target/SKILL.md")
    continue
  fi
  target_hash="$(shasum -a 256 "$target/SKILL.md" | awk '{print $1}')"
  if [[ "$target_hash" != "$master_hash" ]]; then
    drifted_targets+=("$target/SKILL.md")
    drifted_details+=("  master=$master_hash target=$target_hash")
  elif ! tree_diff="$(diff -rq -- "$MASTER" "$target" 2>&1)"; then
    drifted_targets+=("$target")
    drifted_details+=("  tree differs from master:"$'\n'"$(printf '%s\n' "$tree_diff" | sed 's/^/    /')")
  else
    verified_targets=$((verified_targets + 1))
  fi
done

absent_adapters=()
drifted_adapters=()
verified_adapters=0
for adapter in "${ADAPTERS[@]}"; do
  if [[ ! -f "$adapter" ]]; then
    absent_adapters+=("$adapter")
    continue
  fi
  this_adapter_hash="$(shasum -a 256 "$adapter" | awk '{print $1}')"
  if [[ "$this_adapter_hash" != "$adapter_hash" ]]; then
    drifted_adapters+=("$adapter|$this_adapter_hash")
  else
    verified_adapters=$((verified_adapters + 1))
  fi
done

if (( ${#absent_targets[@]} > 0 )); then
  for entry in "${absent_targets[@]}"; do
    emit "ABSENT native target: $entry"
  done
fi
if (( ${#drifted_targets[@]} > 0 )); then
  for i in "${!drifted_targets[@]}"; do
    emit "DRIFTED native target: ${drifted_targets[$i]}"
    emit "${drifted_details[$i]}"
  done
fi
if (( ${#absent_adapters[@]} > 0 )); then
  for entry in "${absent_adapters[@]}"; do
    emit "ABSENT adapter: $entry"
  done
fi
if (( ${#drifted_adapters[@]} > 0 )); then
  for entry in "${drifted_adapters[@]}"; do
    emit "DRIFTED adapter: ${entry%%|*}"
    emit "  canonical=$adapter_hash adapter=${entry##*|}"
  done
fi

failures=$(( ${#absent_targets[@]} + ${#drifted_targets[@]} + ${#absent_adapters[@]} + ${#drifted_adapters[@]} ))

if (( failures > 0 )); then
  emit "SCP skill sync found ${#absent_targets[@]} absent and ${#drifted_targets[@]} drifted native targets, ${#absent_adapters[@]} absent and ${#drifted_adapters[@]} drifted adapters"
else
  emit "SCP skill sync verified"
fi
emit "mode: $mode"
emit "master: $MASTER"
emit "skill_sha256: $master_hash"
emit "adapter_sha256: $adapter_hash"
emit "native_targets: ${#TARGETS[@]}"
emit "native_verified: $verified_targets"
emit "native_absent: ${#absent_targets[@]}"
emit "native_drifted: ${#drifted_targets[@]}"
emit "adapter_targets: ${#ADAPTERS[@]}"
emit "adapter_verified: $verified_adapters"
emit "adapter_absent: ${#absent_adapters[@]}"
emit "adapter_drifted: ${#drifted_adapters[@]}"
if [[ -n "$REPORT_PATH" ]]; then
  emit "report: $REPORT_PATH"
fi

if (( failures > 0 )); then
  exit 1
fi
