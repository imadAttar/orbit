import { useMemo, useState } from "react";
import { buildSupervision, selectSupervision, type SupervisionFilter } from "../../core/supervision";
import { useStore } from "../../core/store";
import { useT } from "../../i18n/i18n";
import NavigationIcon from "../../layout/NavigationIcon";
import SubagentRoster from "./SubagentRoster";
import "./supervision.css";

export default function SupervisionPanel({ onOpen }: { onOpen: (sid: string) => void }) {
  const t = useT();
  const projects = useStore((s) => s.projects);
  const states = useStore((s) => s.sessionStates);
  const tools = useStore((s) => s.sessionTools);
  const subagents = useStore((s) => s.sessionSubagents);
  const hookSetup = useStore((s) => s.hookSetup);
  const enableHooks = useStore((s) => s.enableProjectHooks);
  const [filter, setFilter] = useState<SupervisionFilter>("all");
  const [query, setQuery] = useState("");
  const rows = useMemo(() => buildSupervision(projects, states, tools, subagents), [projects, states, tools, subagents]);
  const shown = useMemo(() => selectSupervision(rows, filter, query), [rows, filter, query]);
  const counts = {
    all: rows.length,
    attention: rows.filter((r) => r.needsAttention).length,
    active: rows.filter((r) => r.status === "working" || r.status === "running").length,
  };
  return <section className="supervision" aria-label={t("supervision.title")}>
    <header className="supervision__header">
      <div className="supervision__eyebrow">{t("supervision.eyebrow")}</div>
      <h1>{t("supervision.title")}</h1>
      <p>{t("supervision.subtitle")}</p>
    </header>
    {projects.filter((p) => hookSetup[p.id] === "failed").map((project) => <div className="supervision__warning" role="alert" key={project.id}><span>{t("supervision.hooksFailed", { name: project.name })}</span><button onClick={() => void enableHooks(project.id)}>{t("supervision.retryHooks")}</button></div>)}
    <div className="supervision__toolbar">
      <div className="supervision__filters" role="group" aria-label={t("supervision.filters")}>
        {(["all", "attention", "active"] as const).map((value) => <button key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>
          {t(`supervision.filter.${value}`)}<span>{counts[value]}</span>
        </button>)}
      </div>
      <label className="supervision__search"><NavigationIcon kind="search" /><input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("activity.search")} aria-label={t("activity.search")} /></label>
    </div>
    <div className="supervision__list" aria-label={t("supervision.sessions")}>
      <div className="supervision__columns" aria-hidden="true"><span>{t("supervision.session")}</span><span>{t("supervision.state")}</span><span>{t("supervision.observation")}</span><span /></div>
      {shown.map(({ project, session, status, tool }) => <div key={session.id} className="supervision__session"><button className={`supervision__row supervision__row--${status}`} onClick={() => onOpen(session.id)} aria-label={t("supervision.open", { name: session.name, project: project.name })}>
        <span className="supervision__identity"><span className="supervision__project">{project.name}<span className="supervision__engine">{session.type === "terminal" ? t("activity.terminal") : "Claude Code"}</span></span><strong>{session.name}</strong></span>
        <span className={`supervision__status supervision__status--${status}`}><i aria-hidden="true" />{t(`supervision.status.${status}`)}</span>
        <span className="supervision__observation">{tool ? <>{t("supervision.lastTool")} <code>{tool}</code></> : status === "failed" ? t(session.failureReason === "resume" ? "activity.resumeFailed" : "activity.spawnFailed") : t(`supervision.hint.${status}`)}</span>
        <span className="supervision__open" aria-hidden="true"><NavigationIcon kind="chevron" /></span>
      </button>{session.type !== "terminal" && <SubagentRoster conversationId={session.claudeSessionId} />}</div>)}
      {!shown.length && <div className="supervision__empty" role="status"><NavigationIcon kind={filter === "attention" && !query.trim() ? "attention" : "search"} /><strong>{t(query.trim() ? "activity.noMatches" : filter === "attention" ? "supervision.noAttention" : filter === "active" ? "supervision.noActive" : "activity.empty")}</strong><span>{t("supervision.emptyHint")}</span></div>}
    </div>
    <footer className="supervision__note"><span className="supervision__note-dot" aria-hidden="true" />{t("supervision.sourceNote")}</footer>
  </section>;
}
