import { useMemo, useState } from "react";
import { activityCategories, buildActivity } from "../../core/activity";
import { useStore } from "../../core/store";
import { useT } from "../../i18n/i18n";
import { observeSession } from "../../core/supervision";

export default function ActivityPanel({ archives = false }: { archives?: boolean }) {
  const t = useT();
  const projects = useStore((s) => s.projects);
  const states = useStore((s) => s.sessionStates);
  const subagents = useStore((s) => s.sessionSubagents);
  const open = useStore((s) => s.setActiveSession);
  const archive = useStore((s) => s.archiveSession);
  const restore = useStore((s) => s.restoreSession);
  const [pending, setPending] = useState<string | null>(null);
  const [archiveError, setArchiveError] = useState(false);
  const [query, setQuery] = useState("");
  const rows = useMemo(() => {
    const search = query.trim().toLocaleLowerCase();
    return buildActivity(projects, states, archives, subagents).filter(({ project, session }) =>
      !search || project.name.toLocaleLowerCase().includes(search) || session.name.toLocaleLowerCase().includes(search));
  }, [projects, states, archives, query, subagents]);
  return <section className="activity" aria-label={t(archives ? "activity.archives" : "activity.title")}>
    <input className="activity__search" type="search" aria-label={t("activity.search")} placeholder={t("activity.search")} value={query} onChange={(e) => setQuery(e.target.value)} />
    {rows.length === 0 && <p className="activity__empty" role="status">{t(query.trim() ? "activity.noMatches" : archives ? "activity.noArchives" : "activity.empty")}</p>}
    {activityCategories.map((category) => {
      const group = rows.filter((row) => row.category === category);
      if (!group.length) return null;
      return <section className={`activity__group activity__group--${category}`} key={category} aria-label={t("activity.groupCount", { count: group.length, name: t(`activity.${category}`) })}>
        <h3 className="activity__heading">{t(`activity.${category}`)} <span aria-hidden="true">{group.length}</span></h3>
        {group.map(({ project, session }) => {
          const state = observeSession(session, states, session.claudeSessionId ? subagents[session.claudeSessionId] : []);
          const blocked = state === "working" || state === "waiting";
          const timestamp = session.lastActivityAt;
          const date = timestamp !== undefined && Number.isFinite(timestamp) && timestamp >= 0 && timestamp <= Date.now() ? new Date(timestamp) : null;
          const validDate = date && Number.isFinite(date.getTime()) ? date : null;
          return <div className="activity__item" key={session.id}>
            <button className="activity__open" disabled={archives} onClick={() => open(session.id)}>
              <span className="activity__project">{project.name}</span>{" "}
              <span className="activity__name">{session.name}</span>{" "}
              <span className="activity__type">{t(session.type === "terminal" ? "activity.terminal" : "activity.agent")}</span>
              {session.runtimeStatus === "failed" && <span className="activity__status">{t(session.failureReason === "resume" ? "activity.resumeFailed" : "activity.spawnFailed")}</span>}
              {session.runtimeStatus === "exited" && <span className="activity__status">{t("activity.exited")}</span>}
              {validDate && <time className="activity__time" dateTime={validDate.toISOString()}>{validDate.toLocaleString()}</time>}
            </button>
            {archives ? <button className="activity__action" onClick={() => { restore(session.id); open(session.id); }} aria-label={t("activity.restore", { name: session.name })}>{t("activity.restore", { name: session.name })}</button>
              : <button className="activity__action" disabled={blocked} title={blocked ? t("activity.cannotArchive") : undefined} aria-label={t("activity.archive", { name: session.name })} onClick={() => { setPending(session.id); setArchiveError(false); }}>{t("activity.archive", { name: session.name })}</button>}
            {!archives && pending === session.id && <div className="activity__confirmation" role="group" aria-label={t("activity.archive", { name: session.name })}>
              <p>{t("activity.archiveConfirm", { name: session.name })}</p>
              <button className="activity__action" disabled={blocked} onClick={() => {
                if (archive(session.id, true)) { setPending(null); setArchiveError(false); }
                else setArchiveError(true);
              }}>{t("activity.confirmArchive")}</button>
              <button className="activity__action" onClick={() => { setPending(null); setArchiveError(false); }}>{t("common.cancel")}</button>
              {(blocked || archiveError) && <p role="alert">{t("activity.cannotArchive")}</p>}
            </div>}
          </div>;
        })}
      </section>;
    })}
  </section>;
}
