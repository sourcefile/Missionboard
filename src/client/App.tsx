import { useCallback, useEffect, useMemo, useState } from "react";
import type { BoardState, Task } from "../shared/game";
import { levelOf, levelProgress, skillXp, sortKey, timingState } from "../shared/game";
import { api } from "./api";
import { fmtDay, stateLabel, whenLabel } from "./format";
import { MissionForm } from "./MissionForm";

type Filter = "open" | "timed" | "extra" | "done";
const FILTERS: [Filter, string][] = [["open", "Active"], ["timed", "Timed"], ["extra", "Extra"], ["done", "Completed"]];
const isTimed = (t: Task) => t.kind !== "extra";

export function App() {
  const [state, setState] = useState<BoardState | null>(null);
  const [loadError, setLoadError] = useState("");
  const [filter, setFilter] = useState<Filter>(() => (localStorage.getItem("mb-filter") as Filter) || "open");
  const [editing, setEditing] = useState<Task | "new" | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [toast, setToast] = useState<{ text: string; tone: "ok" | "err" } | null>(null);
  const [pulse, setPulse] = useState(0);
  const [, tick] = useState(0);

  const refresh = useCallback(() => api.state().then((s) => { setState(s); setLoadError(""); }), []);

  useEffect(() => {
    refresh().catch(() => setLoadError("Can't reach the Mission Board server. Check that it's running, then reload."));
    const id = setInterval(() => tick((n) => n + 1), 60_000); // keep "live / overdue" labels fresh
    return () => clearInterval(id);
  }, [refresh]);

  useEffect(() => { localStorage.setItem("mb-filter", filter); }, [filter]);

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

  const xp = useMemo(() => skillXp(state?.tasks ?? []), [state]);
  const skillName = (id: number) => state?.skills.find((s) => s.id === id)?.name ?? "Removed skill";

  if (!state) {
    return (
      <div className="shell">
        <div className="boot">{loadError || "Booting Mission Board…"}</div>
      </div>
    );
  }

  const totalXp = [...xp.values()].reduce((a, b) => a + b, 0);
  const operator = levelProgress(totalXp);
  const open = state.tasks.filter((t) => !t.done);
  const weekAgo = Date.now() - 7 * 864e5;
  const doneWeek = state.tasks.filter((t) => t.done && t.doneAt && new Date(t.doneAt).getTime() > weekAgo).length;
  const overdue = open.filter((t) => timingState(t) === "overdue").length;

  const byTime = (a: Task, b: Task) => sortKey(a) - sortKey(b) || a.id - b.id;
  let list = state.tasks.filter((t) =>
    filter === "done" ? t.done : !t.done && (filter === "open" || (filter === "timed" ? isTimed(t) : !isTimed(t))),
  );
  list = filter === "done" ? list.sort((a, b) => (b.doneAt ?? "").localeCompare(a.doneAt ?? "")) : list.sort(byTime);

  const complete = async (t: Task) => {
    const before = new Map(xp);
    const ups = t.xp
      .filter((g) => levelOf((before.get(g.skillId) ?? 0) + g.amount) > levelOf(before.get(g.skillId) ?? 0))
      .map((g) => `${skillName(g.skillId)} → LV ${levelOf((before.get(g.skillId) ?? 0) + g.amount)}`);
    if (await run(() => api.complete(t.id), ups.length ? `Level up! ${ups.join(", ")}` : `Mission complete. +${t.credits} credits`)) setPulse((n) => n + 1);
  };

  const card = (t: Task) => {
    const ts = timingState(t);
    const asking = confirm === `t${t.id}`;
    return (
      <article key={t.id} className={`mission ${t.done ? "is-done" : ""} state-${ts}`}>
        <button
          className="check"
          aria-label={t.done ? `Reopen ${t.title}` : `Complete ${t.title}`}
          title={t.done ? "Reopen" : "Complete"}
          onClick={() => (t.done ? run(() => api.reopen(t.id), "Mission reopened") : complete(t))}
        >
          {t.done ? "✓" : ""}
        </button>
        <div className="m-body">
          <div className="m-title">{t.title}</div>
          <div className="m-meta">
            <span className={`tag ${isTimed(t) ? "tag-timed" : "tag-extra"}`}>{isTimed(t) ? "Timed" : "Extra"}</span>
            <span className="when">{whenLabel(t)}</span>
            {ts !== "none" && <span className={`status status-${ts}`}>{stateLabel[ts]}</span>}
          </div>
          {t.xp.length > 0 && (
            <div className="m-xp">
              {t.xp.map((g) => (
                <span key={g.skillId} className="xp-chip">+{g.amount} XP <b>{skillName(g.skillId)}</b></span>
              ))}
            </div>
          )}
        </div>
        <div className="m-side">
          <div className="m-credits"><span className="cr">CR</span>+{t.credits}</div>
          <div className="m-actions">
            {asking ? (
              <>
                <button className="btn-danger" onClick={() => { setConfirm(null); run(() => api.deleteTask(t.id), "Mission deleted"); }}>Delete</button>
                <button className="btn-ghost" onClick={() => setConfirm(null)}>Keep</button>
              </>
            ) : (
              <>
                {!t.done && <button className="btn-ghost" onClick={() => setEditing(t)}>Edit</button>}
                <button className="btn-ghost" onClick={() => setConfirm(`t${t.id}`)}>Delete</button>
              </>
            )}
          </div>
        </div>
      </article>
    );
  };

  const timedOpen = list.filter(isTimed);
  const extraOpen = list.filter((t) => !isTimed(t));

  const log = [
    ...state.tasks.filter((t) => t.done && t.doneAt).map((t) => ({ key: `t${t.id}`, at: t.doneAt!, text: t.title, amt: t.credits })),
    ...state.spends.map((s) => ({ key: `s${s.id}`, at: s.at, text: s.rewardName, amt: -s.cost })),
  ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 30);

  return (
    <div className="shell">
      <header className="hud">
        <div className="brand">
          <div className="brand-kicker">// personal ops terminal</div>
          <h1 className="glitch" data-text="MISSION BOARD">MISSION BOARD</h1>
        </div>
        <div className="hud-stats">
          <div key={pulse} className={`hud-stat hud-credits ${pulse ? "pulse" : ""}`}>
            <span className="hud-label">Credits</span>
            <span className="hud-value">{state.balance}</span>
          </div>
          <div className="hud-stat">
            <span className="hud-label">Operator LV</span>
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
            <h2 id="missions-h">Missions</h2>
            <div className="head-actions">
              <div className="tabs" role="tablist">
                {FILTERS.map(([f, label]) => (
                  <button key={f} role="tab" aria-selected={filter === f} onClick={() => setFilter(f)}>{label}</button>
                ))}
              </div>
              <button className="btn-primary" onClick={() => setEditing("new")}>+ New mission</button>
            </div>
          </div>

          {editing && (
            <MissionForm
              task={editing === "new" ? null : editing}
              skills={state.skills}
              onCancel={() => setEditing(null)}
              onSave={async (input) => {
                const ok = await run(
                  () => (editing === "new" ? api.addTask(input) : api.updateTask(editing.id, input)),
                  editing === "new" ? "Mission added" : "Mission updated",
                );
                if (ok) setEditing(null);
              }}
            />
          )}

          <div className="missions">
            {list.length === 0 ? (
              <div className="empty">
                <strong>{filter === "done" ? "No completed missions yet" : "No active missions here"}</strong>
                {filter === "done"
                  ? "Hit the square next to a mission when you finish it to collect its credits and XP."
                  : "Add one with New mission. Timed missions have a duration or a start and end time; extra missions have no deadline."}
              </div>
            ) : filter === "open" ? (
              <>
                {timedOpen.length > 0 && <div className="group">Timed <span>{timedOpen.length}</span></div>}
                {timedOpen.map(card)}
                {extraOpen.length > 0 && <div className="group">Extra <span>{extraOpen.length}</span></div>}
                {extraOpen.map(card)}
              </>
            ) : (
              list.map(card)
            )}
          </div>
        </section>

        <aside className="side">
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
                        <span className="skill-lv">LV{p.level}</span>
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

          <section className="panel" aria-labelledby="shop-h">
            <div className="panel-head"><h2 id="shop-h">Leisure shop</h2><span className="hint">Balance {state.balance} CR</span></div>
            <div className="shop">
              {state.rewards.length === 0 && <div className="empty"><strong>Nothing in the shop</strong>Add a leisure activity and its price.</div>}
              {state.rewards.map((r) => {
                const short = r.cost - state.balance;
                const asking = confirm === `r${r.id}`;
                return (
                  <div key={r.id} className="shop-item">
                    <span className="shop-name">{r.name}</span>
                    <span className="shop-cost">{r.cost} CR</span>
                    {asking ? (
                      <>
                        <button className="btn-danger btn-xs" onClick={() => { setConfirm(null); run(() => api.deleteReward(r.id), "Activity removed"); }}>Remove</button>
                        <button className="btn-ghost btn-xs" onClick={() => setConfirm(null)}>Keep</button>
                      </>
                    ) : (
                      <>
                        <button className="btn-buy btn-xs" disabled={short > 0} title={short > 0 ? `Need ${short} more credits` : undefined} onClick={() => run(() => api.redeem(r.id), `Enjoy: ${r.name}`)}>
                          {short > 0 ? `−${short}` : "Redeem"}
                        </button>
                        <button className="btn-ghost btn-xs" aria-label={`Remove ${r.name}`} onClick={() => setConfirm(`r${r.id}`)}>×</button>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
            <InlineAdd placeholder="Activity, e.g. 1 hour gaming" withCost onAdd={(name, cost) => run(() => api.addReward(name, cost ?? 0), "Activity added")} />
          </section>

          <section className="panel" aria-labelledby="log-h">
            <div className="panel-head"><h2 id="log-h">Credit log</h2></div>
            <div className="log">
              {log.length === 0 && <span className="hint">Earned and spent credits show up here.</span>}
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

function InlineAdd({ placeholder, withCost, onAdd }: { placeholder: string; withCost?: boolean; onAdd: (name: string, cost?: number) => Promise<boolean> }) {
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
      {withCost && <input className="cost" type="number" min={1} value={cost} onChange={(e) => setCost(e.target.value)} placeholder="CR" aria-label="Cost in credits" />}
      <button type="submit" className="btn-ghost">Add</button>
    </form>
  );
}
