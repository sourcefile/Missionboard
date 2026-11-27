import { useMemo, useState, type FormEvent } from "react";
import type { Skill, SubtaskInput, Task, TaskInput, TaskKind, XpGrant } from "../shared/game";
import { MAX_SKILLS_PER_TASK, MAX_SUBTASKS, minutesBetween, suggestBonus, suggestCredits } from "../shared/game";
import { toLocalInput } from "./format";

interface Props {
  task: Task | null;
  noun: string;
  /** "Operation" or "Raid", depending on the look. */
  operationName: string;
  currency: string;
  skills: Skill[];
  onSave: (t: TaskInput) => Promise<void>;
  onCancel: () => void;
}

const KINDS: [TaskKind, string | null, string][] = [
  ["duration", "Timed · duration", "Takes a set amount of time"],
  ["window", "Timed · start/end", "Happens at a fixed time"],
  ["daily", "Daily", "Comes back every day"],
  ["weekly", "Weekly", "Comes back every week"],
  ["operation", null, "Subtasks, plus a bonus for all"],
  ["extra", "Extra", "No hard deadline"],
];

interface SubRow {
  id?: number;
  title: string;
  credits: string;
  skillId: string;
  amount: string;
  /** XP grants beyond the first, kept as they are (the form edits one skill per subtask). */
  moreXp: XpGrant[];
}
const blankSub = (): SubRow => ({ title: "", credits: "10", skillId: "", amount: "10", moreXp: [] });

