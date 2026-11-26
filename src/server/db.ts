import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { BoardState, Reward, Skill, Spend, Task, TaskInput } from "../shared/game.js";
import { balanceOf } from "../shared/game.js";

// Starter content for a brand-new board. These are guesses; edit them in the dashboard.
const DEFAULT_SKILLS = ["Focus", "Fitness", "Learning", "Creativity"];
const DEFAULT_REWARDS: [string, number][] = [
  ["30 min of gaming", 30],
  ["Watch an episode", 45],
  ["Order takeaway", 120],
  ["Free evening, no chores", 200],
];

type Row = Record<string, unknown>;

export class Store {
  readonly db: DatabaseSync;

  constructor(file: string, seed = true) {
    if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS skills (
        id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE
      );
      CREATE TABLE IF NOT EXISTS tasks (
        id INTEGER PRIMARY KEY,
        title TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('duration','window','extra')),
        credits INTEGER NOT NULL,
        duration_min INTEGER, day TEXT, start TEXT, "end" TEXT,
        xp TEXT NOT NULL DEFAULT '[]',
        done INTEGER NOT NULL DEFAULT 0,
        done_at TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS rewards (
        id INTEGER PRIMARY KEY, name TEXT NOT NULL, cost INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS spends (
        id INTEGER PRIMARY KEY, reward_name TEXT NOT NULL, cost INTEGER NOT NULL, at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
    `);
    if (seed && !this.db.prepare("SELECT 1 FROM meta WHERE key = 'seeded'").get()) {
      const addSkill = this.db.prepare("INSERT OR IGNORE INTO skills (name) VALUES (?)");
      const addReward = this.db.prepare("INSERT INTO rewards (name, cost) VALUES (?, ?)");
      DEFAULT_SKILLS.forEach((s) => addSkill.run(s));
      DEFAULT_REWARDS.forEach(([n, c]) => addReward.run(n, c));
      this.db.prepare("INSERT INTO meta (key, value) VALUES ('seeded', ?)").run(new Date().toISOString());
    }
  }

  private toTask(r: Row): Task {
    return {
      id: Number(r.id),
      title: String(r.title),
      kind: r.kind as Task["kind"],
      credits: Number(r.credits),
      durationMin: r.duration_min == null ? null : Number(r.duration_min),
      day: (r.day as string) ?? null,
      start: (r.start as string) ?? null,
      end: (r.end as string) ?? null,
      xp: JSON.parse(String(r.xp)),
      done: Boolean(r.done),
      doneAt: (r.done_at as string) ?? null,
      createdAt: String(r.created_at),
    };
  }

  tasks(): Task[] {
    return this.db.prepare("SELECT * FROM tasks ORDER BY id").all().map((r) => this.toTask(r as Row));
  }
  task(id: number): Task | undefined {
    const r = this.db.prepare("SELECT * FROM tasks WHERE id = ?").get(id);
    return r ? this.toTask(r as Row) : undefined;
  }
  skills(): Skill[] {
    return this.db.prepare("SELECT id, name FROM skills ORDER BY name").all() as unknown as Skill[];
  }
  rewards(): Reward[] {
    return this.db.prepare("SELECT id, name, cost FROM rewards ORDER BY cost, name").all() as unknown as Reward[];
  }
  spends(): Spend[] {
    return this.db.prepare("SELECT id, reward_name AS rewardName, cost, at FROM spends ORDER BY at DESC").all() as unknown as Spend[];
  }
  balance(): number {
    return balanceOf(this.tasks(), this.spends());
  }
  state(): BoardState {
    return { tasks: this.tasks(), skills: this.skills(), rewards: this.rewards(), spends: this.spends(), balance: this.balance() };
  }

  addTask(t: Required<TaskInput>): Task {
    const r = this.db
      .prepare(`INSERT INTO tasks (title, kind, credits, duration_min, day, start, "end", xp, created_at) VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(t.title, t.kind, t.credits, t.durationMin, t.day, t.start, t.end, JSON.stringify(t.xp), new Date().toISOString());
    return this.task(Number(r.lastInsertRowid))!;
  }
  updateTask(id: number, t: Required<TaskInput>): Task | undefined {
    this.db
      .prepare(`UPDATE tasks SET title=?, kind=?, credits=?, duration_min=?, day=?, start=?, "end"=?, xp=? WHERE id=?`)
      .run(t.title, t.kind, t.credits, t.durationMin, t.day, t.start, t.end, JSON.stringify(t.xp), id);
    return this.task(id);
  }
  setDone(id: number, done: boolean): void {
    this.db.prepare("UPDATE tasks SET done=?, done_at=? WHERE id=?").run(done ? 1 : 0, done ? new Date().toISOString() : null, id);
  }
  deleteTask(id: number): boolean {
    return Number(this.db.prepare("DELETE FROM tasks WHERE id=?").run(id).changes) > 0;
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
    this.db.prepare("INSERT INTO spends (reward_name, cost, at) VALUES (?,?,?)").run(name, cost, new Date().toISOString());
  }
}
