# Mission Board

A personal task dashboard with game mechanics. Finish missions to earn **credits** you can spend on leisure activities, and **XP** that levels up your skills.

- Missions can be **timed** (a duration or a fixed start and end), **daily**, **weekly**, or **extra** (no deadline).
- Each mission pays out credits and can train **up to 3 skills** with XP.
- The **leisure shop** lists activities with a credit price. Redeeming one deducts the credits and records it in the credit log.
- Two looks: **Cyberpunk** and **Fantasy**.
- **Search and filter:** type in the search box above the missions list to find missions by title, and tap one or more skills to show only missions that give XP to those skills. Both work in every tab, and "Clear filters" resets them.

## Mission types

| Type | When it's due | What "done" means |
|---|---|---|
| Timed · duration | Takes a set number of minutes, optionally planned for a day (flagged *Today* / *Overdue*) | Done once |
| Timed · start/end | Fixed start and end time (flagged *Today* / *Live now* / *Overdue*) | Done once |
| Daily | Every day, optional duration | Done for today. Refreshes at midnight and can be completed (and paid out) again |
| Weekly | Every week, optional duration | Done for this week. Refreshes on the first day of the week (Monday by default) |
| Extra | No deadline | Done once |

Daily and weekly missions show a **streak**: how many days or weeks in a row you completed them. Every completion is recorded in the credit log, so credits and XP you earned stay earned, even if you delete the mission later.

## Ranks

Your rank shows in the header and in the **Ranks** panel. A rank is reached when *all* of its requirements are met, and your rank is the highest one you qualify for. Each rank can require:

- an **overall level** (the operator / hero level from your total XP),
- **at least N skills at level L** (any skills), and/or
- **specific skills** at a minimum level.

Each rank has a cyberpunk name and a fantasy name; the active look decides which one is shown. Click **Edit ranks** to rename, add (up to 12), remove or reorder them. A board starts with four example ranks:

| # | Cyberpunk | Fantasy | Requirements |
|---|---|---|---|
| 1 | Street Kid | Peasant | none |
| 2 | Runner | Squire | overall level 2, 1 skill at level 1+ |
| 3 | Netrunner | Knight | overall level 4, 2 skills at level 2+ |
| 4 | Chrome Legend | Champion of the Realm | overall level 7, 3 skills at level 3+ |

A skill that a rank requires can't be deleted until the rank no longer uses it.

**Rank-locked rewards.** Every leisure shop item has an **Edit** button for its name, price and **minimum rank**. An item with a minimum rank shows which rank unlocks it and can't be bought until you reach that rank (the server enforces this too). Renaming or reordering ranks keeps these links; a rank that shop items still require can't be removed until you change those items.

## Looks

Switch between **Cyberpunk** (neon HUD) and **Fantasy** (parchment quest board) with the toggle under the title. The choice is remembered per browser. In the fantasy look, missions become quests, credits become gold and the shop becomes the tavern; the data is the same.

## Game rules (easy to change)

| Rule | Current value | Where |
|---|---|---|
| Suggested credits for timed missions | 1 credit per 2 minutes, at least 5 | `src/shared/game.ts` → `suggestCredits` |
| Suggested credits without a time (extra, daily/weekly without duration) | 10 | same |
| Skill levels | Level 1 at 100 XP, 2 at 300, 3 at 600, 4 at 1000 (`50 × L × (L+1)`) | `xpForLevel` |
| Operator / hero level (header) | Same curve, using total XP across all skills | `src/client/App.tsx` |
| Reopening a finished mission | Takes back its credits; blocked if they're already spent | `src/server/app.ts` |
| Deleting a mission | Always allowed; earned credits and XP stay in the log | same |
| Example ranks | Four ranks (see above), added once | `src/shared/ranks.ts` → `DEFAULT_RANKS` |
| Starter skills and shop items | Focus, Fitness, Learning, Creativity; four leisure items | `src/server/db.ts` (only on a brand-new database) |

## Run it with Docker

```bash
docker compose up -d --build
```

Open http://localhost:8080. To update after pulling new code, run the same command again; your data is kept.

Every push to `main` also publishes an image to GitHub Container Registry:

```bash
docker run -d -p 8080:8080 -v mission-board-data:/data -e TZ=Europe/Amsterdam ghcr.io/sourcefile/missionboard:latest
```

### Where your data is stored

Everything (missions, skills, shop, credit log) is in one SQLite file, `/data/mission-board.db` inside the container. `/data` is a Docker volume, so the data survives restarts, rebuilds and upgrades. You have two options in `docker-compose.yml`:

- **Named volume (default):** `mission-board-data:/data`. Docker manages it. In Docker Desktop it appears under **Volumes**, named after the project folder, e.g. `missionboard_mission-board-data`.
- **Folder on your computer:** replace that line with a bind mount such as `./data:/data` or `G:/MissionBoardData:/data`. The database file then sits in that folder, which makes it easy to back up or sync.

Back up the named volume to a file in the current folder:

```bash
docker compose stop
docker run --rm -v missionboard_mission-board-data:/data -v "$PWD":/backup alpine tar czf /backup/mission-board-backup.tgz -C /data .
docker compose start
```

Restore it with `tar xzf` the same way (into an empty volume). `docker compose down` keeps the volume; only `docker compose down -v` or deleting it in Docker Desktop removes your data.

Upgrading from the first version converts the database automatically (finished missions move into the credit log).

### Settings

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `8080` | Port the server listens on inside the container |
| `DB_FILE` | `/data/mission-board.db` (Docker) | SQLite database location |
| `TZ` | `Europe/Amsterdam` in compose, UTC otherwise | Time zone for midnight and start-of-week refreshes |
| `WEEK_START` | `monday` | First day of the week for weekly missions (`monday`…`sunday`, or 0–6 with 0 = Sunday) |
| `SEED_DEFAULTS` | `true` | Add starter skills and shop items to a new database |

To use another port on your computer, change the left side of `ports`, e.g. `"9000:8080"`.

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
src/shared/   game rules, ranks and types used by both sides (+ tests)
src/server/   Express API, SQLite storage and schema upgrades (+ API tests)
src/client/   React dashboard (+ component test)
.github/workflows/ci.yml   typecheck, test, build, Docker build, container smoke test, publish on main
```

## Pipeline

`.github/workflows/ci.yml` runs on every push and pull request:

1. **Typecheck, test and build**: `npm ci`, `tsc`, Vitest, Vite + tsc build; the build output is kept as a workflow artifact.
2. **Docker image**: builds the image, starts it and checks `/api/health`, `/api/state` and the dashboard page. On `main` the image is pushed to `ghcr.io/<owner>/<repo>` as `latest` and `sha-<commit>`.
