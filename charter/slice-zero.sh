#!/usr/bin/env bash
# Slice Zero: build ODIN Sentinel, start the real stdio MCP server, and call
# odin.validate_cmux_delivery_proof twice:
#   1. a sent-and-acknowledged delivery proof must come back valid;
#   2. a busy-pane refusal (not submitted) must come back not valid.
# Exit 0 only when both hold. Needs pnpm, node and jq.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

pnpm run build >/dev/null

DELIVERED='{"timestamp":"2026-10-27T14:50:14Z","target_surface_locator":"surface:1000010150","submitted":true,"verification_method":"read_screen","observed_processing_state":"DELIVERED_ACKED","sender_role":"EXEC PM"}'
REFUSED='{"timestamp":"2026-10-27T14:51:02Z","target_surface_locator":"surface:1000010150","submitted":false,"verification_method":"read_screen","observed_processing_state":"PANE_STILL_THINKING","sender_role":"EXEC PM"}'

call() {
  local id="$1" proof="$2"
  {
    printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"charter-slice-zero","version":"1"}}}'
    printf '%s\n' '{"jsonrpc":"2.0","method":"notifications/initialized"}'
    printf '{"jsonrpc":"2.0","id":%s,"method":"tools/call","params":{"name":"odin.validate_cmux_delivery_proof","arguments":{"proof":%s}}}\n' "$id" "$proof"
    sleep 2
  } | node dist/src/bin/index.js 2>/dev/null \
    | jq -r --argjson id "$id" 'select(.id == $id) | .result.content[0].text | fromjson | .valid'
}

delivered="$(call 2 "$DELIVERED")"
refused="$(call 3 "$REFUSED")"
echo "delivered_valid=$delivered refused_valid=$refused"

[ "$delivered" = "true" ] || { echo "slice-zero: RED (a real delivery was not accepted)" >&2; exit 1; }
[ "$refused" = "false" ] || { echo "slice-zero: RED (a refusal was accepted as a delivery)" >&2; exit 1; }
echo "slice-zero: GREEN"
