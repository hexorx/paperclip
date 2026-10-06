# Hexorx Paperclip fork

## Source and carried patches

`master` remains the upstream tracking branch. Do not put fork changes there.
`hexorx` starts at stable release `v2026.916.1`
(`d554c4789ed3930f8a53ac9fdf6503b3187097da`). Changes enter through feature
branch pull requests with an independent review and green CI on the reviewed head.
Never push directly to the integration branch after its initial release-tag seed.

We carry the seven commits from upstream
[PR #14523](https://github.com/paperclipai/paperclip/pull/14523), through
`40cc3ffcd62fedf543a877f936df191b0ba075cb`, cherry-picked in order with `-x`:

- `10f051f45102551a084e3b64dce09752f9bc7b97`: cancellation and SSE cursors.
- `b5715213612940e3276807f76385080c327cda77`: cancellation and final-result gaps.
- `616d381393064a7095c7f100aa06263f04e534bf`: output retention and stream-loss tests.
- `68f6a3fd9f379a67f74badb16a73d4b338f40609`: host Stop readiness and acknowledgment.
- `200205d56dcfbb844e7af788eea3055a400c8a80`: bounded readiness and gap diagnostics.
- `6d5fe9c735f5d42071f4b46af4ba3932b27c6d57`: SSE field values and cursor resets.
- `40cc3ffcd62fedf543a877f936df191b0ba075cb`: reject lossy cursor header transport.

The upstream PR stays open. This fork does not wait for its merge or release.
Fork-only files are this document, `.hexorx-version`, and the image workflow.

Release `2026.916.1-hex.2` also carries the agent pause authorization patch:
`POST /agents/:id/pause` uses the same `agent_config:update` decision with
`requiresChangeGrant` as resume. Board access and company isolation remain intact.
Pause activity records the actual actor, agent, run, and API key. Route tests
cover granted and denied agents, board access, tenant isolation, cancellation,
and audit attribution. This patch changes no database schema or migrations;
rollback to `2026.916.1-hex.1` is image-only.
The upstream PR workflow is skipped in this fork in favor of the fork workflow.
The upstream commitperclip bot workflow is upstream-only; it requires upstream
bot credentials and dependency-graph configuration. It is disabled in the fork
settings during bootstrap because `pull_request_target` reads the base workflow.
Independent human/agent review remains required. Re-enable it only after a
reviewed fork-compatible configuration is available.
No database schema changes are part of the backport.

## Build and publication

`.hexorx-version` is the release identity: `2026.916.1-hex.1` initially.
Increment the `hex.N` suffix for each new image release; never reuse an issued
version for different source. The workflow validates the exact PR head, runs the
Hermes suite explicitly (upstream's root suite omits it), runs workspace checks,
and builds the upstream Dockerfile's `production` target for `linux/amd64`.
Optional shim fixture tests require the separate fixture checkout and can skip.

Only a push resulting from a reviewed merge to `hexorx` publishes to GHCR:

- `ghcr.io/hexorx/paperclip:<version>`
- `ghcr.io/hexorx/paperclip:sha-<full-commit>`

The build summary records the digest. Deploy by digest, with the source commit
and CI URL in the rollout record. No `latest` or upstream version tag is written.
The workflow uses the repository `GITHUB_TOKEN`; do not add a personal token.
It does not change package visibility. Keep the package private unless the
owner explicitly approves public visibility; grant the deployment a read-only
package credential through the existing secret mechanism if needed.

Local checks: `pnpm install --frozen-lockfile`,
`pnpm --filter @paperclipai/hermes-paperclip-adapter test`,
`pnpm --filter @paperclipai/hermes-paperclip-adapter typecheck`,
`pnpm --filter @paperclipai/hermes-paperclip-adapter build`,
`pnpm -r typecheck`, `pnpm test:run`, and `pnpm build`.
The adapter declares an eslint command but upstream does not install eslint;
report that limitation until an independently reviewed lint setup exists.

## Moving to a new upstream release

1. Fetch upstream tags and confirm the newest stable release and its exact SHA.
2. Create a feature branch from `hexorx`. Merge the new stable tag there, resolve
   conflicts, and audit the resulting tree against that tag and the patch list.
   This advances the release base without rewriting the shared branch.
3. If a clean rebase is needed, create a new versioned integration branch from
   the new tag and replay only patches absent upstream. Open a feature PR into
   that branch. Do not force-push `hexorx` or `master`.
4. Remove carried patches only after verifying equivalent upstream behavior.
   Update this patch inventory and `.hexorx-version` in the PR.
5. Repeat tests and the image build. Record independent approval naming the
   exact head, then merge only when that head's CI is green.
6. Record the published digest and hand off to the operator. Advancing upstream
   may add migrations even though this first backport does not.

## Rollout and rollback

The operator must record the current image digest/configuration, back up the
Paperclip database and persistent data, and confirm a usable restore path before
any swap. The control-plane restart requires the owner's explicit approval.
Stage a bounded health and Hermes cancellation/event-gap validation after the
swap. Keep unconfirmed remote work quarantined until reconciled.

On failure, stop new dispatch and restore the previous image/configuration.
If the new upstream base changed the database schema, an image-only rollback
may be unsafe: use the tested database/data restore plan, with owner approval
for any operation that can discard new data. Do not delete retained backups.

## CI regression test synchronization (hex.2)

The native-session resumption Sentry assertions drain pending failure reports
with the existing `waitForPendingRunFailureReports` helper. An unrelated database
round trip did not await the background report and raced the spy assertion.
This is test-only; runtime reporting and database schema are unchanged.


## Wake environment transport (hex.3)

Local adapters and Codex ACPX now limit the wake environment entry to 32 KiB
including UTF-8 encoding and environment framing. Oversized entries explicitly
require full prompt context or retrieval from the authenticated current-run API.
Prompt serialization stays complete. Child launches bound explicit overrides
before sandbox/remote wrapping and reject inherited wake state.
There are no database changes. Rollback is the previous image digest and config.
The operator must verify a separate test issue with at least 100 KB of thread
history starts an actual agent run and retains complete context before acceptance.

## Security backports for the next release

The focused security patch carries these upstream fixes from the stable base:

- `483dbc88904672362563419e485a1c4b366db96b` (#14915): require a stored
  grant allow match and every selector match; malformed restrictions deny access.
- `c46e41e81c03cd3c8b64cf993615b604d7fe8c62` (#14914): validate native MCP
  gateway ownership and immutable profile provenance; exclude historical native
  assignments from managed gateway discovery and bind valid legacy null owners.
- `3ff3b34e15255395e38ad03d0331e55b6c056061` (#13660): return a constant
  malformed-JSON client error without sending parser input to error sinks.
- `e18ed02a566dfa10db37ea70fd2bedabb784510c` (#13657): validate heartbeat
  run UUID parameters before database lookup and document the 400 response.
- `6f40e23536ad9f80c6379543acc22871380fdc25` (#14413): redact the four
  Cloud credential and assertion headers in both self-hosted logger modes.

The grant fixture is a reduced test-only port from #14915's prerequisite
fixture. The allow-entry validator additionally rejects unknown prefixes and
empty targets even when another entry matches, so malformed mixed allow lists
also fail closed. Cloud redaction is adapted to the stable fork's logger tests; it does
not import unrelated GitHub capability changes. No schema, migration or
provider-default changes are included. Lifecycle fixes #14738 and #14773 are
separate work and are not included in this security patch.

### Release and rollback constraints

The running hex.4 source was reconciled to open fork PR #4 at immutable head
`5fb2d3e3d6df983271217e4ef4af1cda789cac91`. It adds Codex 0.160.0 to
hex.3. The candidate security files are identical at that head and integration
base `b8652016179e57ced12f8fe7131e057cf93c43f1`.

The security branch reserves `2026.916.1-hex.5`. Before a release or rollout,
independently review and integrate PR #4 and this security patch, preserve the
Codex 0.160.0 changes, and run full CI on the combined exact head. A security
branch image built without PR #4 would downgrade the installed Codex runtime.
Resolve the version-file conflict to hex.5. Do not publish a replacement hex.3
or hex.4 tag. Build with source/version arguments so health and OCI labels carry
the exact revision. Verify the immutable running image and candidate digest
before the operator rollout. Source matching alone does not establish a running
image ID or registry digest.

Stored grants with unknown or malformed restrictions now deny access. Review
those grants before rollout; correct an intended restriction through the normal
operator policy surface. Do not broaden grants to make a denied call pass.
Null and empty-object scopes preserve their previous broad behavior.

No deployment is part of this patch. For a later operator rollout, back up the
current compose reference and verify the exact previous local hex.4 image is
available before swapping images. Rollback uses that captured image reference;
do not assume the published hex.3 image is equivalent to the live hex.4 build.
There is no schema migration to reverse. Valid legacy native gateway owner
bindings persist after rollback; inspect any authorization difference instead
of clearing ownership. Rolling back also restores the earlier security behavior.
