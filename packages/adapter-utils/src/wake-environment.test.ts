import { spawnSync } from "node:child_process";
import { buildSshSpawnTarget } from "./ssh.js";
import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  boundPaperclipWakePayloadEnv,
  PAPERCLIP_WAKE_ENV_MAX_BYTES,
  runChildProcess,
  stringifyPaperclipWakePayload,
} from "./server-utils.js";

const entryBytes = (value: string) => Buffer.byteLength(`PAPERCLIP_WAKE_PAYLOAD_JSON=${value}\0`);

describe("wake environment transport", () => {
  it("keeps small payloads byte-for-byte and accepts the exact entry byte limit", () => {
    const small = JSON.stringify({ version: 1, reason: "issue_assigned" });
    expect(boundPaperclipWakePayloadEnv(small)).toBe(small);
    const exact = "x".repeat(PAPERCLIP_WAKE_ENV_MAX_BYTES - entryBytes(""));
    expect(boundPaperclipWakePayloadEnv(exact)).toBe(exact);
    expect(entryBytes(boundPaperclipWakePayloadEnv(exact + "x"))).toBeLessThan(PAPERCLIP_WAKE_ENV_MAX_BYTES);
  });

  it.each(["x", "😀", "漢", "\\\"\n"])("bounds oversized %j history without certifying partial coverage", (text) => {
    const json = JSON.stringify({ continuationContext: { messages: [text.repeat(150_000)] } });
    const bounded = boundPaperclipWakePayloadEnv(json);
    expect(entryBytes(bounded)).toBeLessThanOrEqual(PAPERCLIP_WAKE_ENV_MAX_BYTES);
    expect(JSON.parse(bounded)).toMatchObject({
      truncated: true,
      fallbackFetchNeeded: true,
      retrieval: { path: "/api/heartbeat-runs/$PAPERCLIP_RUN_ID", field: "contextSnapshot.paperclipWake" },
    });
    expect(JSON.parse(bounded)).not.toHaveProperty("coverage");
    expect(boundPaperclipWakePayloadEnv(bounded)).toBe(bounded);
  });

  it.each(["'".repeat(30_000), "'😀".repeat(6_500)])(
    "starts a child with actual SSH arguments for quote-heavy wakes (%#)", async (body) => {
      const full = JSON.stringify({ messages: [body] });
      expect(entryBytes(full)).toBeLessThan(PAPERCLIP_WAKE_ENV_MAX_BYTES);
      const build = (wake: string) => buildSshSpawnTarget({
        spec: {
          host: "ssh.example.test", port: 22, username: "ssh-user",
          remoteCwd: "/srv/paperclip/workspace", remoteWorkspacePath: "/srv/paperclip/workspace",
          privateKey: null, knownHosts: null, strictHostKeyChecking: true,
        },
        command: "node", args: ["--version"], env: { PAPERCLIP_WAKE_PAYLOAD_JSON: wake },
      });
      const original = await build(full);
      const bounded = boundPaperclipWakePayloadEnv(full);
      const target = await build(bounded);
      try {
        // Inspect and launch the actual generated arguments, without contacting
        // an SSH host or inheriting the test runner's own wake environment.
        expect(Buffer.byteLength(original.args.at(-1)!) + 1).toBeGreaterThan(128 * 1024);
        expect(JSON.parse(bounded).fallbackFetchNeeded).toBe(true);
        expect(Buffer.byteLength(target.args.at(-1)!) + 1).toBeLessThan(64 * 1024);
        const child = spawnSync("/bin/true", target.args, { env: { PATH: process.env.PATH } });
        expect(child.error).toBeUndefined();
        expect(child.status).toBe(0);
      } finally {
        await original.cleanup();
        await target.cleanup();
      }
    },
  );

  it("counts UTF-8 bytes rather than JavaScript string length", () => {
    const json = JSON.stringify({ body: "😀".repeat(9_000) });
    expect(json.length).toBeLessThan(PAPERCLIP_WAKE_ENV_MAX_BYTES);
    expect(JSON.parse(boundPaperclipWakePayloadEnv(json)).fallbackFetchNeeded).toBe(true);
  });

  it("does not shorten the shared serializer used by prompts", () => {
    const description = "history😀".repeat(30_000);
    const full = stringifyPaperclipWakePayload({
      version: 1, reason: "issue_assigned", issue: { id: randomUUID(), description },
    })!;
    expect(JSON.parse(full).issue.description).toBe(description);
    expect(entryBytes(boundPaperclipWakePayloadEnv(full))).toBeLessThan(PAPERCLIP_WAKE_ENV_MAX_BYTES);
  });

  it("starts a real child with oversized explicit and inherited wakes while preserving stdin", async () => {
    const full = JSON.stringify({ messages: ["😀".repeat(100_000)] });
    vi.stubEnv("PAPERCLIP_WAKE_PAYLOAD_JSON", full);
    try {
      const result = await runChildProcess(randomUUID(), process.execPath, ["-e", `
        let input = '';
        process.stdin.setEncoding('utf8');
        process.stdin.on('data', chunk => input += chunk);
        process.stdin.on('end', () => process.stdout.write(JSON.stringify({
          env: JSON.parse(process.env.PAPERCLIP_WAKE_PAYLOAD_JSON),
          inputBytes: Buffer.byteLength(input),
          envBytes: Buffer.byteLength('PAPERCLIP_WAKE_PAYLOAD_JSON=' + process.env.PAPERCLIP_WAKE_PAYLOAD_JSON + '\\0'),
        })));
      `], {
        cwd: process.cwd(), env: { PAPERCLIP_WAKE_PAYLOAD_JSON: full }, stdin: full,
        timeoutSec: 5, graceSec: 1, onLog: async () => {},
      });
      expect(result.exitCode).toBe(0);
      const output = JSON.parse(result.stdout);
      expect(output.inputBytes).toBe(Buffer.byteLength(full));
      expect(output.envBytes).toBeLessThan(PAPERCLIP_WAKE_ENV_MAX_BYTES);
      expect(output.env.fallbackFetchNeeded).toBe(true);
      const inherited = await runChildProcess(randomUUID(), process.execPath,
        ["-e", "process.stdout.write(String(process.env.PAPERCLIP_WAKE_PAYLOAD_JSON))"], {
          cwd: process.cwd(), env: {}, timeoutSec: 5, graceSec: 1, onLog: async () => {},
        });
      expect(inherited.exitCode).toBe(0);
      expect(inherited.stdout).toBe("undefined");
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
