import { join } from "node:path";
import { createApp } from "./app.js";
import { Store } from "./db.js";

const port = Number(process.env.PORT ?? 8080);
const dbFile = process.env.DB_FILE ?? join(process.cwd(), "data", "mission-board.db");
const staticDir = join(import.meta.dirname, "..", "client");

const store = new Store(dbFile, process.env.SEED_DEFAULTS !== "false");
const server = createApp(store, staticDir).listen(port, () => {
  console.log(`Mission Board running on http://localhost:${port} (data: ${dbFile})`);
});

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    server.close(() => {
      store.db.close();
      process.exit(0);
    });
  });
}
