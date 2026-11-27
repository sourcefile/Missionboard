import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { BoardState, Completion, Reward, Skill, Spend, Subtask, SubtaskInput, Task, TaskInput, XpGrant } from "../shared/game.js";
import { balanceOf, doneThisPeriod, isOperation, isRecurring, skillXp, streakOf, taskSkillIds } from "../shared/game.js";
import { DEFAULT_RANKS, progressFrom, rankStatus, type Rank, type RankInput } from "../shared/ranks.js";

// Starter content for a brand-new board. These are guesses; edit them in the dashboard.
const DEFAULT_SKILLS = ["Focus", "Fitness", "Learning", "Creativity"];
const DEFAULT_REWARDS: [string, number][] = [
  ["30 min of gaming", 30],
  ["Watch an episode", 45],
  ["Order takeaway", 120],
  ["Free evening, no chores", 200],
];

const LOG_LIMIT = 100;

type Row = Record<string, unknown>;

export interface StoreOptions {
  seed?: boolean;
  /** 0 = Sunday, 1 = Monday ... */
  weekStart?: number;
  /** Injectable clock for tests. */
  now?: () => Date;
}

export class Store {
  readonly db: DatabaseSync;
  readonly weekStart: number;
  private readonly now: () => Date;

  constructor(file: string, opts: StoreOptions = {}) {
    this.weekStart = opts.weekStart ?? 1;
    this.now = opts.now ?? (() => new Date());
    if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
    this.migrate();
    if ((opts.seed ?? true) && !this.meta("seeded")) {
      const addSkill = this.db.prepare("INSERT OR IGNORE INTO skills (name) VALUES (?)");
      const addReward = this.db.prepare("INSERT INTO rewards (name, cost) VALUES (?, ?)");
      DEFAULT_SKILLS.forEach((s) => addSkill.run(s));
      DEFAULT_REWARDS.forEach(([n, c]) => addReward.run(n, c));
      this.setMeta("seeded", this.now().toISOString());
    }
  }

  private meta(key: string): string | undefined {
    const r = this.db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as { value: string } | undefined;
    return r?.value;
  }
  private setMeta(key: string, value: string) {
    this.db.prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
  }