export function MissionForm({ task, noun, operationName, currency, skills, onSave, onCancel }: Props) {
  const nextHour = useMemo(() => { const d = new Date(); d.setMinutes(0, 0, 0); d.setHours(d.getHours() + 1); return d; }, []);
  const [title, setTitle] = useState(task?.title ?? "");
  const [kind, setKind] = useState<TaskKind>(task?.kind ?? "duration");
  const [duration, setDuration] = useState(task ? (task.durationMin == null ? "" : String(task.durationMin)) : "30");
  const [day, setDay] = useState(task?.day ?? "");
  const [start, setStart] = useState(task?.start ? toLocalInput(new Date(task.start)) : toLocalInput(nextHour));
  const [end, setEnd] = useState(task?.end ? toLocalInput(new Date(task.end)) : toLocalInput(new Date(nextHour.getTime() + 3600e3)));
  const [credits, setCredits] = useState<string | null>(task ? String(task.credits) : null); // null = follow suggestion
  const [xp, setXp] = useState(() => {
    const rows = (task?.xp ?? []).map((g) => ({ skillId: String(g.skillId), amount: String(g.amount) }));
    while (rows.length < MAX_SKILLS_PER_TASK) rows.push({ skillId: "", amount: "10" });
    return rows;
  });
  const [subs, setSubs] = useState<SubRow[]>(() =>
    task?.subtasks.length
      ? task.subtasks.map((s) => ({
          id: s.id,
          title: s.title,
          credits: String(s.credits),
          skillId: s.xp[0] ? String(s.xp[0].skillId) : "",
          amount: s.xp[0] ? String(s.xp[0].amount) : "10",
          moreXp: s.xp.slice(1),
        }))
      : [blankSub(), blankSub()],
  );
  const setSub = (i: number, patch: Partial<SubRow>) => setSubs(subs.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const minutes = kind === "duration" || kind === "daily" || kind === "weekly" ? Number(duration) || 0 : kind === "window" ? Math.max(0, minutesBetween(start, end) || 0) : 0;
  const op = kind === "operation";
  const suggested = op ? suggestBonus(subs.map((r) => Number(r.credits))) : suggestCredits(kind, minutes);
  const creditValue = credits ?? String(suggested);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    const input: TaskInput = {
      title,
      kind,
      credits: Math.round(Number(creditValue)),
      durationMin: kind === "duration" || ((kind === "daily" || kind === "weekly") && duration.trim() !== "") ? Math.round(Number(duration)) : null,
      day: kind === "duration" && day ? day : null,
      start: kind === "window" ? new Date(start).toISOString() : null,
      end: kind === "window" ? new Date(end).toISOString() : null,
      xp: xp.filter((r) => r.skillId && Number(r.amount) > 0).map((r) => ({ skillId: Number(r.skillId), amount: Math.round(Number(r.amount)) })),
      subtasks: op
        ? subs
            .filter((r) => r.title.trim() !== "")
            .map((r): SubtaskInput => ({
              ...(r.id !== undefined ? { id: r.id } : {}),
              title: r.title.trim(),
              credits: Math.round(Number(r.credits) || 0),
              xp: [
                ...(r.skillId && Number(r.amount) > 0 ? [{ skillId: Number(r.skillId), amount: Math.round(Number(r.amount)) }] : []),
                ...r.moreXp.filter((g) => String(g.skillId) !== r.skillId),
              ],
            }))
        : [],
    };
    if (op && input.subtasks!.length === 0) return setError("Add at least one subtask.");
    if (kind === "window" && (isNaN(new Date(start).getTime()) || isNaN(new Date(end).getTime()))) return setError("Pick both a start and an end time.");
    const ids = input.xp.map((g) => g.skillId);
    if (new Set(ids).size !== ids.length) return setError("Each skill can only appear once per mission.");
    setBusy(true);
    try { await onSave(input); } finally { setBusy(false); }
  };

  return (
    <form className="mform" onSubmit={submit}>
      <div className="mform-title">{task ? `Edit ${noun}` : `New ${noun}`}</div>

      <label className="field">
        <span className="label">{noun}</span>
        <input id="m-title" autoFocus required maxLength={140} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Finish quarterly report" />
      </label>

      <fieldset className="kinds">
        <legend className="label">Type</legend>
        {KINDS.map(([k, label, sub]) => (
          <label key={k} className={`kind ${kind === k ? "on" : ""}`}>
            <input type="radio" name="kind" value={k} checked={kind === k} onChange={() => setKind(k)} />
            <span className="kind-label">{label ?? operationName}</span>
            <span className="kind-sub">{sub}</span>
          </label>
        ))}
      </fieldset>

      {kind === "duration" && (
        <div className="row">
          <label className="field"><span className="label">Duration (minutes)</span>
            <input id="m-duration" type="number" min={1} required value={duration} onChange={(e) => setDuration(e.target.value)} />
          </label>
          <label className="field"><span className="label">Planned day (optional)</span>
            <input id="m-day" type="date" value={day} onChange={(e) => setDay(e.target.value)} />
          </label>
        </div>
      )}
      {(kind === "daily" || kind === "weekly") && (
        <div className="row">
          <label className="field"><span className="label">Duration in minutes (optional)</span>
            <input id="m-duration" type="number" min={1} value={duration} onChange={(e) => setDuration(e.target.value)} placeholder="No set time" />
          </label>
          <p className="hint field-hint">
            {kind === "daily" ? "Refreshes at midnight once you've completed it." : "Refreshes on the first day of the week once you've completed it."}
          </p>
        </div>
      )}
      {kind === "window" && (
        <div className="row">
          <label className="field"><span className="label">Start</span>
            <input id="m-start" type="datetime-local" required value={start} onChange={(e) => setStart(e.target.value)} />
          </label>
          <label className="field"><span className="label">End</span>
            <input id="m-end" type="datetime-local" required value={end} onChange={(e) => setEnd(e.target.value)} />
          </label>
        </div>
      )}

      {op && (
        <fieldset className="sub-set">
          <legend className="label">Subtasks · each pays out when you tick it off</legend>
          <div className="sub-row sub-head" aria-hidden="true"><span>Subtask</span><span>{currency}</span><span>Skill</span><span>XP</span><span /></div>
          {subs.map((r, i) => (
            <div key={r.id ?? `new-${i}`} className="sub-row">
              <input aria-label={`Subtask ${i + 1}`} maxLength={140} value={r.title} onChange={(e) => setSub(i, { title: e.target.value })} placeholder={`Subtask ${i + 1}`} />
              <input aria-label={`${currency} for subtask ${i + 1}`} className="sub-num" type="number" min={0} value={r.credits} onChange={(e) => setSub(i, { credits: e.target.value })} title={currency} />
              <select aria-label={`Skill for subtask ${i + 1}`} value={r.skillId} onChange={(e) => setSub(i, { skillId: e.target.value })}>
                <option value="">No skill</option>
                {skills.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <input aria-label={`XP for subtask ${i + 1}`} className="sub-num" type="number" min={1} value={r.amount} disabled={!r.skillId} onChange={(e) => setSub(i, { amount: e.target.value })} title="XP" />
              <button type="button" className="btn-ghost btn-xs" aria-label={`Remove subtask ${i + 1}`} disabled={subs.length <= 1} onClick={() => setSubs(subs.filter((_, j) => j !== i))}>×</button>
            </div>
          ))}
          {subs.length < MAX_SUBTASKS && (
            <button type="button" className="link" onClick={() => setSubs([...subs, blankSub()])}>+ Add subtask</button>
          )}
        </fieldset>
      )}

      <div className="row">
        <label className="field"><span className="label">{op ? `Completion bonus (${currency})` : `Reward (${currency})`}</span>
          <input id="m-credits" type="number" min={0} required value={creditValue} onChange={(e) => setCredits(e.target.value)} />
        </label>
        <p className="hint field-hint">
          Suggested: {suggested} {currency}{op ? " (a quarter of the subtasks' total)" : minutes > 0 ? " (1 per 2 minutes)" : ""}.
          {credits !== null && Number(credits) !== suggested && (
            <> <button type="button" className="link" onClick={() => setCredits(null)}>Use suggestion</button></>
          )}
        </p>
      </div>

      <fieldset className="xp-set">
        <legend className="label">{op ? "Bonus skill XP" : "Skill XP"} · up to {MAX_SKILLS_PER_TASK}</legend>
        {xp.map((r, i) => (
          <div key={i} className="xp-row">
            <select aria-label={`Skill ${i + 1}`} value={r.skillId} onChange={(e) => setXp(xp.map((x, j) => (j === i ? { ...x, skillId: e.target.value } : x)))}>
              <option value="">No skill</option>
              {skills.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <input aria-label={`XP for skill ${i + 1}`} type="number" min={1} value={r.amount} onChange={(e) => setXp(xp.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} />
          </div>
        ))}
      </fieldset>

      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="mform-actions">
        <button type="button" className="btn-ghost" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn-primary" disabled={busy}>{task ? "Save changes" : `Add ${noun}`}</button>
      </div>
    </form>
  );
}
