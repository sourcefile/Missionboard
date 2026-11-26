import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "./app";
import { Store } from "./db";

let app: ReturnType<typeof createApp>;
let skillId: number;
let clock: Date;

beforeEach(() => {
  clock = new Date(2026, 10, 26, 12, 0); // Thursday
  const store = new Store(":memory:", { seed: false, now: () => clock });
  app = createApp(store);
  skillId = store.addSkill("Focus").id;
});

const mission = (extra: object = {}) => ({ title: "Deep work", kind: "duration", credits: 30, durationMin: 60, xp: [{ skillId, amount: 40 }], ...extra });

describe("API", () => {
  it("creates, completes and pays out a mission", async () => {
    const created = await request(app).post("/api/tasks").send(mission()).expect(201);
    const state = await request(app).post(`/api/tasks/${created.body.id}/complete`).expect(200);
    expect(state.body.balance).toBe(30);
    expect(state.body.tasks[0].done).toBe(true);
    expect(state.body.skillXp).toEqual({ [skillId]: 40 });
    expect(state.body.completions[0]).toMatchObject({ title: "Deep work", credits: 30 });
  });

  it("completing twice pays out once", async () => {
    const { body } = await request(app).post("/api/tasks").send(mission()).expect(201);
    await request(app).post(`/api/tasks/${body.id}/complete`);
    const again = await request(app).post(`/api/tasks/${body.id}/complete`).expect(200);
    expect(again.body.balance).toBe(30);
  });

  it("rejects invalid missions with a readable message", async () => {
    const r = await request(app).post("/api/tasks").send(mission({ title: "" })).expect(400);
    expect(r.body.error).toMatch(/name/);
  });

  it("spends credits only when there are enough", async () => {
    const reward = await request(app).post("/api/rewards").send({ name: "Gaming", cost: 25 }).expect(201);
    await request(app).post(`/api/rewards/${reward.body.id}/redeem`).expect(409);
    const t = await request(app).post("/api/tasks").send(mission()).expect(201);
    await request(app).post(`/api/tasks/${t.body.id}/complete`);
    const after = await request(app).post(`/api/rewards/${reward.body.id}/redeem`).expect(200);
    expect(after.body.balance).toBe(5);
    expect(after.body.spends[0]).toMatchObject({ rewardName: "Gaming", cost: 25 });
  });

  it("won't reopen a mission whose credits are spent", async () => {
    const t = await request(app).post("/api/tasks").send(mission()).expect(201);
    await request(app).post(`/api/tasks/${t.body.id}/complete`);
    const reward = await request(app).post("/api/rewards").send({ name: "Film", cost: 20 });
    await request(app).post(`/api/rewards/${reward.body.id}/redeem`).expect(200);
    await request(app).post(`/api/tasks/${t.body.id}/reopen`).expect(409);
  });

  it("keeps earned credits when a finished mission is deleted", async () => {
    const t = await request(app).post("/api/tasks").send(mission()).expect(201);
    await request(app).post(`/api/tasks/${t.body.id}/complete`);
    await request(app).delete(`/api/tasks/${t.body.id}`).expect(204);
    const s = await request(app).get("/api/state");
    expect(s.body.tasks).toHaveLength(0);
    expect(s.body.balance).toBe(30);
    expect(s.body.completions[0]).toMatchObject({ title: "Deep work", taskId: null });
  });

  it("protects skills that missions still use", async () => {
    await request(app).post("/api/tasks").send(mission()).expect(201);
    await request(app).delete(`/api/skills/${skillId}`).expect(409);
    await request(app).post("/api/skills").send({ name: "focus" }).expect(409);
  });

  it("returns 404 JSON for unknown endpoints", async () => {
    const r = await request(app).get("/api/nope").expect(404);
    expect(r.body.error).toBeTruthy();
  });
});

