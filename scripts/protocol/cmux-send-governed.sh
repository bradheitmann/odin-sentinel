#!/bin/sh
# cmux-send-governed.sh — canonical governed CMUX send helper (EPIC-020).
#
# Performs a governed send against the REAL cmux CLI contract (per
# protocol/skill-references/team-bootstrap-runbook.md):
#     cmux send --workspace <ws> --surface <surf> <text>      # text is positional
#     cmux send-key --workspace <ws> --surface <surf> enter   # key is positional (lowercase)
#     cmux read-screen --workspace <ws> --surface <surf> --lines 80 --scrollback
# (The cmux CLI does NOT support --target/--message, and send-key requires the
#  --workspace/--surface flags rather than a positional target. A wrong flag is
#  NOT a no-op: cmux parses unknown text positionally and delivers to the FOCUSED
#  surface, causing cross-workspace mis-target. This helper never emits those.)
#
# Governing behavior:
#   - single_line_flatten targets: flatten newlines/CR/tabs to single spaces
#     BEFORE the single atomic submit, so a multi-line payload is not submitted
#     one line per prompt ("machine-gunning"). Field separator convention " ;; ".
#   - single_enter_verify: send text, Enter ONCE, then (with --verify) read-screen
#     and re-Enter ONCE ONLY if the input bar still shows the message head. A
#     BLIND second Enter is NEVER sent — it interrupts reply generation.
#   - double_enter: standard send + a second Enter to submit (2nd Enter on busy).
#
# This is the canonical flattening helper referenced by validateCmuxDeliveryProof:
# a delivery proof may set newlines_flattened=true ONLY when this helper (or an
# equivalent) flattened the payload before the single submit.
#
# Usage (send):
#   cmux-send-governed.sh --workspace <ws> --surface <surf> \
#       (--harness <id> | --profile <submit_profile>) [--verify] "<text>"
#       # (--target <workspace>:<surface> accepted as an alternative locator form;
#       #  <surface> may be a numeric ref like "108" OR a UUID like
#       #  ADA6C600-1ECF-4270-8E79-D54CC422DF2D.)
#
# Usage (flatten only — deterministic, no send):
#   echo "<text>" | cmux-send-governed.sh --flatten-only --profile <submit_profile>
#
# Usage (dry-run — print the exact cmux commands that WOULD run, no execution):
#   cmux-send-governed.sh --dry-run --workspace <ws> --surface <surf> \
#       --profile <submit_profile> [--verify --verify-cmd "<cmd>"] "<text>"
#
# --verify (single_enter_verify only): after the one Enter, run a readback
# (default: cmux read-screen for this surface; override with --verify-cmd) and
# re-Enter ONCE ONLY if the readback still contains the message head. Without
# --verify, single_enter_verify sends exactly one Enter and the CALLER owns the
# read-screen decision (the no-blind-second-Enter guarantee holds either way).
#
# submit_profile values: single_line_flatten | double_enter | single_enter_verify
set -eu

PROFILE=""
HARNESS=""
WORKSPACE=""
SURFACE=""
TARGET=""
POSITIONAL=""
FLATTEN_ONLY=0
DRY_RUN=0
VERIFY=0
VERIFY_CMD=""

while [ $# -gt 0 ]; do
  case "$1" in
    --flatten-only) FLATTEN_ONLY=1; shift;;
    --dry-run) DRY_RUN=1; shift;;
    --verify) VERIFY=1; shift;;
    --profile) PROFILE="${2-}"; shift 2;;
    --harness) HARNESS="${2-}"; shift 2;;
    --workspace) WORKSPACE="${2-}"; shift 2;;
    --surface) SURFACE="${2-}"; shift 2;;
    --target) TARGET="${2-}"; shift 2;;
    --verify-cmd) VERIFY_CMD="${2-}"; shift 2;;
    -h|--help)
      sed -n '2,/^$/p' "$0" | sed 's/^# \{0,1\}//'
      exit 0;;
    --*) echo "cmux-send-governed.sh: unknown argument: $1" >&2; exit 2;;
    *)
      if [ -z "$POSITIONAL" ]; then
        POSITIONAL="$1"
      else
        echo "cmux-send-governed.sh: unexpected extra positional argument: $1" >&2
        exit 2
      fi
      shift;;
  esac
done

# --target <workspace>:<surface> is accepted as an alternative locator form.
# The surface half may be a numeric ref ("108") or a UUID. No focus-dependent
# default is ever applied: both halves must resolve to explicit values.
if [ -n "$TARGET" ]; then
  case "$TARGET" in
    *:*)
      [ -z "$WORKSPACE" ] && WORKSPACE="${TARGET%%:*}"
      [ -z "$SURFACE" ] && SURFACE="${TARGET#*:}"
      ;;
    *)
      echo "cmux-send-governed.sh: --target must be <workspace>:<surface> (surface may be a ref or UUID)" >&2
      exit 2
      ;;
  esac
