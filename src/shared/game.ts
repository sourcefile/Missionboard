// Game rules shared by the API and the dashboard.

export type TaskKind = "duration" | "window" | "extra" | "daily" | "weekly";
export type RecurringKind = "daily" | "weekly";

export const isRecurring = (kind: TaskKind): kind is RecurringKind => kind === "daily" || kind === "weekly";
export const isTimed = (kind: TaskKind) => kind === "duration" || kind === "window";

export interface XpGrant {
  skillId: number;
  amount: number;
}

export interface TaskInput {
  title: string;
  kind: TaskKind;
  credits: number;
  durationMin?: number | null; // required for duration missions, optional for daily/weekly
  day?: string | null; // YYYY-MM-DD, optional plan date for duration missions
  start?: string | null; // ISO date-time, window missions
  end?: string | null; // ISO date-time, window missions
  xp: XpGrant[];
}

export interface Task extends Required<TaskInput> {
  id: number;
  /** One-off missions: completed at all. Daily/weekly: completed in the current day/week. */
  done: boolean;
  doneAt: string | null;
  /** Daily/weekly: consecutive days/weeks completed (0 for one-off missions). */
  streak: number;
  createdAt: string;
}

/** One payout. Kept when a mission is deleted, so earned credits and XP stay earned. */
export interface Completion {
  id: number;
  taskId: number | null;
  title: string;
  credits: number;
  xp: XpGrant[];
  at: string;
}

export interface Skill {
  id: number;
  name: string;
}

export interface Reward {
  id: number;
  name: string;
  cost: number;
}

export interface Spend {
  id: number;
  rewardName: string;
  cost: number;
  at: string;
}

export interface BoardState {
  tasks: Task[];
  skills: Skill[];
  /** Total XP per skill id. */
  skillXp: Record<number, number>;
  rewards: Reward[];
  /** Most recent first, capped. */
  spends: Spend[];
  /** Most recent first, capped. */
  completions: Completion[];
  balance: number;
  /** 0 = Sunday, 1 = Monday ... */
  weekStart: number;
}

export const MAX_SKILLS_PER_TASK = 3;

/** Total XP needed to reach a level: L1 at 100, L2 at 300, L3 at 600, L4 at 1000 ... */
export const xpForLevel = (level: number): number => 50 * level * (level + 1);

export function levelOf(xp: number): number {
  let level = 0;
  while (xp >= xpForLevel(level + 1)) level++;
  return level;
}

export function levelProgress(xp: number) {
  const level = levelOf(xp);
  const floor = xpForLevel(level);
  const next = xpForLevel(level + 1);
  return { level, xp, floor, next, pct: Math.round(((xp - floor) / (next - floor)) * 100) };
}

/** Suggested credits: 1 credit per 2 minutes of planned work, minimum 5; missions without a time default to 10. */
export function suggestCredits(kind: TaskKind, minutes: number): number {
  if (kind === "extra" || (isRecurring(kind) && !(minutes > 0))) return 10;
  return Math.max(5, Math.round(minutes / 2));
}

export function minutesBetween(start: string, end: string): number {
  return Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000);
}

export function balanceOf(completions: Pick<Completion, "credits">[], spends: Pick<Spend, "cost">[]): number {
  const earned = completions.reduce((sum, c) => sum + c.credits, 0);
  const spent = spends.reduce((sum, s) => sum + s.cost, 0);
  return earned - spent;
}

export function skillXp(completions: Pick<Completion, "xp">[]): Map<number, number> {
  const totals = new Map<number, number>();
  for (const c of completions) {
    for (const g of c.xp) totals.set(g.skillId, (totals.get(g.skillId) ?? 0) + g.amount);
  }
  return totals;
}

// ---------- recurring periods (local time of whoever runs the code; the server sets TZ) ----------

/** Start of the day or week that contains `at`. */
export function periodStart(kind: RecurringKind, at: Date, weekStart = 1): Date {
  const d = new Date(at.getFullYear(), at.getMonth(), at.getDate());
  if (kind === "weekly") d.setDate(d.getDate() - ((d.getDay() - weekStart + 7) % 7));
  return d;
}

/** Start of the next day or week after `at`'s period: when the mission refreshes. */
export function nextPeriodStart(kind: RecurringKind, at: Date, weekStart = 1): Date {
  const d = periodStart(kind, at, weekStart);
  d.setDate(d.getDate() + (kind === "weekly" ? 7 : 1));
  return d;
}

function previousPeriodStart(kind: RecurringKind, start: Date): Date {
  const d = new Date(start);
  d.setDate(d.getDate() - (kind === "weekly" ? 7 : 1));
  return d;
}

/** Is there a completion inside the current day/week? */
export function doneThisPeriod(kind: RecurringKind, completedAt: (string | Date)[], now = new Date(), weekStart = 1): boolean {
  const start = periodStart(kind, now, weekStart).getTime();
  return completedAt.some((a) => new Date(a).getTime() >= start);
}

/**
 * Consecutive periods completed, counting back from the current one.
 * The current period counts only once done, so an unfinished today doesn't break yesterday's streak.
 */