describe("daily and weekly missions", () => {
  it("a daily mission refreshes at midnight and pays out again", async () => {
    const t = await request(app).post("/api/tasks").send({ title: "Stretch", kind: "daily", credits: 5, xp: [] }).expect(201);
    let s = await request(app).post(`/api/tasks/${t.body.id}/complete`);
    expect(s.body.tasks[0]).toMatchObject({ done: true, streak: 1 });
    s = await request(app).post(`/api/tasks/${t.body.id}/complete`);
    expect(s.body.balance).toBe(5); // once per day

    clock = new Date(2026, 10, 27, 0, 1); // just after midnight
    s = await request(app).get("/api/state");
    expect(s.body.tasks[0]).toMatchObject({ done: false, streak: 1 });
    s = await request(app).post(`/api/tasks/${t.body.id}/complete`);
    expect(s.body.tasks[0]).toMatchObject({ done: true, streak: 2 });
    expect(s.body.balance).toBe(10);
  });

  it("a weekly mission refreshes on the first day of the week", async () => {
    const t = await request(app).post("/api/tasks").send({ title: "Plan the week", kind: "weekly", credits: 20, xp: [] }).expect(201);
    await request(app).post(`/api/tasks/${t.body.id}/complete`);

    clock = new Date(2026, 10, 29, 23, 0); // Sunday, same week
    let s = await request(app).get("/api/state");
    expect(s.body.tasks[0].done).toBe(true);

    clock = new Date(2026, 10, 30, 0, 5); // Monday
    s = await request(app).get("/api/state");
    expect(s.body.tasks[0].done).toBe(false);
    expect(s.body.balance).toBe(20); // last week's credits stay
  });

  it("reopening a daily mission only undoes today's completion", async () => {
    const t = await request(app).post("/api/tasks").send({ title: "Stretch", kind: "daily", credits: 5, xp: [] }).expect(201);
    await request(app).post(`/api/tasks/${t.body.id}/complete`);
    clock = new Date(2026, 10, 27, 9, 0);
    await request(app).post(`/api/tasks/${t.body.id}/complete`);
    const s = await request(app).post(`/api/tasks/${t.body.id}/reopen`).expect(200);
    expect(s.body.tasks[0]).toMatchObject({ done: false, streak: 1 });
    expect(s.body.balance).toBe(5);
  });
});

describe("ranks", () => {
  it("starts with four example ranks", async () => {
    const s = await request(app).get("/api/state").expect(200);
    expect(s.body.ranks.map((r: { nameCyberpunk: string; nameFantasy: string }) => [r.nameCyberpunk, r.nameFantasy])).toEqual([
      ["Street Kid", "Peasant"], ["Runner", "Squire"], ["Netrunner", "Knight"], ["Chrome Legend", "Champion of the Realm"],
    ]);
  });

  it("replaces the ladder and keeps the given order", async () => {
    const ladder = [
      { nameCyberpunk: "Rookie", nameFantasy: "Novice", minOverallLevel: 0, anySkillCount: 0, anySkillLevel: 0, skills: [] },
      { nameCyberpunk: "Focused", nameFantasy: "Sage", minOverallLevel: 1, anySkillCount: 0, anySkillLevel: 0, skills: [{ skillId, minLevel: 2 }] },
    ];
    const r = await request(app).put("/api/ranks").send(ladder).expect(200);
    expect(r.body.map((x: { position: number; nameFantasy: string }) => [x.position, x.nameFantasy])).toEqual([[0, "Novice"], [1, "Sage"]]);
    await request(app).delete(`/api/skills/${skillId}`).expect(409); // used by a rank
  });

  it("locks shop items behind a rank until it's reached", async () => {
    const ranks = (await request(app).get("/api/ranks")).body as { id: number }[];
    const runner = ranks[1]!.id;
    const item = await request(app).post("/api/rewards").send({ name: "Concert", cost: 10, minRankId: runner }).expect(201);
    expect(item.body.minRankId).toBe(runner);
    // plenty of credits, but rank 1
    const t = await request(app).post("/api/tasks").send(mission({ credits: 100, xp: [] })).expect(201);
    await request(app).post(`/api/tasks/${t.body.id}/complete`);
    const locked = await request(app).post(`/api/rewards/${item.body.id}/redeem`).expect(403);
    expect(locked.body.error).toMatch(/Runner/);
    // 300 XP in Focus: overall level 2 and one skill at level 1 -> Runner
    const t2 = await request(app).post("/api/tasks").send(mission({ title: "Grind", credits: 0, xp: [{ skillId, amount: 300 }] })).expect(201);
    await request(app).post(`/api/tasks/${t2.body.id}/complete`);
    await request(app).post(`/api/rewards/${item.body.id}/redeem`).expect(200);
  });

  it("edits a shop item, including its rank", async () => {
    const ranks = (await request(app).get("/api/ranks")).body as { id: number }[];
    const item = await request(app).post("/api/rewards").send({ name: "Film", cost: 10 }).expect(201);
    expect(item.body.minRankId).toBeNull();
    const r = await request(app).put(`/api/rewards/${item.body.id}`).send({ name: "Cinema night", cost: 25, minRankId: ranks[2]!.id }).expect(200);
    expect(r.body).toMatchObject({ name: "Cinema night", cost: 25, minRankId: ranks[2]!.id });
    await request(app).put(`/api/rewards/${item.body.id}`).send({ name: "x", cost: 5, minRankId: 999 }).expect(400);
  });

  it("keeps rank ids when the ladder is edited, and protects ranks shop items need", async () => {
    const ranks = (await request(app).get("/api/ranks")).body as { id: number; nameCyberpunk: string }[];
    await request(app).post("/api/rewards").send({ name: "Trip", cost: 50, minRankId: ranks[3]!.id }).expect(201);
    const renamed = ranks.map((r) => ({ ...r, nameCyberpunk: r.nameCyberpunk + "!" }));
    const saved = await request(app).put("/api/ranks").send(renamed).expect(200);
    expect(saved.body.map((r: { id: number }) => r.id)).toEqual(ranks.map((r) => r.id));
    const r = await request(app).put("/api/ranks").send(renamed.slice(0, 3)).expect(409);
    expect(r.body.error).toMatch(/Trip/);
  });

  it("rejects a rank without names", async () => {
    const r = await request(app).put("/api/ranks").send([{ nameCyberpunk: "", nameFantasy: "x", minOverallLevel: 0, anySkillCount: 0, anySkillLevel: 0, skills: [] }]).expect(400);
    expect(r.body.error).toMatch(/name/);
  });
});