fi

# Resolve the profile from a harness seed when --profile is not given.
if [ -z "$PROFILE" ] && [ -n "$HARNESS" ]; then
  seed="$(dirname -- "$0")/../../src/harness-pacing/seeds/$HARNESS.json"
  if [ -f "$seed" ]; then
    # Extract the message_format.submit_profile value without a JSON dependency.
    # Matches the first submit_profile occurrence in the seed file.
    PROFILE=$(sed -n 's/.*"submit_profile"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$seed" | head -n 1)
  fi
fi

if [ -z "$PROFILE" ]; then
  echo "cmux-send-governed.sh: --profile or --harness is required" >&2
  exit 2
fi

case "$PROFILE" in
  single_line_flatten|double_enter|single_enter_verify) ;;
  *) echo "cmux-send-governed.sh: unknown submit_profile: $PROFILE" >&2; exit 2;;
esac

if [ "$VERIFY" -eq 1 ] && [ "$PROFILE" != "single_enter_verify" ]; then
  echo "cmux-send-governed.sh: --verify applies only to single_enter_verify" >&2
  exit 2
fi

# Flatten for single-submission harnesses. The embedded newline is the trigger
# for machine-gunning; collapse \n \r \tab to single spaces so the whole payload
# is one atomic submit.
flatten() {
  printf '%s' "$1" | tr '\r\n\t' '   ' | tr -s ' ' | sed 's/^ //; s/ $//'
}

# --flatten-only: read payload from stdin, apply profile flattening, write to
# stdout, and exit WITHOUT sending. Deterministic unit-test surface.
if [ "$FLATTEN_ONLY" -eq 1 ]; then
  payload=$(cat)
  if [ "$PROFILE" = "single_line_flatten" ]; then
    flatten "$payload"
  else
    printf '%s' "$payload"
  fi
  exit 0
fi

# HARDENING: the full send path requires an explicit --workspace AND --surface.
# REFUSE when --workspace is absent — never fall back to a focused surface
# (a focus-dependent default is exactly the cross-workspace mis-target vector
# this helper exists to prevent).
if [ -z "$WORKSPACE" ]; then
  echo "cmux-send-governed.sh: --workspace is required for a send (no focus-dependent default is ever applied)" >&2
  exit 2
fi
if [ -z "$SURFACE" ]; then
  echo "cmux-send-governed.sh: --surface (or --target <ws>:<surf>) is required for a send" >&2
  exit 2
fi
MESSAGE="$POSITIONAL"
if [ -z "$MESSAGE" ]; then
  echo "cmux-send-governed.sh: message text is required as a final positional argument" >&2
  exit 2
fi

if [ "$PROFILE" = "single_line_flatten" ]; then
  PAYLOAD=$(flatten "$MESSAGE")
else
  PAYLOAD="$MESSAGE"
fi

# D4 (CRITICAL fix): the helper NEVER constructs a shell command string from
# arbitrary payload/workspace/surface values and NEVER invokes `sh -c` on it.
# Such construction is shell-injection-prone for a helper that accepts arbitrary
# governed messages (code, quotes, shell snippets, markdown fences). Instead:
#   - the LIVE path invokes `cmux` directly with literal argv (payload is ONE
#     positional arg, never interpolated into a command string);
#   - the default read-screen readback ALSO invokes `cmux` directly with argv;
#   - the DRY-RUN path renders a SHELL-SAFE display string by single-quoting every
#     expansion via shell_quote() (workspace/surface/payload). --verify-cmd, when
#   caller-supplied, is the ONLY path that may run as a shell string — and even
#   then the payload is NEVER interpolated into it (it receives NO payload text).

# POSIX single-quoting: wraps a value in '...' and escapes every embedded ' as
# '\'' . Used ONLY for dry-run display rendering, never for live execution.
shell_quote() {
  printf "'"
  printf '%s' "$1" | sed "s/'/'\\\\''/g"
  printf "'"
}

# Run the cmux read-screen readback directly with argv. Used by should_reenter's
# DEFAULT readback (no --verify-cmd override). Direct argv => no shell eval of
# workspace/surface values.
run_read_screen_default() {
  cmux read-screen --workspace "$WORKSPACE" --surface "$SURFACE" --lines 80 --scrollback
}

# The message head: the first segment of the payload used to detect whether the
# input bar still shows the un-submitted message after the first Enter.
message_head() {
  printf '%s' "$1" | cut -c1-40
}

