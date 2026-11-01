# Slot lease reference

A fenced lease with an expiry, for jobs that more than one runner may start. One holder per
slot; a fencing token that only ever increases; an optional allow-list of slot names.

The mechanism is execution-layer mechanics: a consumer cites it instead of building its own
lock. The implementation reuses ODIN's existing cross-process registry lock, so a lease
operation is serialized exactly like a registry append (fail closed, generous budget).

## Operations

| Operation | Succeeds when | Notes |
| --- | --- | --- |
| `acquire` | the slot is free, already held by this holder, or expired | a takeover increments the token |
| `renew` | this holder holds the slot with this token, and it has not expired | an expired lease cannot be revived by renewing |
| `release` | this holder holds the slot with this token | the token is retained, so the sequence never restarts |
| `check` | this holder holds the slot with this token, and it has not expired | read only |
| `status` | always (for an allowed slot) | read only: holder, token, expiry, free/expired |

A free slot keeps its last token. The first acquire on a slot is token 1; every takeover is
`token + 1`.

CLI shape:

```
odin-sentinel lease acquire --dir <dir> --slot <slot>  --holder <id> [--ttl <seconds>]
odin-sentinel lease acquire --dir <dir> --slots a,b   --holder <id> [--ttl <seconds>]
odin-sentinel lease renew   --dir <dir> --slot <slot> --holder <id> --token <n> [--ttl <seconds>]
odin-sentinel lease release --dir <dir> --slot <slot> --holder <id> --token <n>
odin-sentinel lease check   --dir <dir> --slot <slot> --holder <id> --token <n>
odin-sentinel lease status  --dir <dir> --slot <slot>
```

Each call prints exactly one JSON object and exits 0 on success or non-zero with a typed
rejection (`code` plus `detail`). Rejections: `invalid_slot`, `invalid_holder`, `invalid_ttl`,
`lease_dir_unavailable`, `lock_unavailable`, `slot_held`, `not_holder`, `stale_token`,
`lease_expired`, `lease_missing`, `lease_corrupt`, `slot_not_allowed`, `slots_allow_invalid`,
`all_slots_held`.

## Fencing

An actor checks its lease immediately before acting and stamps every action with its token.
For a slot, the action with the highest token wins and lower-token actions are void: a late
runner that woke up after its lease expired can still act, but its stamped token is lower than
the current one, so the conflict is detectable and resolvable instead of silent. A token
higher than the slot's current token was never issued and is also invalid.

## Allow-list

An optional file `slots.allow` in the lease directory lists the permitted slot ids, one per
line. Blank lines and lines starting with `#` are ignored. When the file exists, any operation
on a slot it does not list is refused with `slot_not_allowed` and nothing is written; when the
file is absent, any valid slot id is accepted. A malformed file (a line that is not a valid
slot id) fails closed with `slots_allow_invalid` for every operation.

## Any-of acquire

`acquire --slots a,b,...` asks for any one of several slots. The slots are tried in the listed
order, each under its own lock, one at a time (never two locks at once), and exactly one is
granted per call: the first that is free, already held by this holder, or expired. A slot this
holder already holds is returned first (idempotent re-acquire, no second grant). When every
listed slot is held, the call is refused with `all_slots_held`, listing each slot's holder and
expiry.

The decision is race-free under concurrent callers: no slot is granted twice and no caller
holds two slots from one call. `--slot` and `--slots` together are refused (`invalid_args`).

## Adopter notes

- **Slot ids cannot contain colons.** A timestamp is fine as a slot id only in the form
  `YYYY-MM-DDTHHMMZ` (for example `2026-11-01T1048Z`). The rejection detail says so.
- **The lease directory must be a local path.** Put it on the machine's own disk, not in a
  folder that a file-sync service manages: the lock is an atomic directory create, and a sync
  service can copy or restore it underneath the runners.

## Field case

A consumer used the lease as a host-wide lock for full test suites: two slots, shared by about
nine agents that each run whole suites, with a lease time-to-live of 5400 seconds (90
minutes). Before the lease, about ten suites ran concurrently and host load sat near 12, with
recovery-test timeouts recurring under the load. With the lease, load fell to about 4.9 and the
timeouts stopped recurring (one verification run: 128 passed, 0 failed, in 1951 seconds). After
a few hours the two slots had reached tokens 5 and 3, and agents queued for them; one skipped
its run while both were held.

Two gaps showed in that use. Any slot name was accepted, so a typo silently created a new slot
(one agent used a nonexistent slot, and a smoke test left a probe slot behind) — hence the
allow-list. And "any free slot of N" was done by hand, each caller writing "try the first, on
refusal try the second", repeating the same race in every caller — hence any-of acquire.

A second consumer, running verification loops, adopted the lease on its own and reported the
two adopter notes above from its own field experience.
