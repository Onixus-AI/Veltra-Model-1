The Super Coder workspace panel now mounts the coding-task workspace, including task history, generated files and execution controls. Previously its state changed the panel heading but still rendered the generic artifact canvas.

# Isolated repository comparison

For a completed Super Coder task, enable **Compare with selected repository** and choose a generated `.test.mjs` file. Include every source file needed by that dependency-free Node test. The connector reads those paths at one immutable selected-repository commit. The host runs the same proposed test bytes against the baseline and proposed files in two fresh offline Node 24 sandboxes, with no host credentials inside either VM. It returns exit codes, bounded logs, commit and content hashes. The completed task must belong to the caller; comparisons share the existing atomic two-attempt verification allowance. No database schema or model policy changes are required.

This is selected-file verification, not a full repository checkout, package installation, application build or deployment. Missing imports, syntax errors and poor assertions can cause a baseline failure; fail-before/pass-after is evidence to inspect, not proof of a correct diagnosis. Receipts are returned to the current client; durable receipt storage is a later milestone. Publishing remains paused, including after successful checks.

# Evidence-first repository proposals

AI-generated repository publishing is paused by default. Chat advertises `github_review_proposal` instead of write tools; stale write calls are rejected. Both single-file and multi-file connector publishing endpoints reject requests unless an operator explicitly sets `VELTRA_REPOSITORY_PUBLISH_ENABLED=true`. Review interfaces check the authenticated development policy and disable publishing while paused. This change does not enable that flag.

The read-only endpoint pins the selected repository commit, matches exact source quotes and returns line numbers. For npm commands it verifies that the named script exists in the chosen package directory. The diagnosis remains **unverified**, the test plan is **not run**, and `can_publish` is false. Matching source text does not prove the behavior claim or fix. Non-npm commands are not validated or executed.

Before restoring publishing, add isolated execution that reproduces the reported behavior, runs meaningful before/after checks and records actual results. Source matching alone must not unlock writes. The following describes the existing publisher only when explicitly enabled.

# Veltra self-development foundation

Chat can read the selected repository and propose 1–12 coordinated new or updated text files with `github_propose_changes`. The coding team offers **Review all files for one pull request**, so generated files no longer need to be applied one at a time. Existing file and PR controls remain available.

The connector reads an immutable base commit and complete tree. The review displays every affected file's current and proposed contents, including a clear new-file state. User confirmation creates one Git tree, one commit and a new `veltra/` branch, then a draft PR. Unchanged files and executable modes are preserved. Symlinks, submodules, conflicting paths, duplicate paths, secret-file paths, binary content, truncated trees and oversized changes are rejected. If repository selection or the base commit changed, preparation must be reviewed again. A content-bound operation branch lets retries recover an already-created PR or a verified commit after an uncertain provider response. The base branch is never updated.

`github_pr_checks` reads checks and commit statuses for the PR's current head SHA. This can report existing GitHub Actions builds/tests and preview deployment links. Pending, absent and truncated checks are not represented as a passing build. The tool does not execute shell commands or dispatch workflows. A repository must have its own CI/preview integrations configured; Veltra-Model-1 already has PR workflows. A model review and generated-file sandbox checks remain separately labeled evidence.

This is the first self-development milestone, not an autonomous production operator. Veltra can propose changes to its own selected repository through the same review path as any other project. The owner must connect GitHub and select the intended repository first. Credentials stay inside the authenticated connector, and task access remains separate from per-change review. This release does not grant new OAuth scopes, merge PRs, alter production infrastructure, expose credentials to models, apply database migrations, or activate n8n workflows.

Next milestones: repository-wide checkout/testing beyond configured CI, durable repair attempts that consume exact CI results, and preview acceptance before a separately approved production release. Infrastructure writes need individually scoped actions and verified outcomes.

Investigation allowance: Chat can use up to 12 model/tool rounds and 24 executed tool calls per request. At exhaustion it stops tool execution and requests one tool-free summary using the collected transcript. The answer is marked partial and should separate observations, hypotheses and unknowns. If finalization fails, a bounded execution receipt list is returned instead of discarding the work. Cancellation still stops finalization, and no write can execute during the summary pass. This is not a durable background investigation or automatic continuation.
