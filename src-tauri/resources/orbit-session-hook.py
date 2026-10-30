"""Local observation only: no decisions, prompts, responses, or tool results."""
import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile
import time


def observe():
    raw = sys.stdin.buffer.read(1024 * 1024 + 1)
    if len(raw) > 1024 * 1024:
        return
    data = json.loads(raw)
    if not isinstance(data, dict):
        return
    event = data.get("hook_event_name", "")
    session_id = data.get("session_id", "")
    agent_id = data.get("agent_id", "")
    if not isinstance(session_id, str) or not session_id.strip() or len(session_id) > 512:
        return
    if event not in ("UserPromptSubmit", "Notification", "PermissionRequest", "PreToolUse", "PostToolUse", "Stop", "SubagentStart", "SubagentStop"):
        return
    # Optional metadata is scalar and bounded; never serialize nested contents.
    for key in ("agent_type", "tool_name", "transcript_path"):
        value = data.get(key)
        if not isinstance(value, str) or len(value) > 4096:
            data[key] = None
    if event in ("SubagentStart", "SubagentStop"):
        if not isinstance(agent_id, str) or not agent_id.strip() or len(agent_id) > 512:
            return
        payload = {"session_id": session_id, "hook_event_name": event,
                   "agent_id": agent_id, "agent_type": data.get("agent_type"),
                   "ts": int(time.time() * 1000)}
        identity = json.dumps([os.getcwd(), session_id, agent_id])
    else:
        if "agent_id" in data:
            return
        if event == "Notification" and data.get("notification_type") not in ("permission_prompt", "idle_prompt"):
            return
        # These are lifecycle observations, not permission decisions or session success.
        state = {"Stop": "idle", "Notification": "waiting", "PermissionRequest": "waiting"}.get(event, "working")
        payload = {"session_id": session_id, "state": state, "ts": int(time.time() * 1000),
                   "tool": data.get("tool_name"),
                   "transcript_path": data.get("transcript_path") if event == "Stop" else None}
        identity = os.getcwd() + session_id
    digest = hashlib.md5(identity.encode()).hexdigest()[:16]
    directory = Path.home() / ".orbit"
    directory.mkdir(exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=directory,
                                         prefix=f"session-{digest}-", suffix=".tmp", delete=False) as stream:
            temporary = stream.name
            json.dump(payload, stream)
        os.replace(temporary, directory / f"session-{digest}.json")
    finally:
        if temporary is not None:
            try:
                os.unlink(temporary)
            except OSError:
                pass


try:
    observe()
except Exception:
    # Telemetry must never influence permission, execution, or stop decisions.
    pass
