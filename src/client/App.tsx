import { useCallback, useEffect, useMemo, useState } from "react";
import type { BoardState, Subtask, Task, XpGrant } from "../shared/game";
import { isOperation, isRecurring, levelOf, levelProgress, operationProgress, sortKey, taskSkillIds, timingState } from "../shared/game";
import { api } from "./api";
import { fmtDay, resetLabel, stateLabel, whenLabel } from "./format";
import { MissionForm } from "./MissionForm";
import { SKINS, applySkin, loadSkin, type SkinName } from "./skin";
import { progressFrom, rankStatus } from "../shared/ranks";
import { RanksPanel, rankName } from "./Ranks";
import { ShopPanel } from "./Shop";

type Filter = "open" | "routine" | "timed" | "operation" | "extra" | "done";
/** Tab labels; null = use the look's name for operations / raids. */
const FILTERS: [Filter, string | null][] = [["open", "Active"], ["routine", "Daily & weekly"], ["timed", "Timed"], ["operation", null], ["extra", "Extra"], ["done", "Completed"]];
const isTimed = (t: Task) => t.kind === "duration" || t.kind === "window";
const GROUPS: [string | null, (t: Task) => boolean][] = [
  ["Daily", (t) => t.kind === "daily"],
  ["Weekly", (t) => t.kind === "weekly"],
  ["Timed", isTimed],
  [null, (t) => t.kind === "operation"],
  ["Extra", (t) => t.kind === "extra"],
];
const TAG: Record<Task["kind"], [string | null, string]> = {
  duration: ["Timed", "tag-timed"],
  window: ["Timed", "tag-timed"],
  extra: ["Extra", "tag-extra"],
  daily: ["Daily", "tag-daily"],
  weekly: ["Weekly", "tag-weekly"],
  operation: [null, "tag-operation"],
};
const readFilter = (): Filter => {
  try {
    const f = localStorage.getItem("mb-filter");
    if (FILTERS.some(([k]) => k === f)) return f as Filter;
  } catch { /* storage blocked */ }
  return "open";
};

