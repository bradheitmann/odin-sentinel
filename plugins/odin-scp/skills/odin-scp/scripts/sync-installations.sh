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

Syncs the master odin-scp skill to runtime copies and
verifies required markers. --verify-only checks current copies without writing.
--dry-run previews rsync changes without writing.

Master resolution: the default master is the skill directory CONTAINING this
script (the repository checkout when run from the repository). The script only
reads master and writes targets; a target that resolves to the same directory
as master is skipped, so nothing ever writes back into master.

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
MASTER_REAL="$(cd "$MASTER" && pwd -P)"

for marker in "${MARKERS[@]}"; do
  grep -Fq "$marker" "$MASTER/SKILL.md" || {
    echo "missing marker in master SKILL.md: $marker" >&2
    exit 1
  }
done

for adapter in "${ADAPTERS[@]}"; do
  if [[ ! -f "$adapter" ]]; then
    echo "missing adapter: $adapter" >&2
    exit 1
  fi
  for marker in "${MARKERS[@]}"; do
    grep -Fq "$marker" "$adapter" || {
      echo "missing marker in adapter $adapter: $marker" >&2
      exit 1
    }
  done
done

rsync_args=(-a --delete)
if [[ "$DRY_RUN" == true ]]; then
  rsync_args+=(--dry-run)
fi

if [[ "$VERIFY_ONLY" == false ]]; then
  for target in "${TARGETS[@]}"; do
    mkdir -p "$target"
    if [[ "$(cd "$target" && pwd -P)" == "$MASTER_REAL" ]]; then
      emit "skipping target that resolves to master (nothing ever writes back into master): $target"
      continue
    fi
    if [[ "$DRY_RUN" == true ]]; then
      emit "DRY-RUN target: $target"
      rsync "${rsync_args[@]}" "$MASTER/" "$target/" | while IFS= read -r line; do
        emit "  $line"
      done
    else
      rsync "${rsync_args[@]}" "$MASTER/" "$target/"
    fi
  done
fi

master_hash="$(shasum -a 256 "$MASTER/SKILL.md" | awk '{print $1}')"
hash_mismatch=false
for target in "${TARGETS[@]}"; do
  if [[ ! -f "$target/SKILL.md" ]]; then
    emit "missing target SKILL.md: $target/SKILL.md"
    hash_mismatch=true
    continue
  fi
  target_hash="$(shasum -a 256 "$target/SKILL.md" | awk '{print $1}')"
  if [[ "$target_hash" != "$master_hash" ]]; then
    emit "hash mismatch: $target/SKILL.md"
    emit "  master=$master_hash target=$target_hash"
    hash_mismatch=true
  fi
done

mode="sync"
if [[ "$VERIFY_ONLY" == true ]]; then
  mode="verify-only"
elif [[ "$DRY_RUN" == true ]]; then
  mode="dry-run"
fi

if [[ "$hash_mismatch" == true ]]; then
  emit "SCP skill sync found hash mismatches"
else
  emit "SCP skill sync verified"
fi
emit "mode: $mode"
emit "master: $MASTER"
emit "skill_sha256: $master_hash"
emit "native_targets: ${#TARGETS[@]}"
emit "adapter_targets: ${#ADAPTERS[@]}"
if [[ -n "$REPORT_PATH" ]]; then
  emit "report: $REPORT_PATH"
fi

if [[ "$hash_mismatch" == true && "$DRY_RUN" == false ]]; then
  exit 1
fi
