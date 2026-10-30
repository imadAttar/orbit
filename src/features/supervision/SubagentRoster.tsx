import { useStore } from "../../core/store";
import type { ClaudeSubagent } from "../../core/types";
import { useT } from "../../i18n/i18n";
import "./subagents.css";

const empty: ClaudeSubagent[] = [];

/** Read-only observations. No invented goals, transcripts or per-agent control. */
export default function SubagentRoster({ conversationId }: { conversationId?: string }) {
  const t = useT();
  const agents = useStore((s) => conversationId ? s.sessionSubagents[conversationId] ?? empty : empty);
  if (!agents.length) return null;
  const running = agents.filter((a) => a.status === "running").length;
  return <details className="subagent-roster">
    <summary>{t("subagents.summary", { running, total: agents.length })}</summary>
    <ul aria-label={t("subagents.title")}>
      {[...agents].sort((a, b) => Number(b.status === "running") - Number(a.status === "running") || b.updatedAt - a.updatedAt).map((agent) => <li key={agent.id}>
        <span className="subagent-roster__identity"><strong>{agent.label}</strong><code title={agent.id}>{agent.id}</code></span>
        <span className={`subagent-roster__status subagent-roster__status--${agent.status}`}>{t(`subagents.${agent.status}`)}</span>
      </li>)}
    </ul>
    <p>{t("subagents.note")}</p>
    {agents.length >= 100 && <p>{t("subagents.limit")}</p>}
  </details>;
}
