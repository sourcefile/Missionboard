import { describe, expect, it } from "vitest";
import { balanceOf, levelOf, levelProgress, skillXp, suggestCredits, timingState, validateTask, xpForLevel } from "./game";

describe("levels", () => {
  it("uses growing thresholds", () => {
    expect([1, 2, 3, 4].map(xpForLevel)).toEqual([100, 300, 600, 1000]);
    expect(levelOf(0)).toBe(0);
    expect(levelOf(99)).toBe(0);
    expect(levelOf(100)).toBe(1);
    expect(levelOf(650)).toBe(3);
  });
  it("reports progress inside a level", () => {
    expect(levelProgress(200)).toMatchObject({ level: 1, floor: 100, next: 300, pct: 50 });
  });
});

describe("credits and XP", () => {
  const tasks = [
    { done: true, credits: 20, xp: [{ skillId: 1, amount: 30 }, { skillId: 2, amount: 10 }] },
    { done: false, credits: 50, xp: [{ skillId: 1, amount: 99 }] },
    { done: true, credits: 15, xp: [{ skillId: 1, amount: 5 }] },
  ];
  it("counts only finished missions, minus spending", () => {
    expect(balanceOf(tasks, [{ cost: 10 }])).toBe(25);
  });
  it("sums XP per skill", () => {
    expect(Object.fromEntries(skillXp(tasks))).toEqual({ 1: 35, 2: 10 });
  });
  it("suggests credits from time", () => {
    expect(suggestCredits("duration", 60)).toBe(30);
    expect(suggestCredits("duration", 4)).toBe(5);
    expect(suggestCredits("extra", 0)).toBe(10);
  });
});

describe("timing", () => {
  const now = new Date(2026, 10, 26, 12, 0);
  const win = (s: number, e: number) => ({ kind: "window" as const, day: null, done: false, start: new Date(2026, 10, 26, s).toISOString(), end: new Date(2026, 10, 26, e).toISOString() });
  it("classifies time windows", () => {
    expect(timingState(win(9, 10), now)).toBe("overdue");
    expect(timingState(win(11, 13), now)).toBe("active");
    expect(timingState(win(15, 16), now)).toBe("today");
  });
  it("classifies planned days", () => {
    const d = (day: string) => ({ kind: "duration" as const, day, start: null, end: null, done: false });
    expect(timingState(d("2026-11-25"), now)).toBe("overdue");
    expect(timingState(d("2026-11-26"), now)).toBe("today");
    expect(timingState(d("2026-11-30"), now)).toBe("upcoming");
  });
  it("never flags extra or finished missions", () => {
    expect(timingState({ kind: "extra", day: null, start: null, end: null, done: false }, now)).toBe("none");
    expect(timingState({ ...win(9, 10), done: true }, now)).toBe("none");
  });
});

describe("validateTask", () => {
  const base = { title: "Write report", kind: "duration", credits: 20, durationMin: 45, xp: [] };
  it("accepts a valid duration mission", () => {
    const r = validateTask(base);
    expect(r.ok && r.value).toMatchObject({ title: "Write report", durationMin: 45, start: null });
  });
  it("rejects a window that ends before it starts", () => {
    const r = validateTask({ ...base, kind: "window", start: "2026-11-26T10:00:00Z", end: "2026-11-26T09:00:00Z" });
    expect(r.ok).toBe(false);
  });
  it("allows at most three skills, each once", () => {
    const xp = [1, 2, 3, 4].map((skillId) => ({ skillId, amount: 5 }));
    expect(validateTask({ ...base, xp }).ok).toBe(false);
    expect(validateTask({ ...base, xp: [{ skillId: 1, amount: 5 }, { skillId: 1, amount: 5 }] }).ok).toBe(false);
    expect(validateTask({ ...base, xp: xp.slice(0, 3) }).ok).toBe(true);
  });
  it("rejects unknown skills", () => {
    expect(validateTask({ ...base, xp: [{ skillId: 9, amount: 5 }] }, new Set([1])).ok).toBe(false);
  });
  it("drops scheduling fields that don't belong to the type", () => {
    const r = validateTask({ ...base, kind: "extra", durationMin: 30, start: "2026-11-26T10:00:00Z" });
    expect(r.ok && r.value).toMatchObject({ durationMin: null, start: null });
  });
});
