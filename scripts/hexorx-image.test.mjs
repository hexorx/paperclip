import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(new URL("../.github/workflows/hexorx-image.yml", import.meta.url), "utf8");
const publish = workflow.split("\n  publish:\n")[1];
const condition = publish.match(/^    if: (.+)$/m)[1];
const sourceValidation = workflow.match(/run: '(\[\[.+\]\])'/)[1];
const tagCheck = publish.match(/      - name: Refuse existing image tags[\s\S]*?        run: \|\n([\s\S]*?)      - name: Publish reviewed production image/)[1]
  .split("\n").map((line) => line.replace(/^          /, "")).join("\n");

const eligible = (event_name, ref = "refs/heads/hexorx", repository = "hexorx/paperclip") =>
  Function("github", `return ${condition};`)({ event_name, ref, repository });

test("push and PR events cannot publish; manual dispatch is restricted to the fork release branch", () => {
  assert.equal(eligible("push"), false);
  assert.equal(eligible("pull_request"), false);
  assert.equal(eligible("workflow_dispatch"), true);
  assert.equal(eligible("workflow_dispatch", "refs/heads/master"), false);
  assert.equal(eligible("workflow_dispatch", "refs/heads/hexorx", "other/paperclip"), false);
  assert.match(publish, /needs: \[verify, workspace, tests, image\]/);
  assert.match(workflow, /workflow_dispatch:\n    inputs:\n      ref:[\s\S]*?required: true/);
});

test("manual source accepts a full immutable SHA and rejects mutable or malformed refs", () => {
  for (const ref of ["a".repeat(40), "b0a6279de" + "0".repeat(31)]) {
    assert.equal(spawnSync("bash", ["-e", "-c", sourceValidation], { env: { SOURCE_REF: ref } }).status, 0);
  }
  for (const ref of ["", "hexorx", "refs/tags/v1", "abc123", "a".repeat(41), "$(exit 0)"]) {
    assert.notEqual(spawnSync("bash", ["-e", "-c", sourceValidation], { env: { SOURCE_REF: ref } }).status, 0);
  }
});

test("all jobs build or verify the selected source and the published identity uses it", () => {
  const checkouts = [...workflow.matchAll(/uses: actions\/checkout@v7\n        with:\n          ref: (.+)/g)].map((match) => match[1]);
  assert.equal(checkouts.length, 5);
  for (const ref of checkouts) assert.match(ref, /inputs.ref/);
  assert.doesNotMatch(publish, /github.sha|GITHUB_SHA/);
  assert.match(publish, /sha-\$\{\{ inputs.ref \}\}/);
});

// Run the actual preflight shell with a fake registry. No registry requests or uploads occur.
test("tag preflight allows only two absent tags and refuses existing tags or registry errors", () => {
  const mockRegistry = `curl() {
if [[ "$*" == *'/token?'* ]]; then
  if [[ "$TOKEN_FAILURE" == 1 ]]; then exit 22; fi
  echo '{"token":"test-token"}'
else
  if [[ "$CURL_FAILURE" == 1 ]]; then exit 7; fi
  if [[ "$*" == *'/manifests/sha-'* ]]; then printf '%s' "$SHA_STATUS"; else printf '%s' "$VERSION_STATUS"; fi
fi
}
`;
  const run = (version, sha, extra = {}) => spawnSync("bash", ["--noprofile", "--norc", "-e", "-o", "pipefail", "-c", mockRegistry + tagCheck], {
    env: { ...process.env, GHCR_USER: "test", GHCR_PASSWORD: "test", IMAGE_VERSION: "2026.916.1-hex.5", SOURCE_REF: "a".repeat(40), VERSION_STATUS: version, SHA_STATUS: sha, ...extra },
    encoding: "utf8",
  });
  const absent = run("404", "404");
  assert.equal(absent.status, 0, absent.stderr);
  for (const status of ["200", "401", "403", "429", "500"]) {
    assert.notEqual(run(status, "404").status, 0);
    assert.notEqual(run("404", status).status, 0);
  }
  assert.notEqual(run("404", "404", { TOKEN_FAILURE: "1" }).status, 0);
  assert.notEqual(run("404", "404", { CURL_FAILURE: "1" }).status, 0);
});
