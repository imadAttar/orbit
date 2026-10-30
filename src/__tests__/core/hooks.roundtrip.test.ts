import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
vi.mock("../../core/persistence", () => ({ loadData: vi.fn().mockResolvedValue(null), debouncedSave: vi.fn() }));
vi.mock("../../core/api", () => ({ pty: { killSilent: vi.fn() }, scrollback: { clear: vi.fn() }, terminal: { notifyDone: vi.fn() }, listen: vi.fn().mockResolvedValue(() => {}) }));
import { useStore } from "../../core/store";
import { listen } from "../../core/api";
import { buildSupervision } from "../../core/supervision";

let home: string | undefined;
afterEach(() => { if (home) rmSync(home, { recursive: true, force: true }); });
it("consumes real Python hook payloads through the frontend listener without inference or live settings", async () => {
  home = mkdtempSync(join(tmpdir(), "orbit-hook-roundtrip-"));
  expect(dirname(home)).toBe(tmpdir());
  await useStore.getState().init();
  const calls = vi.mocked(listen).mock.calls;
  const receive = calls[calls.length - 1][1] as (raw: string) => void;
  useStore.setState({ activePid: "p", activeSid: "s", projects: [{ id: "p", name: "Fixture", dir: home, sessions: [{ id: "s", name: "Parent", claudeSessionId: "roundtrip", runtimeStatus: "running" }] }], sessionStates: {}, sessionSubagents: {} });
  const run = (event: string, extra = {}) => {
    const result = spawnSync("python3", [join(process.cwd(), "src-tauri/resources/orbit-session-hook.py")], {
      input: JSON.stringify({ session_id: "roundtrip", hook_event_name: event, ...extra }),
      cwd: home, env: { ...process.env, HOME: home, USERPROFILE: home }, encoding: "utf8", timeout: 5000,
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe("");
    const file = readdirSync(join(home!, ".orbit")).map((name) => readFileSync(join(home!, ".orbit", name), "utf8"))
      .find((raw) => { const d = JSON.parse(raw); return d.hook_event_name === event || (!d.hook_event_name && !event.startsWith("Subagent")); });
    expect(file).toBeTruthy(); receive(file!);
  };
  run("UserPromptSubmit");
  run("SubagentStart", { agent_id: "observed-child" });
  run("Stop");
  let state = useStore.getState();
  expect(buildSupervision(state.projects, state.sessionStates, state.sessionTools, state.sessionSubagents)[0].status).toBe("working");
  expect(state.sessionSubagents.roundtrip[0].status).toBe("running");
  run("SubagentStop", { agent_id: "observed-child" });
  state = useStore.getState();
  expect(state.sessionSubagents.roundtrip[0].status).toBe("stopped");
  expect(buildSupervision(state.projects, state.sessionStates, state.sessionTools, state.sessionSubagents)[0].status).toBe("idle");
});