# Decide whether single_enter_verify should re-Enter once: true only when --verify
# is set AND the readback still contains the message head. Without --verify this
# is always false (no blind second Enter). Uses fixed-string matching.
# The readback NEVER interpolates the payload. The DEFAULT reader runs cmux
# read-screen directly with argv (run_read_screen_default). A caller-supplied
# --verify-cmd override runs as a shell string, but receives NO payload text — it
# is a read-only reader the caller owns, not a payload-construction vector.
should_reenter() {
  [ "$VERIFY" -eq 1 ] || return 1
  [ "$PROFILE" = "single_enter_verify" ] || return 1
  head=$(message_head "$PAYLOAD")
  [ -n "$head" ] || return 1
  if [ -n "$VERIFY_CMD" ]; then
    readback=$(sh -c "$VERIFY_CMD" 2>/dev/null) || readback=""
  else
    readback=$(run_read_screen_default 2>/dev/null) || readback=""
  fi
  printf '%s' "$readback" | grep -qF -- "$head"
}

# Run (or print, in dry-run) a cmux command. Dry-run never executes anything.
emit_cmux() {
  if [ "$DRY_RUN" -eq 1 ]; then
    printf '%s\n' "$*"
  else
    # D4: direct cmux invocation with literal argv. The caller passes already-
    # formed argv via $@ (NOT a command string). The # shellcheck disable below
    # is because emit_cmux is a thin argv-forwarder; we rely on its callers to
    # pass each argv element as a separate quoted argument.
    # shellcheck disable=SC2086
    cmux "$@"
  fi
}

# DRY-RUN RENDER HELPERS. Each builds a shell-safe DISPLAY string by
# single-quoting every expansion via shell_quote(). The live path does NOT use
# these — it calls emit_cmux with real argv. Dry-run is for human/test inspection
# of exactly which cmux invocation WOULD run.
dry_render_send() {
  printf 'cmux send --workspace %s --surface %s %s\n' "$(shell_quote "$WORKSPACE")" "$(shell_quote "$SURFACE")" "$(shell_quote "$PAYLOAD")"
}
dry_render_send_key() {
  printf 'cmux send-key --workspace %s --surface %s enter\n' "$(shell_quote "$WORKSPACE")" "$(shell_quote "$SURFACE")"
}
dry_render_send_key_annotated() {
  printf 'cmux send-key --workspace %s --surface %s enter  # verify-reEnter: input bar still shows message head\n' "$(shell_quote "$WORKSPACE")" "$(shell_quote "$SURFACE")"
}

# Live-send argv builders. Return argv as separate quoted args so emit_cmux can
# forward them to `cmux` directly (NO shell string, NO payload interpolation).
live_send_argv() {
  set -- send --workspace "$WORKSPACE" --surface "$SURFACE" "$PAYLOAD"
  emit_cmux "$@"
}
live_send_key_argv() {
  set -- send-key --workspace "$WORKSPACE" --surface "$SURFACE" enter
  emit_cmux "$@"
}

if [ "$DRY_RUN" -eq 1 ]; then
  dry_render_send
else
  live_send_argv
fi

case "$PROFILE" in
  single_line_flatten)
    # One atomic submit; the payload is already a single line.
    if [ "$DRY_RUN" -eq 1 ]; then
      dry_render_send_key
    else
      live_send_key_argv
    fi
    ;;
  single_enter_verify)
    # Exactly one Enter submits. NEVER a blind second Enter. With --verify, a
    # read-screen check decides whether ONE re-Enter is needed (input bar still
    # shows the message head); that re-Enter is the ONLY second Enter allowed.
    if [ "$DRY_RUN" -eq 1 ]; then
      dry_render_send_key
      # In dry-run the verify readback still runs (it is a read-only command by
      # contract) so the conditional re-Enter outcome is deterministic.
      if should_reenter; then
        dry_render_send_key_annotated
      fi
    else
      live_send_key_argv
      if should_reenter; then
        live_send_key_argv
        echo "cmux-send-governed: verify-reEnter sent once (input bar still showed message head)" >&2
      fi
    fi
    ;;
  double_enter)
    # Standard send + a second Enter to submit (2nd Enter on busy).
    if [ "$DRY_RUN" -eq 1 ]; then
      dry_render_send_key
      dry_render_send_key
    else
      live_send_key_argv
      live_send_key_argv
    fi
    ;;
esac

if [ "$DRY_RUN" -eq 1 ]; then
  exit 0
fi
echo "cmux-send-governed: delivered to workspace:$WORKSPACE surface:$SURFACE (profile=$PROFILE)" >&2
