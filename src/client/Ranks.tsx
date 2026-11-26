import { useState } from "react";
import type { Skill } from "../shared/game";
import { MAX_RANKS, requirementsOf, type Progress, type Rank, type RankInput } from "../shared/ranks";
import type { SkinName } from "./skin";

export const rankName = (r: Pick<Rank, "nameCyberpunk" | "nameFantasy">, skin: SkinName) => (skin === "fantasy" ? r.nameFantasy : r.nameCyberpunk);

interface PanelProps {
  ranks: Rank[]; // sorted, lowest first
  current: number;
  progress: Progress;
  skills: Skill[];
  skin: SkinName;
  onSave: (ranks: RankInput[]) => Promise<boolean>;
}

export function RanksPanel({ ranks, current, progress, skills, skin, onSave }: PanelProps) {
  const [editing, setEditing] = useState(false);
  const skillName = (id: number) => skills.find((s) => s.id === id)?.name ?? "Removed skill";

  return (
    <section className="panel" aria-labelledby="ranks-h">
      <div className="panel-head">
        <h2 id="ranks-h">Ranks</h2>
        {!editing && <button className="btn-ghost btn-xs" onClick={() => setEditing(true)}>Edit ranks</button>}
      </div>
      {editing ? (
        <RankEditor
          ranks={ranks}
          skills={skills}
          onCancel={() => setEditing(false)}
          onSave={async (draft) => { if (await onSave(draft)) setEditing(false); }}
        />
      ) : (
        <ol className="ladder">
          {[...ranks].reverse().map((r) => {
            const i = ranks.indexOf(r);
            const reqs = requirementsOf(r, progress, skillName);
            const state = i === current ? "current" : i < current ? "earned" : i === current + 1 ? "next" : "locked";
            return (
              <li key={r.id} className={`rung rung-${state}`}>
                <div className="rung-head">
                  <span className="rung-no">{i + 1}</span>
                  <span className="rung-name">{rankName(r, skin)}</span>
                  <span className="rung-alt" title={skin === "fantasy" ? "Cyberpunk name" : "Fantasy name"}>{rankName(r, skin === "fantasy" ? "cyberpunk" : "fantasy")}</span>
                  {state === "current" && <span className="rung-badge">Your rank</span>}
                  {state === "next" && <span className="rung-badge rung-badge-next">Next</span>}
                </div>
                {reqs.length === 0 ? (
                  <div className="reqs"><span className="req req-met">No requirements</span></div>
                ) : (
                  <div className="reqs">
                    {reqs.map((q) => (
                      <span key={q.label} className={`req ${q.met ? "req-met" : ""}`}>
                        {q.met ? "✓ " : ""}{q.label}{!q.met && state === "next" ? ` (${q.have}/${q.need})` : ""}
                      </span>
                    ))}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

type Draft = RankInput & { key: number };
let nextKey = 1;
const toDraft = (r: RankInput): Draft => ({ ...r, skills: r.skills.map((s) => ({ ...s })), key: nextKey++ });
const blank = (): Draft => toDraft({ nameCyberpunk: "", nameFantasy: "", minOverallLevel: 0, anySkillCount: 0, anySkillLevel: 1, skills: [] });

function RankEditor({ ranks, skills, onSave, onCancel }: { ranks: Rank[]; skills: Skill[]; onSave: (r: RankInput[]) => Promise<void>; onCancel: () => void }) {
  const [draft, setDraft] = useState<Draft[]>(() => ranks.map(toDraft));
  const [busy, setBusy] = useState(false);

  const update = (key: number, patch: Partial<RankInput>) => setDraft((d) => d.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const move = (i: number, by: number) => setDraft((d) => {
    const n = [...d];
    const [x] = n.splice(i, 1);
    n.splice(i + by, 0, x!);
    return n;
  });
  const num = (v: string) => Math.max(0, Math.round(Number(v) || 0));

  return (
    <form
      className="rank-editor"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try { await onSave(draft.map(({ key: _key, ...r }) => r)); } finally { setBusy(false); }
      }}
    >
      <p className="hint">Ranks go from lowest (top) to highest (bottom). You reach a rank when all of its requirements are met. Leave a number at 0 for no requirement.</p>
      {draft.map((r, i) => (
        <fieldset key={r.key} className="rank-row">
          <legend className="label">Rank {i + 1}</legend>
          <div className="row">
            <label className="field"><span className="label">Cyberpunk name</span>
              <input value={r.nameCyberpunk} maxLength={40} required onChange={(e) => update(r.key, { nameCyberpunk: e.target.value })} />
            </label>
            <label className="field"><span className="label">Fantasy name</span>
              <input value={r.nameFantasy} maxLength={40} required onChange={(e) => update(r.key, { nameFantasy: e.target.value })} />
            </label>
          </div>
          <div className="req-line">
            <span>Overall level at least</span>
            <input className="num-in" type="number" min={0} max={100} value={r.minOverallLevel} aria-label={`Rank ${i + 1} overall level`} onChange={(e) => update(r.key, { minOverallLevel: num(e.target.value) })} />
          </div>
          <div className="req-line">
            <span>At least</span>
            <input className="num-in" type="number" min={0} max={50} value={r.anySkillCount} aria-label={`Rank ${i + 1} number of skills`} onChange={(e) => update(r.key, { anySkillCount: num(e.target.value) })} />
            <span>skills at level</span>
            <input className="num-in" type="number" min={0} max={100} value={r.anySkillLevel} aria-label={`Rank ${i + 1} skill level`} onChange={(e) => update(r.key, { anySkillLevel: num(e.target.value) })} />
          </div>
          {r.skills.map((s, j) => (
            <div key={j} className="req-line">
              <select aria-label="Skill" value={s.skillId} onChange={(e) => update(r.key, { skills: r.skills.map((x, k) => (k === j ? { ...x, skillId: Number(e.target.value) } : x)) })}>
                {skills.map((sk) => <option key={sk.id} value={sk.id}>{sk.name}</option>)}
              </select>
              <span>at level</span>
              <input className="num-in" type="number" min={1} max={100} value={s.minLevel} aria-label="Required level" onChange={(e) => update(r.key, { skills: r.skills.map((x, k) => (k === j ? { ...x, minLevel: Math.max(1, num(e.target.value)) } : x)) })} />
              <button type="button" className="btn-ghost btn-xs" aria-label="Remove skill requirement" onClick={() => update(r.key, { skills: r.skills.filter((_, k) => k !== j) })}>×</button>
            </div>
          ))}
          <div className="rank-row-actions">
            {skills.length > 0 && (
              <button type="button" className="btn-ghost btn-xs" onClick={() => {
                const free = skills.find((sk) => !r.skills.some((x) => x.skillId === sk.id));
                if (free) update(r.key, { skills: [...r.skills, { skillId: free.id, minLevel: 2 }] });
              }}>+ Specific skill</button>
            )}
            <span className="spacer" />
            <button type="button" className="btn-ghost btn-xs" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move rank ${i + 1} lower`}>↑</button>
            <button type="button" className="btn-ghost btn-xs" disabled={i === draft.length - 1} onClick={() => move(i, 1)} aria-label={`Move rank ${i + 1} higher`}>↓</button>
            <button type="button" className="btn-danger btn-xs" disabled={draft.length === 1} onClick={() => setDraft((d) => d.filter((x) => x.key !== r.key))}>Remove</button>
          </div>
        </fieldset>
      ))}
      <div className="mform-actions">
        <button type="button" className="btn-ghost" disabled={draft.length >= MAX_RANKS} onClick={() => setDraft((d) => [...d, blank()])}>+ Add rank</button>
        <span className="spacer" />
        <button type="button" className="btn-ghost" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn-primary" disabled={busy}>Save ranks</button>
      </div>
    </form>
  );
}
