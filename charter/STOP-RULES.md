# Stop rules (binding; only the owner relaxes them)
S1. No repair cycle beyond the predeclared count on a slice. A new finding is recorded as an obligation on the next bounded slice, not fixed in place; exception: a defect that breaks a listed guarantee inside the landing surface stops and goes to the owner with a one-paragraph recommendation.
S2. A proof is not complete until the run it produced has been reopened and compared.
S3. Two findings in the same feature from two different reviewers: the feature is cut from the candidate into a linked slice, not fixed in place.
S4. One work item, one heavy lane. The proof list is written before dispatch and does not grow during it.
S5. A slice that fails paired QA twice goes to the owner.
S6. Full suite green on exact bytes before any QA dispatch. Checkpoints list exact last-green and last-red commands.
S7. Workers: read before edit, backtrace before analysis, "acceptable" is never a decision, no interpreter one-liners, one guarantee per test.
