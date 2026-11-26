import { useState, type FormEvent } from "react";
import type { Reward } from "../shared/game";
import { meetsRank, type Rank } from "../shared/ranks";
import { rankName } from "./Ranks";
import type { Skin } from "./skin";

export interface RewardDraft {
  name: string;
  cost: number;
  minRankId: number | null;
}

interface Props {
  rewards: Reward[];
  ranks: Rank[]; // sorted, lowest first
  currentRank: number;
  balance: number;
  skin: Skin;
  onAdd: (r: RewardDraft) => Promise<boolean>;
  onUpdate: (id: number, r: RewardDraft) => Promise<boolean>;
  onRemove: (id: number) => Promise<boolean>;
  onRedeem: (r: Reward) => Promise<boolean>;
}

export function ShopPanel({ rewards, ranks, currentRank, balance, skin, onAdd, onUpdate, onRemove, onRedeem }: Props) {
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const [confirm, setConfirm] = useState<number | null>(null);
  const rankOf = (id: number | null) => (id == null ? undefined : ranks.find((r) => r.id === id));

  return (
    <section className="panel" aria-labelledby="shop-h">
      <div className="panel-head"><h2 id="shop-h">{skin.shop}</h2><span className="hint">Balance {balance} {skin.currency}</span></div>
      <div className="shop">
        {rewards.length === 0 && <div className="empty"><strong>Nothing in the shop</strong>Add a leisure activity and its price.</div>}
        {rewards.map((r) =>
          editing === r.id ? (
            <RewardForm
              key={r.id}
              initial={r}
              ranks={ranks}
              skin={skin}
              submitLabel="Save"
              onCancel={() => setEditing(null)}
              onSubmit={async (d) => { if (await onUpdate(r.id, d)) setEditing(null); }}
            />
          ) : (
            <ShopItem
              key={r.id}
              reward={r}
              need={rankOf(r.minRankId)}
              unlocked={meetsRank(ranks, currentRank, r.minRankId)}
              balance={balance}
              skin={skin}
              confirming={confirm === r.id}
              onEdit={() => { setConfirm(null); setEditing(r.id); }}
              onAskRemove={() => setConfirm(r.id)}
              onKeep={() => setConfirm(null)}
              onRemove={() => { setConfirm(null); void onRemove(r.id); }}
              onRedeem={() => void onRedeem(r)}
            />
          ),
        )}
      </div>
      {editing === "new" ? (
        <RewardForm
          ranks={ranks}
          skin={skin}
          submitLabel="Add"
          onCancel={() => setEditing(null)}
          onSubmit={async (d) => { if (await onAdd(d)) setEditing(null); }}
        />
      ) : (
        <button className="btn-ghost" onClick={() => setEditing("new")}>+ Add activity</button>
      )}
    </section>
  );
}

function ShopItem(p: {
  reward: Reward; need?: Rank; unlocked: boolean; balance: number; skin: Skin; confirming: boolean;
  onEdit: () => void; onAskRemove: () => void; onKeep: () => void; onRemove: () => void; onRedeem: () => void;
}) {
  const { reward: r, need, unlocked, balance, skin } = p;
  const short = r.cost - balance;
  const needName = need ? rankName(need, skin.name) : "";
  return (
    <div className={`shop-item ${unlocked ? "" : "is-locked"}`}>
      <span className="shop-name">
        {r.name}
        {need && <span className={`rank-lock ${unlocked ? "rank-lock-ok" : ""}`} title={unlocked ? `Requires ${needName}, which you have` : `Unlocks at ${needName}`}>{unlocked ? "" : "Needs "}{needName}</span>}
      </span>
      <span className="shop-cost">{r.cost} {skin.currency}</span>
      {p.confirming ? (
        <>
          <button className="btn-danger btn-xs" onClick={p.onRemove}>Remove</button>
          <button className="btn-ghost btn-xs" onClick={p.onKeep}>Keep</button>
        </>
      ) : (
        <>
          <button
            className="btn-buy btn-xs"
            disabled={!unlocked || short > 0}
            title={!unlocked ? `Reach ${needName} to unlock` : short > 0 ? `Need ${short} more ${skin.currencyName.toLowerCase()}` : undefined}
            onClick={p.onRedeem}
          >
            {!unlocked ? "Locked" : short > 0 ? `−${short}` : skin.redeem}
          </button>
          <button className="btn-ghost btn-xs" aria-label={`Edit ${r.name}`} onClick={p.onEdit}>Edit</button>
          <button className="btn-ghost btn-xs" aria-label={`Remove ${r.name}`} onClick={p.onAskRemove}>×</button>
        </>
      )}
    </div>
  );
}

function RewardForm({ initial, ranks, skin, submitLabel, onSubmit, onCancel }: {
  initial?: Reward; ranks: Rank[]; skin: Skin; submitLabel: string; onSubmit: (d: RewardDraft) => Promise<void>; onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [cost, setCost] = useState(initial ? String(initial.cost) : "");
  const [rank, setRank] = useState(initial?.minRankId == null ? "" : String(initial.minRankId));
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try { await onSubmit({ name: name.trim(), cost: Math.round(Number(cost)), minRankId: rank ? Number(rank) : null }); } finally { setBusy(false); }
  };
  return (
    <form className="reward-form" onSubmit={submit}>
      <label className="field"><span className="label">Activity</span>
        <input value={name} required maxLength={60} placeholder="e.g. 1 hour gaming" onChange={(e) => setName(e.target.value)} autoFocus />
      </label>
      <div className="row">
        <label className="field"><span className="label">Price ({skin.currency})</span>
          <input type="number" min={1} required value={cost} onChange={(e) => setCost(e.target.value)} />
        </label>
        <label className="field"><span className="label">Minimum rank</span>
          <select value={rank} onChange={(e) => setRank(e.target.value)}>
            <option value="">Anyone</option>
            {ranks.map((r, i) => <option key={r.id} value={r.id}>{i + 1}. {rankName(r, skin.name)}</option>)}
          </select>
        </label>
      </div>
      <div className="mform-actions">
        <button type="button" className="btn-ghost btn-xs" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn-primary btn-xs" disabled={busy}>{submitLabel}</button>
      </div>
    </form>
  );
}
