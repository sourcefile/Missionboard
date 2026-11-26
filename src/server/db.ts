import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { BoardState, Completion, Reward, Skill, Spend, Task, TaskInput, XpGrant } from "../shared/game.js";
import { balanceOf, doneThisPeriod, isRecurring, skillXp, streakOf } from "../shared/game.js";
import { DEFAULT_RANKS, type Rank, type RankInput } from "../shared/ranks.js";

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

  /** Schema versions: 1 = first release (done flag on tasks), 2 = completions ledger + daily/weekly missions, 3 = ranks. */
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

  /** Replaces the whole ladder, lowest rank first. */
  replaceRanks(ranks: RankInput[]): Rank[] {
    this.tx(() => {
      this.db.exec("DELETE FROM ranks");
      this.insertRanks(ranks);
    });
    return this.ranks();
  }

  skillUsedByRanks(skillId: number): boolean {
    return this.ranks().some((r) => r.skills.some((s) => s.skillId === skillId));
  }

  // ---------- reads ----------

  private completionRows(): Completion[] {
    return this.db
      .prepare("SELECT id, task_id, title, credits, xp, at FROM completions ORDER BY at DESC, id DESC")
      .all()
      .map((r) => {
        const row = r as Row;
        return {
          id: Number(row.id),
          taskId: row.task_id == null ? null : Number(row.task_id),
          title: String(row.title),
          credits: Number(row.credits),
          xp: JSON.parse(String(row.xp)) as XpGrant[],
          at: String(row.at),
        };
      });
  }

  private toTask(r: Row, completedAt: string[]): Task {
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
      createdAt: String(r.created_at),
    };
  }

  private completedAtByTask(completions = this.completionRows()): Map<number, string[]> {
    const m = new Map<number, string[]>();
    for (const c of completions) if (c.taskId != null) (m.get(c.taskId) ?? m.set(c.taskId, []).get(c.taskId)!).push(c.at);
    return m; // newest first
  }

  tasks(completions = this.completionRows()): Task[] {
    const by = this.completedAtByTask(completions);
    return this.db.prepare("SELECT * FROM tasks ORDER BY id").all().map((r) => this.toTask(r as Row, by.get(Number((r as Row).id)) ?? []));
  }
  task(id: number): Task | undefined {
    const r = this.db.prepare("SELECT * FROM tasks WHERE id = ?").get(id);
    if (!r) return undefined;
    const at = (this.db.prepare("SELECT at FROM completions WHERE task_id = ? ORDER BY at DESC, id DESC").all(id) as { at: string }[]).map((x) => x.at);
    return this.toTask(r as Row, at);
  }
  skills(): Skill[] {
    return this.db.prepare("SELECT id, name FROM skills ORDER BY name").all() as unknown as Skill[];
  }
  rewards(): Reward[] {
    return this.db.prepare("SELECT id, name, cost FROM rewards ORDER BY cost, name").all() as unknown as Reward[];
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
    return this.tasks().some((t) => t.xp.some((g) => g.skillId === skillId));
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
    const r = this.db
      .prepare(`INSERT INTO tasks (title, kind, credits, duration_min, day, start, "end", xp, created_at) VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(t.title, t.kind, t.credits, t.durationMin, t.day, t.start, t.end, JSON.stringify(t.xp), this.now().toISOString());
    return this.task(Number(r.lastInsertRowid))!;
  }
  updateTask(id: number, t: Required<TaskInput>): Task | undefined {
    this.db
      .prepare(`UPDATE tasks SET title=?, kind=?, credits=?, duration_min=?, day=?, start=?, "end"=?, xp=? WHERE id=?`)
      .run(t.title, t.kind, t.credits, t.durationMin, t.day, t.start, t.end, JSON.stringify(t.xp), id);
    return this.task(id);
  }
  deleteTask(id: number): boolean {
    return Number(this.db.prepare("DELETE FROM tasks WHERE id=?").run(id).changes) > 0;
  }

  /** Pays out a mission once (once per day/week for recurring ones). Returns false if already done. */
  complete(id: number): boolean {
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
    return this.db.prepare("SELECT id, credits FROM completions WHERE task_id = ? ORDER BY at DESC, id DESC LIMIT 1").get(id) as
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

  addReward(name: string, cost: number): Reward {
    const r = this.db.prepare("INSERT INTO rewards (name, cost) VALUES (?, ?)").run(name, cost);
    return { id: Number(r.lastInsertRowid), name, cost };
  }
  reward(id: number): Reward | undefined {
    return this.db.prepare("SELECT id, name, cost FROM rewards WHERE id=?").get(id) as unknown as Reward | undefined;
  }
  deleteReward(id: number): boolean {
    return Number(this.db.prepare("DELETE FROM rewards WHERE id=?").run(id).changes) > 0;
  }
  addSpend(name: string, cost: number): void {
    this.db.prepare("INSERT INTO spends (reward_name, cost, at) VALUES (?,?,?)").run(name, cost, this.now().toISOString());
  }
}
