"""Run observation hooks with a fake HOME; never touch live Claude settings."""
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
RESOURCE = ROOT / "src-tauri/resources/orbit-session-hook.py"


def hook_source():
    if RESOURCE.exists():
        return RESOURCE.read_text()
    rust = (ROOT / "src-tauri/src/claude.rs").read_text()
    match = re.search(r'let hook_command = ("python3 -c .*?);\n', rust)
    assert match is not None, "inline hook command missing"
    encoded = match.group(1)
    return json.loads(encoded).split('-c "', 1)[1][:-1]


class SessionHookTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="orbit-hook-", dir=os.environ.get("TMPDIR"))
        self.home = Path(self.temp.name)
        self.addCleanup(self.temp.cleanup)

    def run_hook(self, event=None, **fields):
        raw = fields.pop("raw", None)
        script_prefix = fields.pop("script_prefix", "")
        if raw is None:
            raw = json.dumps({"session_id": "parent", "hook_event_name": event, **fields})
        result = subprocess.run([sys.executable, "-c", script_prefix + hook_source()], input=raw,
                                text=True, capture_output=True, cwd=self.home,
                                env={**os.environ, "HOME": str(self.home), "USERPROFILE": str(self.home)}, timeout=3)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, "")
        self.assertEqual(result.stderr, "")
        return {p.name: json.loads(p.read_text()) for p in (self.home / ".orbit").glob("session-*.json")}

    def test_optional_metadata_cannot_store_structured_contents(self):
        payload = next(iter(self.run_hook("Stop", tool_name={"secret": "contents"}, transcript_path=["secret"]).values()))
        self.assertIsNone(payload["tool"])
        self.assertIsNone(payload["transcript_path"])
        payloads = self.run_hook("SubagentStart", agent_id="one", agent_type={"secret": "contents"})
        child = next(v for v in payloads.values() if v.get("agent_id") == "one")
        self.assertIsNone(child["agent_type"])
        payloads = self.run_hook("SubagentStart", agent_id="two", agent_type="x" * 4097)
        child = next(v for v in payloads.values() if v.get("agent_id") == "two")
        self.assertIsNone(child["agent_type"])

    def test_failed_atomic_publish_keeps_previous_state_and_removes_temp(self):
        before = self.run_hook("UserPromptSubmit")
        prefix = "import os\ndef fail_replace(*args):\n raise OSError('injected')\nos.replace=fail_replace\n"
        self.assertEqual(self.run_hook("Stop", script_prefix=prefix), before)
        self.assertFalse(list((self.home / ".orbit").glob("*.tmp")))

    def test_invalid_or_oversized_inputs_are_silent_noops(self):
        invalid = ["", "{", "null", "[]", "1", '"text"', "{" + '"x":' * 2000,
                   json.dumps({"session_id": "parent", "hook_event_name": "Stop", "padding": "x" * (1024 * 1024)})]
        for fields in [{}, {"session_id": ""}, {"session_id": None}, {"session_id": []},
                       {"session_id": "x" * 513}, {"hook_event_name": "unknown"}, {"hook_event_name": []},
                       {"hook_event_name": "SubagentStart"}, {"hook_event_name": "SubagentStop", "agent_id": ""},
                       {"hook_event_name": "SubagentStart", "agent_id": 42},
                       {"hook_event_name": "SubagentStart", "agent_id": "x" * 513}]:
            invalid.append(json.dumps({"session_id": "parent", "hook_event_name": "Stop", **fields}) if fields else "{}")
        for raw in invalid:
            with self.subTest(raw=raw[:100]):
                self.assertEqual(self.run_hook(raw=raw), {})

    def test_permission_request_waits_then_post_tool_resumes_parent(self):
        for event, state in [("PermissionRequest", "waiting"), ("PostToolUse", "working"), ("PreToolUse", "working"), ("Stop", "idle")]:
            payload = next(iter(self.run_hook(event, tool_name="Bash", transcript_path="/transcript", tool_input={"command": "secret"}, tool_response="secret").values()))
            self.assertEqual(payload["state"], state)
            self.assertEqual(set(payload), {"session_id", "state", "ts", "tool", "transcript_path"})
            self.assertEqual(payload["tool"], "Bash")
            self.assertEqual(payload["transcript_path"], "/transcript" if event == "Stop" else None)

    def test_only_actionable_notifications_set_waiting(self):
        for kind in ["permission_prompt", "idle_prompt"]:
            files = self.run_hook("Notification", notification_type=kind, message="secret")
            self.assertEqual(next(iter(files.values()))["state"], "waiting")
        before = files
        for kind in ["auth_success", "informational", "", None]:
            self.assertEqual(self.run_hook("Notification", notification_type=kind), before)

    def test_child_main_state_events_do_not_mutate_parent(self):
        before = self.run_hook("UserPromptSubmit")
        for event in ["UserPromptSubmit", "Notification", "PermissionRequest", "PreToolUse", "PostToolUse", "Stop"]:
            for agent_id in ["child", "", None, []]:
                with self.subTest(event=event, agent_id=agent_id):
                    self.assertEqual(self.run_hook(event, agent_id=agent_id, notification_type="permission_prompt"), before)

    def test_subagent_lifecycle_is_separate_from_parent_and_other_agents(self):
        parent = self.run_hook("UserPromptSubmit")
        for aid in ["one", "two"]:
            files = self.run_hook("SubagentStart", agent_id=aid, agent_type="Explore", prompt="secret")
            self.assertEqual(len(files), 1 + ["one", "two"].index(aid) + 1)
            self.assertEqual({k: files[k] for k in parent}, parent)
        before = files
        files = self.run_hook("SubagentStop", agent_id="one", agent_type="Explore", last_assistant_message="secret")
        self.assertEqual(set(files), set(before))
        child = next(v for v in files.values() if v.get("agent_id") == "one")
        self.assertEqual(set(child), {"session_id", "hook_event_name", "agent_id", "agent_type", "ts"})
        self.assertEqual(child["hook_event_name"], "SubagentStop")
        self.assertEqual(child["session_id"], "parent")
        self.assertEqual(child["agent_type"], "Explore")
        self.assertIs(type(child["ts"]), int)
        self.assertGreater(child["ts"], 0)
        self.assertFalse(list((self.home / ".orbit").glob("*.tmp")))


if __name__ == "__main__":
    unittest.main()
