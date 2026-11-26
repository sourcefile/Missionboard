import { join } from "node:path";
import { createApp } from "./app.js";
import { Store } from "./db.js";

const port = Number(process.env.PORT ?? 8080);
const dbFile = process.env.DB_FILE ?? join(process.cwd(), "data", "mission-board.db");
const staticDir = join(import.meta.dirname, "..", "client");

const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const weekStartEnv = (process.env.WEEK_START ?? "monday").toLowerCase();
const weekStart = /^[0-6]$/.test(weekStartEnv) ? Number(weekStartEnv) : DAYS.indexOf(weekStartEnv);
if (weekStart < 0) throw new Error(`WEEK_START must be a weekday name or 0-6, got "${process.env.WEEK_START}"`);

const store = new Store(dbFile, { seed: process.env.SEED_DEFAULTS !== "false", weekStart });
const server = createApp(store, staticDir).listen(port, () => {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  console.log(`Mission Board running on http://localhost:${port} (data: ${dbFile}, time zone: ${tz}, week starts ${DAYS[weekStart]})`);
});

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    server.close(() => {
      store.db.close();
      process.exit(0);
    });
  });
}
