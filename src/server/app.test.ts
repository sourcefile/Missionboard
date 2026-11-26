import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "./app";
import { Store } from "./db";

let app: ReturnType<typeof createApp>;
let skillId: number;

beforeEach(() => {
  const store = new Store(":memory:", false);
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
    await request(app).delete(`/api/tasks/${t.body.id}`).expect(409);
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