export function App() {
  const [state, setState] = useState<BoardState | null>(null);
  const [loadError, setLoadError] = useState("");
  const [filter, setFilter] = useState<Filter>(readFilter);
  const [query, setQuery] = useState("");
  const [skillFilter, setSkillFilter] = useState<number[]>([]);
  const [skinName, setSkinName] = useState<SkinName>(loadSkin);
  const t = SKINS[skinName];
  const [editing, setEditing] = useState<Task | "new" | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [toast, setToast] = useState<{ text: string; tone: "ok" | "err" } | null>(null);
  const [pulse, setPulse] = useState(0);
  const [, tick] = useState(0);

  const refresh = useCallback(() => api.state().then((s) => { setState(s); setLoadError(""); }), []);

  useEffect(() => {
    refresh().catch(() => setLoadError("Can't reach the Mission Board server. Check that it's running, then reload."));
    // Re-read every minute: keeps "live / overdue" labels fresh and picks up daily/weekly refreshes.
    const id = setInterval(() => { tick((n) => n + 1); refresh().catch(() => {}); }, 60_000);
    const onFocus = () => { refresh().catch(() => {}); };
    window.addEventListener("focus", onFocus);
    return () => { clearInterval(id); window.removeEventListener("focus", onFocus); };
  }, [refresh]);

  useEffect(() => { try { localStorage.setItem("mb-filter", filter); } catch { /* storage blocked */ } }, [filter]);
  useEffect(() => { applySkin(skinName); }, [skinName]);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 2800);
    return () => clearTimeout(id);
  }, [toast]);

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    try {
      const out = await fn();
      if (out && typeof out === "object" && "balance" in out) setState(out as BoardState);
      else await refresh();
      if (ok) setToast({ text: ok, tone: "ok" });
      return true;
    } catch (e) {
      setToast({ text: (e as Error).message, tone: "err" });
      return false;
    }
  };

  const xp = useMemo(() => new Map(Object.entries(state?.skillXp ?? {}).map(([k, v]) => [Number(k), v])), [state]);
  const skillName = (id: number) => state?.skills.find((s) => s.id === id)?.name ?? "Removed skill";

  if (!state) {
    return (
      <div className="shell">
        <div className="boot">{loadError || t.boot}</div>
      </div>
    );
  }

  const totalXp = [...xp.values()].reduce((a, b) => a + b, 0);
  const operator = levelProgress(totalXp);
  const ladder = [...state.ranks].sort((a, b) => a.position - b.position);
  const progress = progressFrom(xp, state.skills.map((s) => s.id));
  const rank = rankStatus(ladder, progress);
  const currentRank = ladder[rank.current];
  const open = state.tasks.filter((t) => !t.done);
  const weekAgo = Date.now() - 7 * 864e5;
  const doneWeek = state.completions.filter((c) => new Date(c.at).getTime() > weekAgo).length;
  const overdue = open.filter((t) => timingState(t) === "overdue").length;

  const byTime = (a: Task, b: Task) => sortKey(a) - sortKey(b) || a.id - b.id;
  let list = state.tasks.filter((m) =>
    filter === "done"
      ? m.done
      : !m.done &&
        (filter === "open" ||
          (filter === "routine" && isRecurring(m.kind)) ||
          (filter === "timed" && isTimed(m)) ||
          (filter === "operation" && isOperation(m.kind)) ||
          (filter === "extra" && m.kind === "extra")),
  );
  // Search and skill filter narrow whichever tab is open.
  const picked = skillFilter.filter((id) => state.skills.some((s) => s.id === id));
  const needle = query.trim().toLowerCase();
  const narrowing = needle !== "" || picked.length > 0;
  const tabCount = list.length;
  if (needle) list = list.filter((m) => m.title.toLowerCase().includes(needle) || m.subtasks.some((s) => s.title.toLowerCase().includes(needle)));
  if (picked.length) list = list.filter((m) => taskSkillIds(m).some((id) => picked.includes(id)));
  const clearFinder = () => { setQuery(""); setSkillFilter([]); };
  const toggleSkill = (id: number) => setSkillFilter((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  list = filter === "done" ? list.sort((a, b) => (b.doneAt ?? "").localeCompare(a.doneAt ?? "")) : list.sort(byTime);

  /** Pays something out and celebrates: rank-up beats level-up beats the plain message. */
  const payout = async (call: () => Promise<BoardState>, message: (next: BoardState) => string) => {
    const before = new Map(xp);
    try {
      const next = await call();
      setState(next);
      const nextXp = new Map(Object.entries(next.skillXp).map(([k, v]) => [Number(k), v]));
      const ups = [...nextXp]
        .filter(([id, amount]) => levelOf(amount) > levelOf(before.get(id) ?? 0))
        .map(([id, amount]) => `${skillName(id)} → ${t.lv} ${levelOf(amount)}`);
      const nextRanks = [...next.ranks].sort((a, b) => a.position - b.position);
      const after = rankStatus(nextRanks, progressFrom(next.skillXp, next.skills.map((s) => s.id))).current;
      const promoted = after > rank.current && nextRanks[after];
      setToast({
        text: promoted ? `${t.rankUp} ${rankName(promoted, skinName)}` : ups.length ? `${t.levelUp} ${ups.join(", ")}` : message(next),
        tone: "ok",
      });
      setPulse((n) => n + 1);
    } catch (e) {
      setToast({ text: (e as Error).message, tone: "err" });
    }
  };
  const complete = (m: Task) => payout(() => api.complete(m.id), () => t.completed(m.credits));
  const completeSubtask = (m: Task, s: Subtask) =>
    payout(
      () => api.completeSubtask(m.id, s.id),
      (next) => (next.tasks.find((x) => x.id === m.id)?.done ? t.operationDone(m.credits) : t.subtaskDone(s.credits)),
    );
  const xpChips = (grants: XpGrant[]) =>
    grants.map((g) => <span key={g.skillId} className="xp-chip">+{g.amount} XP <b>{skillName(g.skillId)}</b></span>);

  const card = (m: Task) => {
    const ts = timingState(m);
    const asking = confirm === `t${m.id}`;
    const [tagLabel, tagClass] = TAG[m.kind];
    const tagText = tagLabel ?? t.operation;
    const recurring = isRecurring(m.kind);
    const op = isOperation(m.kind);
    const prog = operationProgress(m);
    return (
      <article key={m.id} className={`mission ${m.done ? "is-done" : ""} state-${ts} ${recurring ? "is-recurring" : ""} ${op ? "is-operation" : ""}`}>
        {op && !m.done ? (
          <span className="check op-progress" role="img" aria-label={`${prog.done} of ${prog.total} subtasks done`} title="Finish every subtask to complete it">
            {prog.done}/{prog.total}
          </span>
        ) : (
          <button
            className="check"
            aria-label={m.done ? `Reopen ${m.title}` : `Complete ${m.title}`}
            title={m.done ? (op ? "Reopen, taking back every subtask payout and the bonus" : "Reopen") : "Complete"}
            onClick={() => (m.done ? run(() => api.reopen(m.id), `${op ? t.operation : `${t.mission[0]!.toUpperCase()}${t.mission.slice(1)}`} reopened`) : complete(m))}
          >
            {m.done ? "✓" : ""}
          </button>
        )}
        <div className="m-body">
          <div className="m-title">{m.title}</div>
          <div className="m-meta">
            <span className={`tag ${tagClass}`}>{tagText}</span>
            <span className="when">{whenLabel(m)}</span>
            {ts !== "none" && <span className={`status status-${ts}`}>{stateLabel[ts]}</span>}
            {recurring && m.done && <span className="status status-reset">{resetLabel(m, state.weekStart)}</span>}
            {m.streak > 1 && <span className="streak" title={`${m.streak} ${m.kind === "daily" ? "days" : "weeks"} in a row`}>Streak {m.streak}</span>}
          </div>
          {op && (
            <ol className="subtasks" aria-label={`${m.title} subtasks`}>
              {m.subtasks.map((s) => (
                <li key={s.id} className={`subtask ${s.done ? "is-done" : ""}`}>
                  <button
                    className="sub-check"
                    aria-label={s.done ? `Reopen ${s.title}` : `Complete ${s.title}`}
                    title={s.done ? "Reopen" : "Complete"}
                    onClick={() => (s.done ? run(() => api.reopenSubtask(m.id, s.id), "Subtask reopened") : completeSubtask(m, s))}
                  >
                    {s.done ? "✓" : ""}
                  </button>
                  <span className="sub-title">{s.title}</span>
                  <span className="sub-rewards">
                    {xpChips(s.xp)}
                    <span className="sub-credits"><span className="cr">{t.currency}</span>+{s.credits}</span>
                  </span>
                </li>
              ))}
            </ol>
          )}
          {m.xp.length > 0 && (
            <div className="m-xp">
              {op && <span className="bonus-label">Bonus</span>}
              {xpChips(m.xp)}
            </div>
          )}
        </div>
        <div className="m-side">
          <div className="m-credits" title={op ? `Bonus when every subtask is done` : undefined}>
            <span className="cr">{op ? `bonus ${t.currency}` : t.currency}</span>+{m.credits}
          </div>
          <div className="m-actions">
            {asking ? (
              <>
                <button className="btn-danger" onClick={() => { setConfirm(null); run(() => api.deleteTask(m.id), "Deleted. Earned rewards stay in your log."); }}>Delete</button>
                <button className="btn-ghost" onClick={() => setConfirm(null)}>Keep</button>
              </>
            ) : (
              <>
                {(!m.done || recurring) && <button className="btn-ghost" onClick={() => setEditing(m)}>Edit</button>}
                <button className="btn-ghost" onClick={() => setConfirm(`t${m.id}`)}>Delete</button>
              </>
            )}
          </div>
        </div>
      </article>
    );
  };

  const log = [
    ...state.completions.map((c) => ({ key: `c${c.id}`, at: c.at, text: c.title, amt: c.credits })),
    ...state.spends.map((s) => ({ key: `s${s.id}`, at: s.at, text: s.rewardName, amt: -s.cost })),
  ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 30);

  return (
    <div className="shell">
      <header className="hud">
        <div className="brand">
          <div className="brand-kicker">{t.kicker}</div>
          <h1 className="glitch" data-text={t.title}>{t.title}</h1>
          <div className="skin-switch" role="radiogroup" aria-label="Look and feel">
            {(Object.keys(SKINS) as SkinName[]).map((k) => (
              <button key={k} role="radio" aria-checked={skinName === k} onClick={() => setSkinName(k)}>{SKINS[k].label}</button>
            ))}
          </div>
        </div>
        <div className="hud-stats">
          <div className="hud-stat hud-rank">
            <span className="hud-label">Rank{rank.next !== null ? ` · next: ${rankName(ladder[rank.next]!, skinName)}` : ""}</span>
            <span className="hud-value hud-rank-name">{currentRank ? rankName(currentRank, skinName) : "Unranked"}</span>
          </div>
          <div key={pulse} className={`hud-stat hud-credits ${pulse ? "pulse" : ""}`}>
            <span className="hud-label">{t.currencyName}</span>
            <span className="hud-value">{state.balance}<small className="unit"> {t.currency}</small></span>
          </div>
          <div className="hud-stat">
            <span className="hud-label">{t.level}</span>
            <span className="hud-value">{operator.level}</span>
            <span className="hud-bar"><i style={{ width: `${operator.pct}%` }} /></span>
          </div>
          <div className="hud-stat">
            <span className="hud-label">Active</span>
            <span className="hud-value">{open.length}{overdue > 0 && <small className="warn"> {overdue} late</small>}</span>
          </div>
          <div className="hud-stat">
            <span className="hud-label">Done · 7d</span>
            <span className="hud-value">{doneWeek}</span>
          </div>
        </div>
      </header>

      <main className="grid">
        <section className="panel panel-missions" aria-labelledby="missions-h">
          <div className="panel-head">
            <h2 id="missions-h">{t.missions}</h2>
            <div className="head-actions">
              <div className="tabs" role="tablist">
                {FILTERS.map(([f, label]) => (
                  <button key={f} role="tab" aria-selected={filter === f} onClick={() => setFilter(f)}>{label ?? t.operations}</button>
                ))}
              </div>
              <button className="btn-primary" onClick={() => setEditing("new")}>{t.newMission}</button>
            </div>
          </div>

          <div className="finder" role="search" aria-label={`Find ${t.mission}s`}>
            <div className="finder-search">
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Escape") setQuery(""); }}
                placeholder={`Search ${t.mission}s by title`}
                aria-label={`Search ${t.mission}s by title`}
                maxLength={80}
              />
            </div>
            {state.skills.length > 0 && (
              <div className="finder-skills" role="group" aria-label="Filter by skill">
                <span className="label">Skill</span>
                {[...state.skills].sort((a, b) => a.name.localeCompare(b.name)).map((s) => (
                  <button key={s.id} type="button" className="skill-chip" aria-pressed={picked.includes(s.id)} onClick={() => toggleSkill(s.id)}>{s.name}</button>
                ))}
              </div>
            )}
            {narrowing && (
              <div className="finder-status" aria-live="polite">
                <span>Showing {list.length} of {tabCount}</span>
                <button type="button" className="link" onClick={clearFinder}>Clear filters</button>
              </div>
            )}
          </div>

          {editing && (
            <MissionForm
              task={editing === "new" ? null : editing}
              noun={t.mission}
              operationName={t.operation}
              currency={t.currency}
              skills={state.skills}
              onCancel={() => setEditing(null)}
              onSave={async (input) => {
                const ok = await run(
                  () => (editing === "new" ? api.addTask(input) : api.updateTask(editing.id, input)),
                  editing === "new" ? `${t.mission[0]!.toUpperCase()}${t.mission.slice(1)} added` : "Changes saved",
                );
                if (ok) setEditing(null);
              }}
            />
          )}

          <div className="missions">
            {list.length === 0 && narrowing && tabCount > 0 ? (
              <div className="empty">
                <strong>No {t.mission}s match</strong>
                {needle && <>Nothing in this tab has “{query.trim()}” in its title{picked.length ? " and" : "."} </>}
                {picked.length > 0 && <>{needle ? "gives" : "Nothing in this tab gives"} XP to {picked.map(skillName).join(" or ")}. </>}
                <button type="button" className="link" onClick={clearFinder}>Clear filters</button>
              </div>
            ) : list.length === 0 ? (
              <div className="empty">
                <strong>{filter === "done" ? `No completed ${t.mission}s yet` : `No active ${t.mission}s here`}</strong>
                {filter === "done"
                  ? `Hit the square next to a ${t.mission} when you finish it to collect its ${t.currencyName.toLowerCase()} and XP.`
                  : `Add one with “${t.newMission.replace("+ ", "")}”. Timed ones have a duration or a start and end time, daily and weekly ones come back every day or week, ${t.operations.toLowerCase()} are split into subtasks with a bonus at the end, and extra ones have no deadline.`}
              </div>
            ) : filter === "open" || filter === "routine" ? (
              GROUPS.map(([groupLabel, match]) => {
                const rows = list.filter(match);
                const label = groupLabel ?? t.operations;
                return rows.length === 0 ? null : (
                  <div key={label} className="group-block">
                    <div className="group">{label} <span>{rows.length}</span></div>
                    {rows.map(card)}
                  </div>
                );
              })
            ) : (
              list.map(card)
            )}
          </div>
        </section>

        <aside className="side">
          <RanksPanel
            ranks={ladder}
            current={rank.current}
            progress={progress}
            skills={state.skills}
            skin={skinName}
            onSave={(r) => run(() => api.saveRanks(r), "Ranks saved")}
          />

          <section className="panel" aria-labelledby="skills-h">
            <div className="panel-head"><h2 id="skills-h">Skills</h2></div>
            <div className="skills">
              {state.skills.length === 0 && <div className="empty"><strong>No skills yet</strong>Add one below, then attach XP to missions.</div>}
              {[...state.skills]
                .sort((a, b) => (xp.get(b.id) ?? 0) - (xp.get(a.id) ?? 0) || a.name.localeCompare(b.name))
                .map((s) => {
                  const p = levelProgress(xp.get(s.id) ?? 0);
                  const asking = confirm === `s${s.id}`;
                  return (
                    <div key={s.id} className="skill">
                      <div className="skill-top">
                        <span className="skill-lv">{t.lv}{p.level}</span>
                        <span className="skill-name">{s.name}</span>
                        <span className="skill-xp">{p.xp}/{p.next}</span>
                        {asking ? (
                          <>
                            <button className="btn-danger btn-xs" onClick={() => { setConfirm(null); run(() => api.deleteSkill(s.id), "Skill removed"); }}>Remove</button>
                            <button className="btn-ghost btn-xs" onClick={() => setConfirm(null)}>Keep</button>
                          </>
                        ) : (
                          <button className="btn-ghost btn-xs" aria-label={`Remove ${s.name}`} onClick={() => setConfirm(`s${s.id}`)}>×</button>
                        )}
                      </div>
                      <div className="bar" role="progressbar" aria-label={`${s.name} progress to level ${p.level + 1}`} aria-valuenow={p.pct} aria-valuemin={0} aria-valuemax={100}>
                        <i style={{ width: `${p.pct}%` }} />
                      </div>
                    </div>
                  );
                })}
            </div>
            <InlineAdd placeholder="New skill" onAdd={(name) => run(() => api.addSkill(name), "Skill added")} />
          </section>

          <ShopPanel
            rewards={state.rewards}
            ranks={ladder}
            currentRank={rank.current}
            balance={state.balance}
            skin={t}
            onAdd={(r) => run(() => api.addReward(r), "Activity added")}
            onUpdate={(id, r) => run(() => api.updateReward(id, r), "Activity updated")}
            onRemove={(id) => run(() => api.deleteReward(id), "Activity removed")}
            onRedeem={(r) => run(() => api.redeem(r.id), `Enjoy: ${r.name}`)}
          />

          <section className="panel" aria-labelledby="log-h">
            <div className="panel-head"><h2 id="log-h">{t.log}</h2></div>
            <div className="log">
              {log.length === 0 && <span className="hint">Earned and spent {t.currencyName.toLowerCase()} show up here.</span>}
              {log.map((e) => (
                <div key={e.key} className="log-row">
                  <span className="log-text">{e.text}<span className="hint"> · {fmtDay(new Date(e.at))}</span></span>
                  <span className={e.amt >= 0 ? "plus" : "minus"}>{e.amt >= 0 ? "+" : ""}{e.amt}</span>
                </div>
              ))}
            </div>
          </section>
        </aside>
      </main>

      {toast && <div className={`toast toast-${toast.tone}`} role="status">{toast.text}</div>}
    </div>
  );
}

function InlineAdd({ placeholder, withCost, costLabel, onAdd }: { placeholder: string; withCost?: boolean; costLabel?: string; onAdd: (name: string, cost?: number) => Promise<boolean> }) {
  const [name, setName] = useState("");
  const [cost, setCost] = useState("");
  return (
    <form
      className="inline-add"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!name.trim()) return;
        if (await onAdd(name.trim(), withCost ? Number(cost) : undefined)) { setName(""); setCost(""); }
      }}
    >
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder={placeholder} aria-label={placeholder} maxLength={60} />
      {withCost && <input className="cost" type="number" min={1} value={cost} onChange={(e) => setCost(e.target.value)} placeholder={costLabel} aria-label="Cost" />}
      <button type="submit" className="btn-ghost">Add</button>
    </form>
  );
}
