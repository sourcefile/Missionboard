# Mission Board

A personal task dashboard with game mechanics. Finish missions to earn **credits** you can spend on leisure activities, and **XP** that levels up your skills.

- **Timed missions** have either a duration (optionally planned for a day) or a fixed start and end time. They are flagged *Today*, *Live now* or *Overdue*.
- **Extra missions** have no hard deadline.
- Each mission pays out credits and can train **up to 3 skills** with XP.
- The **leisure shop** lists activities with a credit price. Redeeming one deducts the credits and records it in the credit log.

## Game rules (first version, easy to change)

| Rule | Current value | Where |
|---|---|---|
| Suggested credits for timed missions | 1 credit per 2 minutes, at least 5 | `src/shared/game.ts` → `suggestCredits` |
| Suggested credits for extra missions | 10 | same |
| Skill levels | Level 1 at 100 XP, 2 at 300, 3 at 600, 4 at 1000 (`50 × L × (L+1)`) | `xpForLevel` |
| Operator level (header) | Same curve, using total XP across all skills | `src/client/App.tsx` |
| Reopening or deleting a finished mission | Blocked if its credits are already spent | `src/server/app.ts` |
| Starter skills and shop items | Focus, Fitness, Learning, Creativity; four leisure items | `src/server/db.ts` (only on a brand-new database) |

## Run it with Docker

```bash
docker compose up -d --build
```

Open http://localhost:8080. Data is stored in SQLite on the `mission-board-data` volume, so it survives restarts and upgrades.

Every push to `main` also publishes an image to GitHub Container Registry:

```bash
docker run -d -p 8080:8080 -v mission-board-data:/data ghcr.io/sourcefile/missionboard:latest
```

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `8080` | Port the server listens on |
| `DB_FILE` | `/data/mission-board.db` (Docker) | SQLite database location |
| `SEED_DEFAULTS` | `true` | Add starter skills and shop items to a new database |

## Develop

Requires Node.js 22.13 or newer (uses the built-in `node:sqlite`).

```bash
npm install
npm run dev        # API on :8080, dashboard with hot reload on :5173
npm run typecheck
npm test
npm run build && npm start
```

## Project layout

```
src/shared/   game rules and types used by both sides (+ tests)
src/server/   Express API and SQLite storage (+ API tests)
src/client/   React dashboard (+ component test)
.github/workflows/ci.yml   typecheck, test, build, Docker build, container smoke test, publish on main
```

## Pipeline

`.github/workflows/ci.yml` runs on every push and pull request:

1. **Typecheck, test and build**: `npm ci`, `tsc`, Vitest, Vite + tsc build; the build output is kept as a workflow artifact.
2. **Docker image**: builds the image, starts it and checks `/api/health`, `/api/state` and the dashboard page. On `main` the image is pushed to `ghcr.io/<owner>/<repo>` as `latest` and `sha-<commit>`.
