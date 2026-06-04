# SCP Harness Skill Targets

This file records local skill/adapters for SCP policy access. Verify live paths before claiming a harness uses a native skill loader.

## Source Of Truth And Sync Policy

Master editable source:

- `~/.agents/skills/odin-scp/`

Runtime copies are synchronized snapshots, not independent policy forks. Edit the master first, then run `scripts/sync-installations.sh` from the master directory to copy the full directory to each native `SKILL.md` target and verify hashes.

After every sync, verify all native `SKILL.md` files have the same SHA-256 hash and that adapters mention the current mandatory markers: `SCP_BOOT_RECEIPT`, `SCP-TEAM-MANIFEST`, `[SCP-DELEGATE]`, `[SCP-CMUX-DELIVERY]`, `[SCP-FINISH]`, `$odin-scp --finish`, `HOOK-EXCEPTION`, `BLOCKED_BY_LIMIT`, control-plane non-implementation, self-bootstrap, and post-run hygiene reset.

## Native or Apparent SKILL.md Targets

Install the `odin-scp` skill directory into:

- Codex: `~/.codex/skills/odin-scp`
- Claude Code: `~/.claude/skills/odin-scp`
- Shared agent pool: `~/.agents/skills/odin-scp`
- Goose: `~/.config/goose/skills/odin-scp`
- KiloCode: `~/.kilocode/skills/odin-scp`
- Cursor shared skills: `~/.cursor/skills/odin-scp`
- Cursor-specific skills: `~/.cursor/skills-cursor/odin-scp`
- OpenHands: `~/.openhands/skills/odin-scp`
- Pi: `~/.pi/agent/skills/odin-scp`

## Adapter Targets

These harnesses were present locally but do not expose the same verified native skill directory in the inspected configuration:

- OpenCode: install adapter prompt at `~/.config/opencode/skills/odin-scp/SKILL.md` and `~/.opencode/skills/odin-scp/SKILL.md`.
- Droid: use `--append-system-prompt-file` with the canonical prompt adapter, or paste the Boot Block plus role assignment into the pane.
- Crush: install a command adapter at `~/.crush/commands/odin-scp.md`.
- Zed: install a file adapter at `~/.zed/skills/odin-scp/SKILL.md`; Zed/ACP agents can also be started with the canonical prompt pasted into the agent panel.

## Fallback Rule

If a harness cannot load SKILL.md directly, it is still eligible for any SCP role when the dispatch prompt embeds:

1. The active role.
2. The `SCP_BOOT_RECEIPT`.
3. `authority_layer`, `may_implement`, `may_qa_accept`, `delegates_to`, `reports_to`, and `worker_exception_authority`.
4. The exact write scope.
5. The canonical repo path.
6. The closure label rules.
7. The adversarial QA requirement.
8. Hook/validator exception rules.
9. Branch-authority preclaim gates.
10. `[SCP-POLL]`, `[SCP-DELEGATE]`, `[SCP-CMUX-DELIVERY]`, `[SCP-COORDINATION]`, `[SCP-IDLE]`, `[SCP-FREEZE]`, and `[SCP-FINISH]` receipt requirements.
11. The control-plane non-implementation rule.
12. The self-bootstrap team lifecycle and `SCP-TEAM-MANIFEST` requirement when one `EXEC PM` pane is asked to create teams.
13. A pointer to the branch-visible SCP package once adoption is active.

Interchangeability means any harness can occupy any role when given the same role contract and proof gates. It does not mean an agent may self-accept, self-close, or ignore separation of duties.
