# ODIN Lattice Design

**Status:** Design-only — no implementation code. This document describes an
optional future sidecar. The core `@bradheitmann/odin-sentinel` package has zero
imports of the Lattice and continues to operate without it.

**Last revised:** 2026-06-12

---

## Table of Contents

1. [Overview and Positioning](#1-overview-and-positioning)
2. [SpacetimeDB v2.5 Design Constraints](#2-spacetimedb-v25-design-constraints)
3. [Table Designs](#3-table-designs)
4. [Reducer Semantics](#4-reducer-semantics)
5. [RLS Read Rules](#5-rls-read-rules)
6. [Sequencing and Migration Path](#6-sequencing-and-migration-path)
7. [License Obligations](#7-license-obligations)
8. [Go/No-Go Criteria Table](#8-gono-go-criteria-table)
9. [Package Structure](#9-package-structure)

---

## 1. Overview and Positioning

ODIN Lattice is an **optional** SpacetimeDB-backed sidecar that provides two
capabilities ODIN Sentinel teams cannot get from the file-based v0 data layer:

- **Push-based team state visibility.** Instead of PM roles polling file flags
  at a fixed cadence, subscriptions deliver state changes the moment a reducer
  commits them. This eliminates idle-supervision tokens entirely for teams whose
  members have a Lattice connection.

- **Bounded collective memory.** A two-table entity/edge model lets agents
  deposit named facts and relationships that survive individual session resets.
  Traversal depth is intentionally capped at one to two hops (see
  [Section 2](#2-spacetimedb-v25-design-constraints) for why deeper traversal
  is out of scope).

### What the Lattice is not

The Lattice is not a replacement for the protocol. Boot receipts, delivery
proofs, and state transitions remain the source of truth; the Lattice is a
*transport and store* for that same data, not a parallel governance layer.

The Lattice is not a dependency of `@bradheitmann/odin-sentinel`. A team that
never runs a SpacetimeDB module operates identically to a team that does — the
only difference is whether state changes are pulled (file flags) or pushed
(WebSocket subscriptions).

The Lattice is not a deep knowledge graph. SpacetimeDB v2.5 does not support
recursive server-side queries. Deep traversal is explicitly out of scope; the
bounded entity/edge model is the correct design for this constraint.

### Relationship to the v0 data layer

The v0 data layer consists of the wake-flag files and compact state ledger files
produced by `odin-watch`. These files are the deployed reality as of mid-2026.
Adopting the Lattice is a *transport change* — the same record shapes flow into
SpacetimeDB rows instead of local files. No schema transformation is required.

---

## 2. SpacetimeDB v2.5 Design Constraints

Every design choice in Sections 3–9 is bounded by the following platform facts
verified as of June 2026.

| Constraint | Value / Implication |
|---|---|
| Version | v2.5 (stable release line, June 2026) |
| License | BSL 1.1 — source-available, not open-source; specific production-use restrictions apply; converts to AGPL v3 with linking exception after a change-date period |
| Self-host model | Single-node binary; multi-node clustering is Maincloud-only (not available on self-hosted deployments) |
| Storage model | In-memory dataset + WAL commit log + periodic snapshots; the full working dataset must fit in RAM at all times |
| Local transaction latency | Approximately 10 microseconds for committed writes on loopback |
| Module languages | Rust, C#, and TypeScript (running on the V8 engine) |
| Client SDKs | Rust, C#, TypeScript; HTTP API also available |
| Subscription model | `SELECT *` queries; joins limited to a maximum of two tables; no subqueries in subscription predicates |
| Recursive queries | Not supported — any traversal deeper than a flat join must be implemented as reducer-side logic (TypeScript running inside the module) |
| Row-level security | Available; filters applied at subscription time by identity |
| Identity model | OIDC-compatible; each connected client carries an identity token |
| AI-agent workloads | Zero documented production deployments as of June 2026 |

These constraints are not preferences — they are hard platform limits that rule
out certain design patterns:

- A deep recursive knowledge graph cannot use server-side query traversal.
  Traversal must be reducer-side BFS capped at a small hop count.
- A team dataset that exceeds available RAM cannot be accommodated on
  self-hosted deployments. Dataset size must be estimated before adoption.
- Multi-machine teams require Maincloud, not a self-hosted binary.

---

## 3. Table Designs

> **Design-intent notice.** The following are design-intent descriptions only.
> No DDL syntax is used anywhere in this document. No INSERT or SELECT
> operations appear as implementation targets. These designs are inputs to a
> future evaluation, not implemented code.

The Lattice uses eight tables. Each table is described by its purpose and a
column-definition table. Columns marked `[pk]` form the primary key; columns
marked `[idx]` carry a secondary index.

### 3.1 agents

Tracks every agent occupant that has registered with the Lattice during the
current or any prior session included in the working dataset.

| Column | Type | Description |
|---|---|---|
| agent_id | String [pk] | Stable identifier assigned in the boot receipt (e.g. `dev-e008-sonnet`) |
| session_id | String [idx] | Session in which this agent was last active |
| role | String | Role name as declared in the boot receipt (`DEV`, `QA`, `PM`, etc.) |
| status | String | Current lifecycle state: `BOOTED`, `ACTIVE`, `PARKED`, `CRASHED`, `CLOSED` |
| substrate | String | Multiplexer surface type: `cmux`, `tmux`, `minimux`, `plain`, or `herdr` |
| registered_at | U64 | Microsecond epoch timestamp of first registration in this session |
| last_seen_at | U64 | Microsecond epoch of the most recent reducer write from this agent |

Retention: rows are retained for the lifetime of the working dataset. A
maintenance reducer may archive agents whose `last_seen_at` is older than a
configurable threshold, writing archived rows to a cold snapshot before removal.

### 3.2 role_slots

Describes the planned occupancy layout for a team as declared by the EXEC PM at
launch. Actual agent registrations in the `agents` table are matched against
`role_slots` to detect unoccupied or over-occupied positions.

| Column | Type | Description |
|---|---|---|
| slot_id | String [pk] | Unique slot identifier (e.g. `dev-slot-1`) |
| session_id | String [idx] | Session this slot belongs to |
| role | String | Expected role for this slot |
| tier | String | Tier label: `control` (PM/ODIN), `worker` (DEV/QA), `support` |
| assigned_agent_id | String | Agent expected to occupy this slot; empty if unassigned |
| occupied | Bool | True when a matching agent row exists and is `ACTIVE` or `PARKED` |

Retention: rows are written at session launch and remain for session duration.
Slots are not updated in place; a new session creates new slot rows.

### 3.3 receipts

Stores boot receipts and delivery receipts as submitted by agents. The receipt
schema mirrors the structures already enforced by the MCP server — rows are
validated on write and rejected without mutation if validation fails.

| Column | Type | Description |
|---|---|---|
| receipt_id | String [pk] | Unique identifier generated by the submitting agent |
| session_id | String [idx] | Session context |
| agent_id | String [idx] | Agent that submitted the receipt |
| receipt_type | String | `BOOT`, `DELIVERY`, `QA_PASS`, `QA_FAIL`, `CLOSEOUT` |
| payload_sha256 | String | SHA-256 hash of the receipt payload for integrity checking |
| payload_json | String | Full receipt payload serialized as JSON |
| submitted_at | U64 | Microsecond epoch of submission |
| valid | Bool | True if validation passed; False rows are written as rejection evidence |

Retention: receipts are append-only and permanent within the working dataset.
A snapshot-and-purge policy may archive sessions older than N days to free RAM.

### 3.4 deliveries

Records confirmed delivery events — moments when a DEV agent declared work
complete and a receipt was accepted. This table is the atomic source of truth
for "what has been delivered in this session."

| Column | Type | Description |
|---|---|---|
| delivery_id | String [pk] | Unique delivery identifier |
| session_id | String [idx] | Session context |
| agent_id | String | Delivering agent |
| scope | String | Description of what was delivered (file path, task label, or slice ID) |
| receipt_id | String | Foreign reference to the originating receipt row |
| delivery_proof_type | String | `WAIT_IDLE`, `EXPLICIT_CONFIRM`, or `SCREEN_OBSERVE` |
| delivered_at | U64 | Microsecond epoch |

Retention: append-only. Deliveries are never mutated or deleted within a
session's working dataset.

### 3.5 state_transitions

An audit log of every agent status change. Each row records one edge in an
agent's lifecycle state machine.

| Column | Type | Description |
|---|---|---|
| transition_id | String [pk] | Unique transition identifier |
| session_id | String [idx] | Session context |
| agent_id | String [idx] | Agent whose status changed |
| from_status | String | Status before the transition |
| to_status | String | Status after the transition |
| triggered_by | String | What caused the transition: `RECEIPT`, `WAKE_EVENT`, `PM_OVERRIDE` |
| trigger_id | String | ID of the receipt or wake event that triggered this transition |
| transitioned_at | U64 | Microsecond epoch |

Retention: append-only. The full transition log is retained for the session
lifetime to support forensic review of agent lifecycle events.

### 3.6 wake_events

Records every event emitted by `odin-watch` — including observation verdicts,
intervention recommendations, and delivery proofs detected via screen analysis.
The wake-flag files written to the directory configured via
`odin-watch --flag-dir` produce records with exactly the shapes stored here;
switching from file-based to Lattice-based delivery is a transport change only.

| Column | Type | Description |
|---|---|---|
| event_id | String [pk] | Unique event identifier |
| session_id | String [idx] | Session context |
| agent_id | String [idx] | Agent that the wake event concerns |
| verdict | String | Classifier output: `IDLE`, `ACTIVE`, `DELIVERY_PROOF`, `CRASHED`, `QA_COMPLETE`, `NEEDS_INPUT` |
| prompt_budget_class | String | `silent`, `compact`, `diagnostic`, or `forensic` |
| screen_hash | String | Hash of the terminal snapshot that produced this verdict |
| compact_state_json | String | Serialized compact state snapshot at event time |
| observed_at | U64 | Microsecond epoch when odin-watch captured the snapshot |

Retention: wake events are append-only. A sliding-window policy may remove
events older than a configurable horizon (e.g., 48 hours) to bound RAM usage.

### 3.7 entity_nodes

One row per named fact or entity in the bounded collective memory. Agents write
entity nodes to record discoveries, decisions, or references that should survive
their own session reset.

| Column | Type | Description |
|---|---|---|
| entity_id | String [pk] | Stable entity identifier (agent-assigned, must be unique) |
| session_id | String [idx] | Session in which this entity was first written |
| agent_id | String | Agent that created the entity |
| entity_type | String | Semantic category: `DECISION`, `ARTIFACT`, `FACT`, `RISK`, `REFERENCE` |
| label | String | Human-readable name for the entity |
| summary | String | One-to-three sentence description |
| confidence | String | `HIGH`, `MEDIUM`, `LOW` — agent's declared confidence in the fact |
| created_at | U64 | Microsecond epoch |
| updated_at | U64 | Microsecond epoch of the most recent `upsert_entity` call |

Retention: entity nodes are retained until explicitly expired by a maintenance
reducer or until the dataset reaches a configurable node-count ceiling, at which
point the oldest low-confidence nodes are evicted first.

### 3.8 entity_edges

Directed relationships between entity nodes. An edge from node A to node B with
a given relation label encodes a typed semantic link. Traversal is limited to
one to two hops by the reducer-side BFS implementation; deeper traversal is
intentionally unsupported.

| Column | Type | Description |
|---|---|---|
| edge_id | String [pk] | Unique edge identifier |
| session_id | String [idx] | Session in which this edge was written |
| from_entity_id | String [idx] | Source entity node |
| to_entity_id | String [idx] | Target entity node |
| relation | String | Semantic relation label: `BLOCKS`, `DEPENDS_ON`, `REFERENCES`, `CONTRADICTS`, `SUPPORTS` |
| created_by | String | Agent that wrote this edge |
| created_at | U64 | Microsecond epoch |

Retention: edges are retained alongside their referenced nodes. Evicting a node
also evicts all edges where that node appears as source or target.

---

## 4. Reducer Semantics

Reducers are the only mechanism by which data enters the Lattice. All writes are
validated; a reducer that receives an invalid input writes a rejection record (or
writes nothing) and returns without mutating any other table. This mirrors the
validation posture already enforced by the MCP server for receipt submissions.

### 4.1 submit_receipt

When an agent submits a boot receipt or delivery receipt, the `submit_receipt`
reducer receives the serialized payload and validates it against the receipt
schema enforced by the MCP server. Specifically, the reducer checks that the
required fields are present (`receipt_id`, `agent_id`, `session_id`,
`receipt_type`, and `payload_sha256`), that the SHA-256 hash matches the
serialized payload, and that `receipt_type` is one of the recognized values. If
any check fails, the reducer writes a row to `receipts` with `valid = false` as
a rejection record, then returns. If all checks pass, the reducer writes a row
with `valid = true` and proceeds to call `transition_state` internally when the
receipt type implies a lifecycle change (for example, a `BOOT` receipt
transitions the agent from no prior state to `BOOTED`; a `CLOSEOUT` receipt
transitions to `CLOSED`).

### 4.2 record_delivery

The `record_delivery` reducer validates that a delivery event references an
existing `receipt_id` in the `receipts` table with `valid = true` and a
`receipt_type` of `DELIVERY`. It also checks that `delivery_proof_type` is one
of the recognized values. On success it inserts a row into `deliveries` and
emits a push notification to any PM subscriber holding an active subscription
to the `deliveries` table filtered by `session_id`. Failed validation writes
nothing.

### 4.3 transition_state

The `transition_state` reducer enforces the agent lifecycle state machine. It
accepts a `(agent_id, from_status, to_status, triggered_by, trigger_id)` tuple.
Before writing, it verifies that the agent's current `status` in the `agents`
table matches `from_status` — if the agent is already in a different state (for
example, it was concurrently transitioned by a wake event), the reducer rejects
the write and returns without mutation. On a valid transition it updates the
agent's `status` in `agents` and appends a row to `state_transitions`. Because
SpacetimeDB local transactions are serialized, race conditions between two
concurrent `transition_state` calls for the same agent are resolved by the
database's own transaction ordering — the second call will see the post-first
state and reject if the precondition no longer holds.

### 4.4 raise_wake

The `raise_wake` reducer is the entry point for `odin-watch` to deposit a
classifier verdict. It receives the full wake event payload (agent, verdict,
prompt budget class, screen hash, and compact state JSON) and writes a row to
`wake_events`. If the verdict is `CRASHED` or `QA_COMPLETE`, the reducer
additionally calls `transition_state` to reflect the implied lifecycle change.
PM subscribers holding a wake-event subscription receive the push immediately
after the transaction commits, replacing the need to poll file flags.

### 4.5 upsert_entity

The `upsert_entity` reducer writes or updates an entity node. On first write, it
inserts a new row into `entity_nodes` with `created_at` set to the current
timestamp. On a subsequent call with the same `entity_id`, it updates the
`summary`, `confidence`, and `updated_at` fields only — the `entity_type`,
`agent_id`, and `created_at` values are immutable once set. This upsert
semantics allows agents to refine their understanding of a fact without creating
duplicate nodes.

### 4.6 link_entities

The `link_entities` reducer inserts a directed edge between two entity nodes. It
first verifies that both `from_entity_id` and `to_entity_id` exist in
`entity_nodes`. If either is missing, the write is rejected. On success it
inserts a row into `entity_edges`. Duplicate edges (same source, target, and
relation) are rejected; the caller must call `upsert_entity` to refresh either
endpoint if the relationship content changes.

### Graph traversal note

Deep graph traversal across multiple hops from `entity_nodes` through
`entity_edges` and back to `entity_nodes` must be implemented as reducer-side
TypeScript logic, not as server-side recursive queries. SpacetimeDB v2.5 does
not support recursive queries. The recommended pattern is a bounded BFS emitted
by a read-only reducer (a reducer that writes nothing and returns a result set),
capped at a maximum hop depth of two to avoid traversal cost growth.

---

## 5. RLS Read Rules

SpacetimeDB v2.5 applies row-level security at subscription time. The Lattice
uses identity-scoped filtering organized around `session_id` and `agent_id`.

**Session-scoped visibility.** All tables carry a `session_id` column. A
client's subscription receives only rows whose `session_id` matches the session
the client authenticated into. Rows from other sessions are not returned even if
the client holds a wildcard subscription. This is the primary isolation
boundary.

**Agent-scoped write authority.** Reducers validate that the identity on the
incoming connection matches the `agent_id` being written. A PM agent cannot
submit a receipt on behalf of a DEV agent; only the DEV agent's own connection
may call `submit_receipt` with that `agent_id`. This prevents impersonation
without requiring a separate ACL table.

**Read-only control-plane roles.** PM and ODIN roles receive read subscriptions
to all tables within their session scope. They do not have a higher write
privilege than worker agents — they simply hold subscriptions to tables (such as
`wake_events` and `state_transitions`) that trigger push notifications on every
commit, replacing the polling pattern.

**RLS filter sketch.** For each table, the effective subscription predicate is
`session_id = :caller_session`. For the `agents` and `role_slots` tables an
additional optional predicate scopes to a single `agent_id` for agents that
want only their own row pushed. The `entity_nodes` and `entity_edges` tables
use the same session predicate; there is no per-agent visibility restriction on
collective memory — all team members can read all entity nodes in their session.

**Rejected-write visibility.** Rows in `receipts` with `valid = false` are
readable by all agents in the session. This is intentional: rejected receipts
are evidence artifacts, not secrets, and PM and ODIN roles need to see them for
forensic review.

---

## 6. Sequencing and Migration Path

### Phase 0 (current): File-based v0 data layer

`odin-watch` writes two kinds of artifacts to the wake-flag directory configured
via `odin-watch --flag-dir`:

- **Wake-flag files.** One file per agent containing the most recent classifier
  verdict. The PM polls these files at a configured cadence (typically every
  two minutes) to decide whether to intervene.
- **Compact state ledger files.** Append-only NDJSON files recording the full
  event stream for a session, used for forensic review and session handoffs.

This layer is fully deployed and production-validated. No Lattice adoption
decision is required to operate ODIN Sentinel teams.

### Phase 1: Parallel validation

When go/no-go criteria are met (see [Section 8](#8-gono-go-criteria-table)), a
Lattice module can be started alongside the file-based layer. `odin-watch` writes
to both sinks simultaneously. The Lattice rows are validated against the file
records; if they match, confidence in the Lattice's data integrity is
established. This phase runs for at least three sessions before Phase 2.

### Phase 2: Sink switchover

Once parallel validation is complete, `odin-watch` is reconfigured to write only
to the Lattice. File-based output is preserved as a fallback but is no longer
the primary sink. PM roles switch from file-poll subscriptions to push
subscriptions. The compact state ledger continues to be written locally as an
audit record independent of the Lattice.

### Schema compatibility guarantee

Because the Lattice ingests the same record shapes that the v0 file layer
produces, the migration is a transport change, not a schema change. No
transformation of historical data is required. The file-based layer remains
valid indefinitely as a fallback if the Lattice is shut down.

### Schema evolution policy

SpacetimeDB v2.5 schema migrations support adding new columns and new tables.
Removing columns or changing column types requires a module re-deployment and a
full data migration. The Lattice schema should therefore be treated as
append-only within a major version: new columns may be added; existing columns
are immutable. If a breaking change is needed, it is addressed by introducing a
new table alongside the old one and migrating reads before dropping the old table.

---

## 7. License Obligations

### SpacetimeDB v2.5 — BSL 1.1

SpacetimeDB v2.5 is released under the Business Source License 1.1. BSL 1.1 is
source-available but not open-source. It imposes production-use restrictions
during the change-date period: specifically, the license specifies a
"Additional Use Grant" that permits non-production use and evaluation, but
restricts certain production deployments without a commercial agreement.

After the change date, the license converts to AGPL v3 with a linking exception.
The linking exception is relevant because it allows applications that merely
communicate with a SpacetimeDB module over the network (including via the
WebSocket SDK) to retain their own license without being required to adopt AGPL.
A sidecar package that links against SpacetimeDB client libraries at compile time
may not benefit from this exception and requires separate legal review.

**Obligations for any distributed `@bradheitmann/odin-lattice` package:**

- The package README and LICENSE file must disclose that SpacetimeDB is a BSL 1.1
  dependency.
- Any redistribution of SpacetimeDB binaries or modules bundled with the package
  requires compliance with BSL 1.1 production-use terms.
- The maintainer must track the SpacetimeDB change date and update the license
  disclosure when the BSL period ends and AGPL v3 takes effect.

### herdr — AGPL-3.0 + Commercial

If the Lattice design is extended to ingest data from herdr (the agent-state-aware
terminal multiplexer), the AGPL-3.0 license applies to any artifact that links
against herdr libraries. AGPL-3.0 requires that network-accessible services using
AGPL-licensed code make their source available. A commercial license is available
from the herdr maintainers for deployments where AGPL terms are incompatible.

Legal review is required before any `@bradheitmann/odin-lattice` artifact that
links against herdr is distributed publicly.

---

## 8. Go/No-Go Criteria Table

The Lattice remains in design state until **all** Adopt criteria in the table
below are satisfied. If **any** Defer condition applies, implementation is
blocked.

| Criterion | Adopt | Defer |
|---|---|---|
| Documented AI-agent deployment on SpacetimeDB | At least one verified production or extended-evaluation deployment of an AI-agent workload on SpacetimeDB v2.5 | Zero documented cases — unproven track record for agent workloads |
| Local RAM budget validated | Team dataset size (agents + receipts + wake events for a full session) measured and confirmed to fit within the target machine's available RAM budget | Dataset size unknown or measured to exceed available RAM |
| BSL 1.1 legal review complete | Review complete; distribution restrictions understood and addressed (either acceptable for the use case or a commercial agreement is in place) | Review not started or outstanding ambiguity about production-use restrictions |
| v0 file-based layer production-validated | At least three full-session runs using odin-watch file output with no data-integrity issues reported | File-based layer not yet deployed or fewer than three validated sessions |
| macOS single-node self-host tested | SpacetimeDB single binary self-hosted on macOS, module deployed, client connected, and round-trip latency measured end-to-end | Self-host not tested on target platform |
| Schema migration tooling available | A tested procedure exists for adding columns to a live Lattice module without full re-deployment data loss | No tested migration procedure |
| Multi-machine requirement absent or Maincloud acceptable | Either the team runs on a single machine (self-hosted suffices) or a Maincloud deployment is acceptable for the workload | Team requires multi-machine self-hosted clustering (not available in v2.5) |

**Decision rule:** ALL Adopt criteria must be true before beginning
implementation of the Lattice module. If any Defer condition applies, the Lattice
stays in design state and `odin-watch` file output remains the production data
layer.

---

## 9. Package Structure

The Lattice is packaged as a separate workspace distribution named
`@bradheitmann/odin-lattice`. It is never listed as a dependency of
`@bradheitmann/odin-sentinel`. An operator who does not adopt the Lattice
experiences no runtime cost, no added package footprint, and no behavior
difference — the zero-backend, no-required-runtime identity of ODIN Sentinel is
fully preserved.

The expected workspace layout when the package is eventually implemented:

**`packages/odin-lattice/`** — workspace root for the package.

**`packages/odin-lattice/src/schema/`** — TypeScript type definitions
describing the shape of each table row as used by the client SDK. These types
are derived from the table designs in Section 3 and are used for subscription
result decoding on the client side, not for server-side DDL.

**`packages/odin-lattice/src/reducers/`** — Client-side reducer call wrappers
for `submit_receipt`, `record_delivery`, `transition_state`, `raise_wake`,
`upsert_entity`, and `link_entities`. Each wrapper serializes the call
arguments and dispatches them over the SpacetimeDB WebSocket connection. Input
validation is performed client-side before the call is dispatched, mirroring the
server-side validation described in Section 4.

**`packages/odin-lattice/src/client/`** — A WebSocket client wrapper that
manages the SpacetimeDB connection lifecycle (connect, authenticate via OIDC,
subscribe, reconnect on drop). PM and ODIN roles use this wrapper to receive
push notifications from `wake_events` and `state_transitions` subscriptions.

**`packages/odin-lattice/src/bfs/`** — Bounded breadth-first search utilities
operating on locally-cached `entity_nodes` and `entity_edges` subscription
results. This is the client-side traversal logic described in Section 4's graph
traversal note. Traversal depth is capped at two hops by default and
configurable to a maximum of four.

**`packages/odin-lattice/README.md`** — Installation instructions, BSL 1.1
license disclosure, usage examples, and the go/no-go criteria summary directing
operators to Section 8 of this document before adopting the package.

**`packages/odin-lattice/package.json`** — Package manifest declaring
`@bradheitmann/odin-lattice` as the package name with zero cross-dependency on
`@bradheitmann/odin-sentinel`. SpacetimeDB client SDK and any other runtime
dependencies are listed here, not hoisted into the sentinel package.

**`packages/odin-lattice/module/`** — (Populated only when go/no-go criteria
are met.) The SpacetimeDB TypeScript module source. This directory is empty or
absent during the design phase. Its presence in the repository signals that the
adoption decision has been made and implementation has begun.

---

*End of ODIN Lattice Design.*