export function streakOf(kind: RecurringKind, completedAt: (string | Date)[], now = new Date(), weekStart = 1): number {
  const starts = new Set(completedAt.map((a) => periodStart(kind, new Date(a), weekStart).getTime()));
  let cursor = periodStart(kind, now, weekStart);
  if (!starts.has(cursor.getTime())) cursor = previousPeriodStart(kind, cursor);
  let streak = 0;
  while (starts.has(cursor.getTime())) {
    streak++;
    cursor = previousPeriodStart(kind, cursor);
  }
  return streak;
}

export type TimingState = "overdue" | "active" | "today" | "upcoming" | "none";

/** Where a mission stands in time right now. */
export function timingState(task: Pick<Task, "kind" | "day" | "start" | "end" | "done">, now = new Date()): TimingState {
  if (task.done) return "none";
  if (task.kind === "window" && task.start && task.end) {
    const s = new Date(task.start);
    const e = new Date(task.end);
    if (now > e) return "overdue";
    if (now >= s) return "active";
    return s.toDateString() === now.toDateString() ? "today" : "upcoming";
  }
  if (task.kind === "duration" && task.day) {
    const [y, m, d] = task.day.split("-").map(Number);
    const day = new Date(y!, m! - 1, d!);
    const next = new Date(day);
    next.setDate(next.getDate() + 1);
    if (now >= next) return "overdue";
    return day.toDateString() === now.toDateString() ? "today" : "upcoming";
  }
  return "none";
}

/** Sort key: scheduled missions first by time, unscheduled ones after. */
export function sortKey(task: Pick<Task, "kind" | "day" | "start">): number {
  if (task.kind === "window" && task.start) return new Date(task.start).getTime();
  if (task.kind === "duration" && task.day) {
    const [y, m, d] = task.day.split("-").map(Number);
    return new Date(y!, m! - 1, d!).getTime();
  }
  return Number.POSITIVE_INFINITY;
}

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

const isInt = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n);

/** Checks and normalises a mission coming from the dashboard. */
export function validateTask(raw: unknown, knownSkills?: Set<number>): Result<Required<TaskInput>> {
  if (typeof raw !== "object" || raw === null) return { ok: false, error: "Send the mission as an object." };
  const r = raw as Record<string, unknown>;
  const title = typeof r.title === "string" ? r.title.trim() : "";
  if (!title) return { ok: false, error: "Give the mission a name." };
  if (title.length > 140) return { ok: false, error: "Keep the name under 140 characters." };
  const kind = r.kind;
  if (kind !== "duration" && kind !== "window" && kind !== "extra" && kind !== "daily" && kind !== "weekly") return { ok: false, error: "Pick a mission type." };
  if (!isInt(r.credits) || r.credits < 0 || r.credits > 10000) return { ok: false, error: "Credits must be a whole number from 0 to 10000." };

  const out: Required<TaskInput> = { title, kind, credits: r.credits, durationMin: null, day: null, start: null, end: null, xp: [] };

  if (kind === "duration") {
    if (!isInt(r.durationMin) || r.durationMin < 1 || r.durationMin > 24 * 60 * 7) return { ok: false, error: "Set a duration of at least 1 minute." };
    out.durationMin = r.durationMin;
    if (r.day != null && r.day !== "") {
      if (typeof r.day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(r.day)) return { ok: false, error: "Use a date like 2026-11-26." };
      out.day = r.day;
    }
  } else if (kind === "window") {
    const s = typeof r.start === "string" ? new Date(r.start) : null;
    const e = typeof r.end === "string" ? new Date(r.end) : null;
    if (!s || !e || isNaN(s.getTime()) || isNaN(e.getTime())) return { ok: false, error: "Pick both a start and an end time." };
    if (e <= s) return { ok: false, error: "The end time needs to be after the start time." };
    out.start = s.toISOString();
    out.end = e.toISOString();
  } else if (isRecurring(kind) && r.durationMin != null && r.durationMin !== "") {
    if (!isInt(r.durationMin) || r.durationMin < 1 || r.durationMin > 24 * 60) return { ok: false, error: "Set a duration between 1 minute and 24 hours, or leave it empty." };
    out.durationMin = r.durationMin;
  }

  const xpRaw = Array.isArray(r.xp) ? r.xp : [];
  const seen = new Set<number>();
  for (const g of xpRaw as Record<string, unknown>[]) {
    if (!g || !isInt(g.skillId) || !isInt(g.amount)) return { ok: false, error: "Each XP reward needs a skill and a whole number." };
    if (g.amount < 1 || g.amount > 10000) return { ok: false, error: "XP must be between 1 and 10000." };
    if (seen.has(g.skillId)) return { ok: false, error: "Each skill can only appear once per mission." };
    if (knownSkills && !knownSkills.has(g.skillId)) return { ok: false, error: "That skill doesn't exist any more." };
    seen.add(g.skillId);
    out.xp.push({ skillId: g.skillId, amount: g.amount });
  }
  if (out.xp.length > MAX_SKILLS_PER_TASK) return { ok: false, error: `A mission can train at most ${MAX_SKILLS_PER_TASK} skills.` };
  return { ok: true, value: out };
}
