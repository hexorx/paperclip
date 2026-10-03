# @paperclipai/adapter-utils

Shared utilities for Paperclip adapters: process spawning, environment
injection, sandbox/SSH transport, workspace sync, and the round-trip helpers
that move code between the local execution-workspace cwd and wherever the
agent actually runs.

For the adapter-author guide see
[`docs/adapters/creating-an-adapter.md`](../../docs/adapters/creating-an-adapter.md)
and the in-repo notes at [`packages/adapters/AUTHORING.md`](../adapters/AUTHORING.md).

## No-remote-git contract

The local execution-workspace cwd is the only persistence boundary across
runs. No adapter may depend on a git remote for cross-run state.

Adapters that run the agent on a different host should use the SSH round-trip
helpers in [`src/ssh.ts`](./src/ssh.ts):

- `prepareWorkspaceForSshExecution({ spec, localDir, remoteDir })` — bundles
  the local cwd (tracked files, dirty edits, untracked additions, and the git
  history needed to reconstruct it) to `remoteDir` before the run starts. Runs
  with no `git remote` configured.
- `restoreWorkspaceFromSshExecution({ spec, localDir, remoteDir, ... })` —
  syncs the remote cwd back into `localDir` after the run, including any new
  commits the agent created. Also runs with no `git remote` configured.

`prepareRemoteManagedRuntime` in
[`src/remote-managed-runtime.ts`](./src/remote-managed-runtime.ts) wraps both
calls for adapters that want a per-run remote workspace and an automatic
`restoreWorkspace()` finally hook.

The invariant is pinned by the `no-remote-git contract` case in
[`src/ssh-fixture.test.ts`](./src/ssh-fixture.test.ts), which asserts that a
remote-only commit propagates to the local worktree through the
prepare → restore round-trip with no git remote configured at any point. Do
not regress that test.


## Wake payload environment transport

`stringifyPaperclipWakePayload` preserves the full normalized wake for prompts
and API consumers. Adapters pass its environment copy through
`boundPaperclipWakePayloadEnv`. The complete environment entry (key, equals,
UTF-8 value, and NUL) is at most 32 KiB. Small values remain byte-for-byte intact.
Large values become an explicit incomplete-context notice with
`fallbackFetchNeeded: true`; this notice is not a summary or certified coverage.

Before acting on an oversized wake, consume the complete prompt context or GET
`/api/heartbeat-runs/$PAPERCLIP_RUN_ID` with the existing run bearer credential.
Read `contextSnapshot.paperclipWake` and the accompanying run context. Normalize
`PAPERCLIP_API_URL` before appending the API path. Preserve authors, coverage,
completed actions, and interaction outcomes; never replay completed mutations.
If access policy prevents retrieval and the prompt is incomplete, report the
failure and stop instead of inferring missing authority or history. This does
not grant additional access to run telemetry.

The shared subprocess boundary bounds explicit environment overrides before
remote/sandbox wrapping, and strips inherited Paperclip runtime variables. ACPX
also bounds the final contributed environment before session launch. No payload
file, shared mount, or credential-bearing command argument is introduced.
This guards the wake entry; unrelated oversized environment entries or oversized
command arguments remain subject to the operating system's own limits.
