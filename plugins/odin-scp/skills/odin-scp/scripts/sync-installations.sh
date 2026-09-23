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
byte-identical to the adapter bytes generated from that same master SKILL.md.
An installation that is ABSENT is reported by name, is never counted as
verified, and makes the run exit non-zero in every mode.

Adapter generation is deterministic: an adapter is a fixed generated-file header
line, a blank line, and the canonical SKILL.md verbatim. It carries no
timestamp, hostname, or machine-local path, so two generations from the same
master produce byte-identical adapters.

Master resolution: the default master is the skill directory CONTAINING this
script (the repository checkout when run from the repository). The script only
reads master and writes targets; a native target whose physical write
location (symlinks resolved by the kernel, compared with master by filesystem
identity rather than path spelling) is master, lies inside master, or is an
existing ancestor of master, an adapter whose physical write location is master
or lies inside master, and an adapter file that shares an inode with any master
file, is skipped (verification still judges it by exact content), so nothing
ever writes back into master. A location that cannot be
attributed (a symlink loop, a newline in a path or link text) is skipped too.

Refusals: a native target that is $HOME or `/` (by path text or filesystem
identity) stops the run in every mode before anything is written. A native
target that is an ancestor of $HOME is refused in every mode and never written
(one that also contains master is skipped by the master-overlap guard first).
In write mode and --dry-run, a native target that holds an entry other than a
regular file, directory, or symlink (a FIFO, socket, or device), or whose own
path exists and is not a directory, and an adapter whose existing path is not a
regular file, is refused and left untouched. The other installations are still
synced, the run exits non-zero, and the summary adds native_refused and
adapter_refused counts (printed only when non-zero). Digests are taken from
file contents on stdin, so a path containing a backslash hashes normally.

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
                          In both lists, blank lines and lines starting with #
                          are ignored, and a leading ~/ expands to $HOME/.
                          Nothing else is expanded: a line that is exactly ~,
                          $HOME or ${HOME}, or that starts with $HOME/ or
                          ${HOME}/, stops the run in every mode before
                          anything is written.
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
      # The tilde is escaped: an unquoted ~/ in a case pattern or a ${var#...}
      # pattern is itself tilde-expanded to $HOME/, so a literal "~/" line would
      # never match and would be used as a path relative to the working directory.
      \~/*) line="${HOME}/${line#\~/}" ;;
      # Only ~/ is expanded. A bare ~ or an unexpanded $HOME / ${HOME} line was
      # meant to name the home directory but would be used relative to the
      # working directory, so it is refused before anything is written.
      \~|\$HOME|\$HOME/*|\$\{HOME\}|\$\{HOME\}/*)
        echo "refusing unexpanded home line in $target_file (only a leading ~/ is expanded): $line" >&2
        unexpanded_home_lines=$((unexpanded_home_lines + 1))
        continue
        ;;
    esac
    eval "$target_var+=(\"\$line\")"
  done < "$target_file"
}

unexpanded_home_lines=0

if [[ -n "${SCP_SKILL_TARGETS_FILE:-}" ]]; then
  read_targets_file TARGETS "$SCP_SKILL_TARGETS_FILE"
fi

if [[ -n "${SCP_ADAPTER_TARGETS_FILE:-}" ]]; then
  read_targets_file ADAPTERS "$SCP_ADAPTER_TARGETS_FILE"
fi

if (( unexpanded_home_lines > 0 )); then
  echo "nothing was written; write the line(s) above as ~/... or as an absolute path" >&2
  exit 1
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

# Digests are taken from the bytes on stdin. Given a file NAME, shasum escapes
# a backslash or newline in the name and prefixes the digest with `\`, so a
# correct copy at such a path would be reported as drifted.
sha256_of_file() {
  shasum -a 256 < "$1" | awk '{print $1}'
}

master_hash="$(sha256_of_file "$MASTER/SKILL.md")"
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

# A native target that is $HOME or `/` is refused outright, in every mode and
# before anything is written, whether or not master lies inside $HOME:
# `rsync -a --delete` into it would delete the operator's files. It is matched
# by path text (trailing slashes stripped) and, when it exists, by filesystem
# identity, so a symlink or `x/..` spelling of $HOME is caught too.
home_text() {
  strip_trailing_slashes "${HOME:-}"
}

target_is_home_or_root() {
  local path home
  path="$(strip_trailing_slashes "$1")"
  home="$(home_text)"
  if [[ "$path" == "/" || ( -n "$home" && "$path" == "$home" ) ]]; then
    return 0
  fi
  if [[ -d "$path" ]]; then
    if [[ "$path" -ef / ]] || [[ -n "$home" && "$path" -ef "$home" ]]; then
      return 0
    fi
  fi
  return 1
}

# A proper ancestor of $HOME (by path text or by identity) is just as
# destructive to sync into. Write mode and --dry-run refuse it per target, after
# the master-overlap guard, and the run exits non-zero. Both the ancestors of
# the $HOME text and the ancestors of its physical location (symlinks resolved
# by `cd -P`) are compared, so a $HOME that is itself a symlink still protects
# the directories that really contain it.
target_is_home_ancestor() {
  local path home dir home_real
  path="$(strip_trailing_slashes "$1")"
  home="$(home_text)"
  if [[ -z "$home" ]]; then
    return 1
  fi
  if [[ "$home" == "$path"/* ]]; then
    return 0
  fi
  if [[ -d "$path" && -d "$home" ]]; then
    dir="$home"
    while [[ "$dir" != "/" && "$dir" != "." && -n "$dir" ]]; do
      dir="$(dirname "$dir")"
      if [[ "$path" -ef "$dir" ]]; then
        return 0
      fi
    done
    if home_real="$(cd -P "$home" 2>/dev/null && pwd -P)"; then
      dir="$home_real"
      while [[ "$dir" != "/" && -n "$dir" ]]; do
        dir="$(dirname "$dir")"
        if [[ "$path" -ef "$dir" ]]; then
          return 0
        fi
      done
    fi
  fi
  return 1
}

home_refusals=0
for target in "${TARGETS[@]}"; do
  if target_is_home_or_root "$target"; then
    echo "refusing native target that is \$HOME or /: $target" >&2
    home_refusals=$((home_refusals + 1))
  fi
done
if (( home_refusals > 0 )); then
  echo "nothing was written; remove the line(s) above from the target list" >&2
  exit 1
fi

# rsync opens an existing destination file as its basis, and openrsync blocks
# forever opening a FIFO there; a socket or device is no better. Before any
# write, a native target is scanned (symlinks are not followed) and refused
# when it holds any entry other than a regular file, directory, or symlink, or
# when its own path exists and is not a directory. Sets SPECIAL to the entry.
SPECIAL=""
target_holds_special() {
  local path found
  SPECIAL=""
  path="$(strip_trailing_slashes "$1")"
  if [[ ! -e "$path" ]]; then
    return 1
  fi
  if [[ ! -d "$path" ]]; then
    SPECIAL="$path (not a directory)"
    return 0
  fi
  if ! found="$(find "$path/" ! -type f ! -type d ! -type l -print -quit 2>/dev/null)"; then
    SPECIAL="$path (could not be scanned)"
    return 0
  fi
  if [[ -n "$found" ]]; then
    SPECIAL="$found"
    return 0
  fi
  return 1
}

# Writing the adapter bytes into an existing FIFO would block until a reader
# appears, so an adapter path that exists and is not a regular file is refused.
adapter_is_special() {
  [[ -e "$1" && ! -f "$1" ]]
}

refused_targets=()
refused_adapters=()

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
    if target_is_home_ancestor "$target"; then
      emit "REFUSED native target (an ancestor of \$HOME; not written): $target"
      refused_targets+=("$target")
      continue
    fi
    if target_holds_special "$target"; then
      emit "REFUSED native target (holds a FIFO, socket, device, or non-directory; not written): $target: $SPECIAL"
      refused_targets+=("$target")
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
    if adapter_is_special "$adapter"; then
      emit "REFUSED adapter (exists and is not a regular file; not written): $adapter"
      refused_adapters+=("$adapter")
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
    elif target_is_home_ancestor "$target"; then
      emit "DRY-RUN would refuse native target (an ancestor of \$HOME): $target"
      refused_targets+=("$target")
    elif target_holds_special "$target"; then
      emit "DRY-RUN would refuse native target (holds a FIFO, socket, device, or non-directory): $target: $SPECIAL"
      refused_targets+=("$target")
    else
      emit "DRY-RUN would sync native target: $target"
    fi
  done
  for adapter in "${ADAPTERS[@]}"; do
    if adapter_overlaps_master "$adapter"; then
      emit "DRY-RUN would skip adapter that resolves into master: $adapter"
    elif adapter_is_special "$adapter"; then
      emit "DRY-RUN would refuse adapter (exists and is not a regular file): $adapter"
      refused_adapters+=("$adapter")
    else
      emit "DRY-RUN would generate adapter: $adapter"
    fi
  done
else
  # Verify-only writes nothing, but an ancestor of $HOME is still named and
  # refused so the listing error is reported in every mode.
  for target in "${TARGETS[@]}"; do
    if ! target_overlaps_master "$target" && target_is_home_ancestor "$target"; then
      emit "REFUSED native target (an ancestor of \$HOME): $target"
      refused_targets+=("$target")
    fi
  done
fi

# --- verification by exact content ------------------------------------------
# A native target is a whole-directory snapshot of master: a matching SKILL.md
# with a changed, extra, or missing file anywhere else in the tree is drift.
# Any `diff -rq` output is drift too, whatever its exit status: Apple's diff
# reports a file/directory type swap, a dangling link, or an unreadable path
# and still exits 0, so the exit status alone would fail open.
absent_targets=()
drifted_targets=()
drifted_details=()
verified_targets=0
for target in "${TARGETS[@]}"; do
  if [[ ! -f "$target/SKILL.md" ]]; then
    absent_targets+=("$target/SKILL.md")
    continue
  fi
  target_hash="$(sha256_of_file "$target/SKILL.md")"
  if [[ "$target_hash" != "$master_hash" ]]; then
    drifted_targets+=("$target/SKILL.md")
    drifted_details+=("  master=$master_hash target=$target_hash")
  elif ! tree_diff="$(diff -rq -- "$MASTER" "$target" 2>&1)" || [[ -n "$tree_diff" ]]; then
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
  this_adapter_hash="$(sha256_of_file "$adapter")"
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

failures=$(( ${#absent_targets[@]} + ${#drifted_targets[@]} + ${#absent_adapters[@]} + ${#drifted_adapters[@]} + ${#refused_targets[@]} + ${#refused_adapters[@]} ))

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
# The refusal counts are printed only when non-zero, so a healthy run's output
# is unchanged.
if (( ${#refused_targets[@]} > 0 )); then
  emit "native_refused: ${#refused_targets[@]}"
fi
emit "adapter_targets: ${#ADAPTERS[@]}"
emit "adapter_verified: $verified_adapters"
emit "adapter_absent: ${#absent_adapters[@]}"
emit "adapter_drifted: ${#drifted_adapters[@]}"
if (( ${#refused_adapters[@]} > 0 )); then
  emit "adapter_refused: ${#refused_adapters[@]}"
fi
if [[ -n "$REPORT_PATH" ]]; then
  emit "report: $REPORT_PATH"
fi

if (( failures > 0 )); then
  exit 1
fi
