import express, { type Request, type Response, type NextFunction } from "express";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { validateTask } from "../shared/game.js";
import type { Store } from "./db.js";

const idOf = (req: Request): number => {
  const id = Number(req.params.id);
  return Number.isInteger(id) && id > 0 ? id : -1;
};
const fail = (res: Response, status: number, error: string) => res.status(status).json({ error });

export function createApp(store: Store, staticDir?: string) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "32kb" }));

  app.get("/api/health", (_req, res) => { res.json({ ok: true }); });
  app.get("/api/state", (_req, res) => { res.json(store.state()); });

  // Missions
  app.post("/api/tasks", (req, res) => {
    const v = validateTask(req.body, new Set(store.skills().map((s) => s.id)));
    if (!v.ok) return fail(res, 400, v.error);
    res.status(201).json(store.addTask(v.value));
  });
  app.put("/api/tasks/:id", (req, res) => {
    const id = idOf(req);
    if (!store.task(id)) return fail(res, 404, "Mission not found.");
    const v = validateTask(req.body, new Set(store.skills().map((s) => s.id)));
    if (!v.ok) return fail(res, 400, v.error);
    res.json(store.updateTask(id, v.value));
  });
  app.post("/api/tasks/:id/complete", (req, res) => {
    const t = store.task(idOf(req));
    if (!t) return fail(res, 404, "Mission not found.");
    if (!t.done) store.setDone(t.id, true);
    res.json(store.state());
  });
  app.post("/api/tasks/:id/reopen", (req, res) => {
    const t = store.task(idOf(req));
    if (!t) return fail(res, 404, "Mission not found.");
    if (t.done) {
      if (store.balance() - t.credits < 0) return fail(res, 409, "You've already spent these credits, so this mission can't be reopened.");
      store.setDone(t.id, false);
    }
    res.json(store.state());
  });
  app.delete("/api/tasks/:id", (req, res) => {
    const t = store.task(idOf(req));
    if (!t) return fail(res, 404, "Mission not found.");
    if (t.done && store.balance() - t.credits < 0) return fail(res, 409, "You've already spent this mission's credits, so it can't be deleted.");
    store.deleteTask(t.id);
    res.status(204).end();
  });

  // Skills
  app.post("/api/skills", (req, res) => {
    const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
    if (!name || name.length > 40) return fail(res, 400, "Give the skill a name of up to 40 characters.");
    if (store.hasSkillNamed(name)) return fail(res, 409, "You already have that skill.");
    res.status(201).json(store.addSkill(name));
  });
  app.delete("/api/skills/:id", (req, res) => {
    const id = idOf(req);
    if (store.tasks().some((t) => t.xp.some((g) => g.skillId === id))) return fail(res, 409, "Missions still give XP to this skill. Remove it from them first.");
    if (!store.deleteSkill(id)) return fail(res, 404, "Skill not found.");
    res.status(204).end();
  });

  // Leisure shop
  app.post("/api/rewards", (req, res) => {
    const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
    const cost = req.body?.cost;
    if (!name || name.length > 60) return fail(res, 400, "Give the activity a name of up to 60 characters.");
    if (!Number.isInteger(cost) || cost < 1 || cost > 100000) return fail(res, 400, "The cost must be a whole number above 0.");
    res.status(201).json(store.addReward(name, cost));
  });
  app.delete("/api/rewards/:id", (req, res) => {
    if (!store.deleteReward(idOf(req))) return fail(res, 404, "Activity not found.");
    res.status(204).end();
  });
  app.post("/api/rewards/:id/redeem", (req, res) => {
    const r = store.reward(idOf(req));
    if (!r) return fail(res, 404, "Activity not found.");
    const balance = store.balance();
    if (balance < r.cost) return fail(res, 409, `You need ${r.cost - balance} more credits for this.`);
    store.addSpend(r.name, r.cost);
    res.json(store.state());
  });

  app.use("/api", (_req, res) => { fail(res, 404, "Unknown endpoint."); });

  // Dashboard (built files)
  if (staticDir && existsSync(staticDir)) {
    app.use(express.static(staticDir, { index: false, maxAge: "1h" }));
    app.get(/.*/, (_req, res) => { res.sendFile(join(staticDir, "index.html")); });
  }

  app.use((err: Error & { status?: number; type?: string }, _req: Request, res: Response, _next: NextFunction) => {
    if (err.type === "entity.parse.failed") return fail(res, 400, "The request body isn't valid JSON.");
    console.error(err);
    fail(res, err.status ?? 500, "Something went wrong on the server.");
  });

  return app;
}