describe("upgrading a first-version database", () => {
  it("moves finished missions into the credit log", () => {
    const file = join(mkdtempSync(join(tmpdir(), "mb-")), "old.db");
    const old = new DatabaseSync(file);
    old.exec(`
      CREATE TABLE skills (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE);
      CREATE TABLE tasks (id INTEGER PRIMARY KEY, title TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('duration','window','extra')),
        credits INTEGER NOT NULL, duration_min INTEGER, day TEXT, start TEXT, "end" TEXT, xp TEXT NOT NULL DEFAULT '[]',
        done INTEGER NOT NULL DEFAULT 0, done_at TEXT, created_at TEXT NOT NULL);
      CREATE TABLE rewards (id INTEGER PRIMARY KEY, name TEXT NOT NULL, cost INTEGER NOT NULL);
      CREATE TABLE spends (id INTEGER PRIMARY KEY, reward_name TEXT NOT NULL, cost INTEGER NOT NULL, at TEXT NOT NULL);
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
      INSERT INTO meta VALUES ('seeded', '2026-11-26');
      INSERT INTO skills (id, name) VALUES (1, 'Focus');
      INSERT INTO tasks VALUES (1, 'Report', 'duration', 40, 60, NULL, NULL, NULL, '[{"skillId":1,"amount":50}]', 1, '2026-11-26T10:00:00Z', '2026-11-25T10:00:00Z');
      INSERT INTO tasks VALUES (2, 'Tidy', 'extra', 10, NULL, NULL, NULL, NULL, '[]', 0, NULL, '2026-11-25T10:00:00Z');
      INSERT INTO spends VALUES (1, 'Gaming', 30, '2026-11-26T11:00:00Z');
    `);
    old.close();

    const store = new Store(file);
    const s = store.state();
    expect(s.balance).toBe(10);
    expect(s.skillXp).toEqual({ 1: 50 });
    expect(s.tasks.map((t) => [t.title, t.done])).toEqual([["Report", true], ["Tidy", false]]);
    expect(s.skills).toHaveLength(1); // not re-seeded
    expect(s.ranks).toHaveLength(4); // example ranks added
    expect(store.addTask({ title: "Stretch", kind: "daily", credits: 5, durationMin: null, day: null, start: null, end: null, xp: [] }).kind).toBe("daily");
  });
});
