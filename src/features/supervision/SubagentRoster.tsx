import { useT } from "../../i18n/i18n";
import "./subagents.css";

/** Official session JSON has no granular subagent API. Never replay legacy hooks. */
export default function SubagentRoster({ conversationId: _conversationId }: { conversationId?: string }) {
  const t = useT();
  return <p className="subagent-roster">{t("subagents.unavailable")}</p>;
}
