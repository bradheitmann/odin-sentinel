# QA Slice Template

Use this as a public starter template. Replace every placeholder before launch.

## Parent DEV Reference

- DEV task: `<task id or title>`
- DEV changed files: `<list supplied by DEV>`
- Expected verification: `<commands or checks>`

## Fresh-Context Review

QA starts from the task contract and changed files, not from DEV's confidence.

## Checks

- Acceptance criteria:
  - `<criterion>` -> PASS/FAIL
- Scope compliance:
  - Only declared write-allowed files changed: PASS/FAIL
- Security/privacy:
  - No secrets printed or committed: PASS/FAIL
  - No unsafe permission or auth behavior: PASS/FAIL
- Regression risk:
  - Relevant tests or manual checks reproduced: PASS/FAIL
- User-defined criteria:
  - `<project-specific criterion>` -> PASS/FAIL

## QA Verdict

Return one verdict:

- PASS: all required checks passed.
- FAIL: one or more required checks failed.
- BLOCKED: QA could not verify because required evidence, access, or commands are missing.

QA reports issues. QA does not fix code during the QA pass.

## Minimal Filled Example

- DEV task: `Update one README paragraph to clarify install steps`
- DEV changed files: `README.md`
- Expected verification: `pnpm test`
- Acceptance criterion: `README explains global and zero-install paths`
- Scope compliance: `Only README.md changed`
- Verdict: `PASS`, `FAIL`, or `BLOCKED` with one-sentence evidence