  private tx<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const out = fn();
      this.db.exec("COMMIT");
      return out;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  /** Schema versions: 1 = first release (done flag on tasks), 2 = completions ledger + daily/weekly missions, 3 = ranks, 4 = rank-restricted shop items, 5 = operations with subtasks. */
  private migrate() {
    this.db.exec("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)");
    const hasTasks = Boolean(this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='tasks'").get());
    let version = Number(this.meta("schema_version") ?? (hasTasks ? 1 : 0));

    if (version === 0) {
      this.tx(() => {
        this.db.exec(`
          CREATE TABLE skills (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE);
          CREATE TABLE tasks (
            id INTEGER PRIMARY KEY,
            title TEXT NOT NULL,
            kind TEXT NOT NULL,
            credits INTEGER NOT NULL,
            duration_min INTEGER, day TEXT, start TEXT, "end" TEXT,
            xp TEXT NOT NULL DEFAULT '[]',
            created_at TEXT NOT NULL
          );
          CREATE TABLE completions (
            id INTEGER PRIMARY KEY,
            task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
            title TEXT NOT NULL,
            credits INTEGER NOT NULL,
            xp TEXT NOT NULL DEFAULT '[]',
            at TEXT NOT NULL
          );
          CREATE INDEX completions_task ON completions(task_id, at);
          CREATE TABLE rewards (id INTEGER PRIMARY KEY, name TEXT NOT NULL, cost INTEGER NOT NULL);
          CREATE TABLE spends (id INTEGER PRIMARY KEY, reward_name TEXT NOT NULL, cost INTEGER NOT NULL, at TEXT NOT NULL);
        `);
        this.setMeta("schema_version", "2");
      });
      version = 2;
    }

    if (version === 1) {
      // Move "done" payouts into the completions ledger and drop the old kind CHECK so daily/weekly fit.
      this.db.exec("PRAGMA foreign_keys = OFF");
      this.tx(() => {
        this.db.exec(`
          CREATE TABLE tasks_v2 (
            id INTEGER PRIMARY KEY,
            title TEXT NOT NULL,
            kind TEXT NOT NULL,
            credits INTEGER NOT NULL,
            duration_min INTEGER, day TEXT, start TEXT, "end" TEXT,
            xp TEXT NOT NULL DEFAULT '[]',
            created_at TEXT NOT NULL
          );
          INSERT INTO tasks_v2 (id, title, kind, credits, duration_min, day, start, "end", xp, created_at)
            SELECT id, title, kind, credits, duration_min, day, start, "end", xp, created_at FROM tasks;
          CREATE TABLE completions (
            id INTEGER PRIMARY KEY,
            task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
            title TEXT NOT NULL,
            credits INTEGER NOT NULL,
            xp TEXT NOT NULL DEFAULT '[]',
            at TEXT NOT NULL
          );
          INSERT INTO completions (task_id, title, credits, xp, at)
            SELECT id, title, credits, xp, COALESCE(done_at, created_at) FROM tasks WHERE done = 1;
          DROP TABLE tasks;
          ALTER TABLE tasks_v2 RENAME TO tasks;
          CREATE INDEX completions_task ON completions(task_id, at);
        `);
        this.setMeta("schema_version", "2");
      });
      this.db.exec("PRAGMA foreign_keys = ON");
      version = 2;
    }

    if (version === 2) {
      this.tx(() => {
        this.db.exec(`
          CREATE TABLE ranks (
            id INTEGER PRIMARY KEY,
            position INTEGER NOT NULL,
            name_cyberpunk TEXT NOT NULL,
            name_fantasy TEXT NOT NULL,
            min_overall_level INTEGER NOT NULL DEFAULT 0,
            any_skill_count INTEGER NOT NULL DEFAULT 0,
            any_skill_level INTEGER NOT NULL DEFAULT 0,
            skills TEXT NOT NULL DEFAULT '[]'
          );
        `);
        this.insertRanks(DEFAULT_RANKS); // four example ranks, for new and upgraded boards alike
        this.setMeta("schema_version", "3");
      });
      version = 3;
    }

    if (version === 3) {
      this.tx(() => {
        this.db.exec("ALTER TABLE rewards ADD COLUMN min_rank_id INTEGER REFERENCES ranks(id) ON DELETE SET NULL");
        this.setMeta("schema_version", "4");
      });
      version = 4;
    }

    if (version === 4) {
      this.tx(() => {
        this.db.exec(`
          CREATE TABLE subtasks (
            id INTEGER PRIMARY KEY,
            task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
            position INTEGER NOT NULL,
            title TEXT NOT NULL,
            credits INTEGER NOT NULL,
            xp TEXT NOT NULL DEFAULT '[]'
          );
          CREATE INDEX subtasks_task ON subtasks(task_id, position);
          ALTER TABLE completions ADD COLUMN subtask_id INTEGER REFERENCES subtasks(id) ON DELETE SET NULL;
        `);
        this.setMeta("schema_version", "5");
      });
      version = 5;
    }
  }

  private insertRanks(ranks: RankInput[]) {
    const ins = this.db.prepare(
      "INSERT INTO ranks (position, name_cyberpunk, name_fantasy, min_overall_level, any_skill_count, any_skill_level, skills) VALUES (?,?,?,?,?,?,?)",
    );
    ranks.forEach((r, i) => ins.run(i, r.nameCyberpunk, r.nameFantasy, r.minOverallLevel, r.anySkillCount, r.anySkillLevel, JSON.stringify(r.skills)));
  }

  ranks(): Rank[] {
    return this.db
      .prepare("SELECT * FROM ranks ORDER BY position, id")
      .all()
      .map((x) => {
        const r = x as Row;
        return {
          id: Number(r.id),
          position: Number(r.position),
          nameCyberpunk: String(r.name_cyberpunk),
          nameFantasy: String(r.name_fantasy),
          minOverallLevel: Number(r.min_overall_level),
          anySkillCount: Number(r.any_skill_count),
          anySkillLevel: Number(r.any_skill_level),
          skills: JSON.parse(String(r.skills)),
        };
      });
  }

  /** Replaces the whole ladder, lowest rank first. Ranks sent with an id are updated in place. */
  replaceRanks(ranks: RankInput[]): Rank[] {
    this.tx(() => {
      const keep = new Set(ranks.map((r) => r.id).filter((id): id is number => id !== undefined));
      for (const old of this.ranks()) if (!keep.has(old.id)) this.db.prepare("DELETE FROM ranks WHERE id = ?").run(old.id);
      const upd = this.db.prepare(
        "UPDATE ranks SET position=?, name_cyberpunk=?, name_fantasy=?, min_overall_level=?, any_skill_count=?, any_skill_level=?, skills=? WHERE id=?",
      );
      const ins = this.db.prepare(
        "INSERT INTO ranks (position, name_cyberpunk, name_fantasy, min_overall_level, any_skill_count, any_skill_level, skills) VALUES (?,?,?,?,?,?,?)",
      );
      ranks.forEach((r, i) => {
        const vals = [i, r.nameCyberpunk, r.nameFantasy, r.minOverallLevel, r.anySkillCount, r.anySkillLevel, JSON.stringify(r.skills)] as const;
        if (r.id !== undefined && Number(upd.run(...vals, r.id).changes) > 0) return;
        ins.run(...vals);
      });
    });
    return this.ranks();
  }

  /** Shop items that require one of these ranks. */
  rewardsRequiringRanks(rankIds: number[]): Reward[] {
    const ids = new Set(rankIds);
    return this.rewards().filter((r) => r.minRankId != null && ids.has(r.minRankId));
  }

  skillUsedByRanks(skillId: number): boolean {
    return this.ranks().some((r) => r.skills.some((s) => s.skillId === skillId));
  }

  // ---------- reads ----------

  private completionRows(): Completion[] {
    return this.db
      .prepare("SELECT id, task_id, subtask_id, title, credits, xp, at FROM completions ORDER BY at DESC, id DESC")
      .all()
      .map((r) => {
        const row = r as Row;
        return {
          id: Number(row.id),
          taskId: row.task_id == null ? null : Number(row.task_id),
          subtaskId: row.subtask_id == null ? null : Number(row.subtask_id),
          title: String(row.title),
          credits: Number(row.credits),
          xp: JSON.parse(String(row.xp)) as XpGrant[],
          at: String(row.at),
        };
      });
  }

  /** Subtasks per operation, with whether each one has been paid out. */
  private subtasksByTask(completions: Completion[], taskId?: number): Map<number, Subtask[]> {
    const doneAt = new Map<number, string>();
    for (const c of completions) if (c.subtaskId != null && !doneAt.has(c.subtaskId)) doneAt.set(c.subtaskId, c.at); // newest first
    const rows = taskId === undefined
      ? this.db.prepare("SELECT * FROM subtasks ORDER BY task_id, position, id").all()
      : this.db.prepare("SELECT * FROM subtasks WHERE task_id = ? ORDER BY position, id").all(taskId);
    const m = new Map<number, Subtask[]>();
    for (const x of rows) {
      const r = x as Row;
      const id = Number(r.id);
      const at = doneAt.get(id) ?? null;
      const sub: Subtask = { id, title: String(r.title), credits: Number(r.credits), xp: JSON.parse(String(r.xp)), done: at !== null, doneAt: at };
      const tid = Number(r.task_id);
      (m.get(tid) ?? m.set(tid, []).get(tid)!).push(sub);
    }
    return m;
  }

  private toTask(r: Row, completedAt: string[], subtasks: Subtask[] = []): Task {
    const kind = r.kind as Task["kind"];
    const now = this.now();
    const recurring = isRecurring(kind);
    const done = recurring ? doneThisPeriod(kind, completedAt, now, this.weekStart) : completedAt.length > 0;
    return {
      id: Number(r.id),
      title: String(r.title),
      kind,
      credits: Number(r.credits),
      durationMin: r.duration_min == null ? null : Number(r.duration_min),
      day: (r.day as string) ?? null,
      start: (r.start as string) ?? null,
      end: (r.end as string) ?? null,
      xp: JSON.parse(String(r.xp)),
      done,
      doneAt: done ? (completedAt[0] ?? null) : null,
      streak: recurring ? streakOf(kind, completedAt, now, this.weekStart) : 0,
      subtasks: isOperation(kind) ? subtasks : [],
      createdAt: String(r.created_at),
    };
  }

  private completedAtByTask(completions = this.completionRows()): Map<number, string[]> {
    const m = new Map<number, string[]>();
    // Subtask payouts don't count: an operation is done once its bonus is paid.
    for (const c of completions) if (c.taskId != null && c.subtaskId == null) (m.get(c.taskId) ?? m.set(c.taskId, []).get(c.taskId)!).push(c.at);
    return m; // newest first
  }

  tasks(completions = this.completionRows()): Task[] {
    const by = this.completedAtByTask(completions);
    const subs = this.subtasksByTask(completions);
    return this.db.prepare("SELECT * FROM tasks ORDER BY id").all().map((r) => {
      const id = Number((r as Row).id);
      return this.toTask(r as Row, by.get(id) ?? [], subs.get(id));
    });
  }
  task(id: number): Task | undefined {
    const r = this.db.prepare("SELECT * FROM tasks WHERE id = ?").get(id);
    if (!r) return undefined;
    const at = (this.db.prepare("SELECT at FROM completions WHERE task_id = ? AND subtask_id IS NULL ORDER BY at DESC, id DESC").all(id) as { at: string }[]).map((x) => x.at);
    const subCompletions = this.db
      .prepare("SELECT subtask_id, at FROM completions WHERE task_id = ? AND subtask_id IS NOT NULL ORDER BY at DESC, id DESC")
      .all(id)
      .map((x) => ({ subtaskId: Number((x as Row).subtask_id), at: String((x as Row).at) }) as Completion);
    return this.toTask(r as Row, at, this.subtasksByTask(subCompletions, id).get(id));
  }
  skills(): Skill[] {
    return this.db.prepare("SELECT id, name FROM skills ORDER BY name").all() as unknown as Skill[];
  }
  rewards(): Reward[] {
    return this.db.prepare("SELECT id, name, cost, min_rank_id AS minRankId FROM rewards ORDER BY cost, name").all() as unknown as Reward[];
  }
  spends(): Spend[] {
    return this.db.prepare("SELECT id, reward_name AS rewardName, cost, at FROM spends ORDER BY at DESC, id DESC").all() as unknown as Spend[];
  }
  balance(): number {
    const earned = Number((this.db.prepare("SELECT COALESCE(SUM(credits), 0) AS n FROM completions").get() as { n: number }).n);
    const spent = Number((this.db.prepare("SELECT COALESCE(SUM(cost), 0) AS n FROM spends").get() as { n: number }).n);
    return earned - spent;
  }
  skillUsedByTasks(skillId: number): boolean {
    return this.tasks().some((t) => taskSkillIds(t).includes(skillId));
  }
  state(): BoardState {
    const completions = this.completionRows();
    const spends = this.spends();
    return {
      tasks: this.tasks(completions),
      skills: this.skills(),
      skillXp: Object.fromEntries(skillXp(completions)),
      rewards: this.rewards(),
      spends: spends.slice(0, LOG_LIMIT),
      completions: completions.slice(0, LOG_LIMIT),
      balance: balanceOf(completions, spends),
      weekStart: this.weekStart,
      ranks: this.ranks(),
    };
  }

  // ---------- writes ----------

  addTask(t: Required<TaskInput>): Task {
    const id = this.tx(() => {
      const r = this.db
        .prepare(`INSERT INTO tasks (title, kind, credits, duration_min, day, start, "end", xp, created_at) VALUES (?,?,?,?,?,?,?,?,?)`)
        .run(t.title, t.kind, t.credits, t.durationMin, t.day, t.start, t.end, JSON.stringify(t.xp), this.now().toISOString());
      const id = Number(r.lastInsertRowid);
      if (isOperation(t.kind)) this.writeSubtasks(id, t.subtasks);
      return id;
    });
    return this.task(id)!;
  }
  updateTask(id: number, t: Required<TaskInput>): Task | undefined {
    this.tx(() => {
      const before = this.task(id);
      if (!before) return;
      if (isOperation(before.kind) !== isOperation(t.kind)) {
        // Switching into or out of an operation: earlier payouts stay in the log but no longer count for this mission.
        this.db.prepare("UPDATE completions SET task_id = NULL, subtask_id = NULL WHERE task_id = ?").run(id);
      }
      this.db
        .prepare(`UPDATE tasks SET title=?, kind=?, credits=?, duration_min=?, day=?, start=?, "end"=?, xp=? WHERE id=?`)
        .run(t.title, t.kind, t.credits, t.durationMin, t.day, t.start, t.end, JSON.stringify(t.xp), id);
      this.writeSubtasks(id, isOperation(t.kind) ? t.subtasks : []);
      if (isOperation(t.kind)) this.payBonusIfFinished(id);
    });
    return this.task(id);
  }

  /** Replaces an operation's subtasks. Subtasks sent with their id keep their progress. */
  private writeSubtasks(taskId: number, subs: SubtaskInput[]) {
    const keep = new Set(subs.map((s) => s.id).filter((x): x is number => x !== undefined));
    const existing = (this.db.prepare("SELECT id FROM subtasks WHERE task_id = ?").all(taskId) as { id: number }[]).map((r) => Number(r.id));
    for (const old of existing) {
      if (keep.has(old)) continue;
      // A removed subtask's payout stays in the log, detached from the operation.
      this.db.prepare("UPDATE completions SET task_id = NULL, subtask_id = NULL WHERE subtask_id = ?").run(old);
      this.db.prepare("DELETE FROM subtasks WHERE id = ?").run(old);
    }
    const upd = this.db.prepare("UPDATE subtasks SET position=?, title=?, credits=?, xp=? WHERE id=? AND task_id=?");
    const ins = this.db.prepare("INSERT INTO subtasks (task_id, position, title, credits, xp) VALUES (?,?,?,?,?)");
    subs.forEach((s, i) => {
      if (s.id !== undefined && Number(upd.run(i, s.title, s.credits, JSON.stringify(s.xp), s.id, taskId).changes) > 0) return;
      ins.run(taskId, i, s.title, s.credits, JSON.stringify(s.xp));
    });
  }

  /** Pays an operation's bonus once every subtask is done. Returns true if it paid now. */
  private payBonusIfFinished(taskId: number): boolean {
    const t = this.task(taskId);
    if (!t || !isOperation(t.kind) || t.done || t.subtasks.length === 0 || t.subtasks.some((s) => !s.done)) return false;
    this.db
      .prepare("INSERT INTO completions (task_id, title, credits, xp, at) VALUES (?,?,?,?,?)")
      .run(t.id, `${t.title} · bonus`, t.credits, JSON.stringify(t.xp), this.now().toISOString());
    return true;
  }

  /** Pays out one subtask; completes the operation (and pays its bonus) when it was the last one. */
  completeSubtask(taskId: number, subtaskId: number): { paid: boolean; finished: boolean } {
    return this.tx(() => {
      const t = this.task(taskId);
      const sub = t?.subtasks.find((s) => s.id === subtaskId);
      if (!t || !sub || sub.done) return { paid: false, finished: false };
      this.db
        .prepare("INSERT INTO completions (task_id, subtask_id, title, credits, xp, at) VALUES (?,?,?,?,?,?)")
        .run(t.id, sub.id, `${t.title} › ${sub.title}`, sub.credits, JSON.stringify(sub.xp), this.now().toISOString());
      return { paid: true, finished: this.payBonusIfFinished(t.id) };
    });
  }

  /**
   * Payouts that reopening would take back: a subtask's own payout plus the bonus if it was paid,
   * or for the whole operation every subtask payout plus the bonus.
   */
  reopenPlan(taskId: number, subtaskId?: number): { ids: number[]; credits: number } {
    const rows = this.db
      .prepare("SELECT id, subtask_id, credits FROM completions WHERE task_id = ? ORDER BY at DESC, id DESC")
      .all(taskId) as { id: number; subtask_id: number | null; credits: number }[];
    const bonus = rows.find((r) => r.subtask_id == null);
    const picked = subtaskId === undefined
      ? rows.filter((r) => r.subtask_id != null)
      : rows.filter((r) => r.subtask_id === subtaskId).slice(0, 1);
    if (subtaskId !== undefined && picked.length === 0) return { ids: [], credits: 0 };
    const all = bonus ? [...picked, bonus] : picked;
    return { ids: all.map((r) => Number(r.id)), credits: all.reduce((a, r) => a + Number(r.credits), 0) };
  }
  removeCompletions(ids: number[]) {
    this.tx(() => { for (const id of ids) this.removeCompletion(id); });
  }
  deleteTask(id: number): boolean {
    return Number(this.db.prepare("DELETE FROM tasks WHERE id=?").run(id).changes) > 0;
  }

  /** Pays out a mission once (once per day/week for recurring ones). Returns false if already done. */
  complete(id: number): boolean {
    const op = this.task(id);
    if (op && isOperation(op.kind)) {
      // Completing an operation directly finishes every remaining subtask, then pays the bonus.
      if (op.done) return false;
      for (const s of op.subtasks) if (!s.done) this.completeSubtask(id, s.id);
      return true;
    }
    return this.tx(() => {
      const t = this.task(id);
      if (!t || t.done) return false;
      this.db
        .prepare("INSERT INTO completions (task_id, title, credits, xp, at) VALUES (?,?,?,?,?)")
        .run(t.id, t.title, t.credits, JSON.stringify(t.xp), this.now().toISOString());
      return true;
    });
  }

  /** The completion that makes a mission count as done right now (the latest one). */
  currentCompletion(id: number): { id: number; credits: number } | undefined {
    const t = this.task(id);
    if (!t?.done) return undefined;
    return this.db.prepare("SELECT id, credits FROM completions WHERE task_id = ? AND subtask_id IS NULL ORDER BY at DESC, id DESC LIMIT 1").get(id) as
      | { id: number; credits: number }
      | undefined;
  }
  removeCompletion(completionId: number) {
    this.db.prepare("DELETE FROM completions WHERE id = ?").run(completionId);
  }

  addSkill(name: string): Skill {
    const r = this.db.prepare("INSERT INTO skills (name) VALUES (?)").run(name);
    return { id: Number(r.lastInsertRowid), name };
  }
  hasSkillNamed(name: string): boolean {
    return Boolean(this.db.prepare("SELECT 1 FROM skills WHERE name = ?").get(name));
  }
  deleteSkill(id: number): boolean {
    return Number(this.db.prepare("DELETE FROM skills WHERE id=?").run(id).changes) > 0;
  }

  addReward(name: string, cost: number, minRankId: number | null = null): Reward {
    const r = this.db.prepare("INSERT INTO rewards (name, cost, min_rank_id) VALUES (?, ?, ?)").run(name, cost, minRankId);
    return { id: Number(r.lastInsertRowid), name, cost, minRankId };
  }
  updateReward(id: number, name: string, cost: number, minRankId: number | null): Reward | undefined {
    this.db.prepare("UPDATE rewards SET name=?, cost=?, min_rank_id=? WHERE id=?").run(name, cost, minRankId, id);
    return this.reward(id);
  }
  reward(id: number): Reward | undefined {
    return this.db.prepare("SELECT id, name, cost, min_rank_id AS minRankId FROM rewards WHERE id=?").get(id) as unknown as Reward | undefined;
  }
  /** Ladder index of the rank the current progress qualifies for. */
  currentRankIndex(): number {
    const s = this.state();
    return rankStatus(s.ranks, progressFrom(s.skillXp, s.skills.map((k) => k.id))).current;
  }
  deleteReward(id: number): boolean {
    return Number(this.db.prepare("DELETE FROM rewards WHERE id=?").run(id).changes) > 0;
  }
  addSpend(name: string, cost: number): void {
    this.db.prepare("INSERT INTO spends (reward_name, cost, at) VALUES (?,?,?)").run(name, cost, this.now().toISOString());
  }
}
