// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { App } from "./App";
import type { BoardState, Task } from "../shared/game";
import { DEFAULT_RANKS } from "../shared/ranks";

const base = { durationMin: null, day: null, start: null, end: null, xp: [], done: false, doneAt: null, streak: 0, createdAt: "2026-11-26T10:00:00Z" };
const task = (t: Partial<Task> & Pick<Task, "id" | "title" | "kind" | "credits">): Task => ({ ...base, ...t });

const state: BoardState = {
  balance: 40,
  weekStart: 1,
  ranks: DEFAULT_RANKS.map((r, i) => ({ ...r, id: i + 1, position: i })),
  skills: [{ id: 1, name: "Focus" }],
  skillXp: { 1: 120 },
  rewards: [{ id: 1, name: "30 min of gaming", cost: 30 }, { id: 2, name: "Night out", cost: 200 }],
  spends: [],
  completions: [],
  tasks: [
    task({ id: 1, title: "Write report", kind: "duration", credits: 25, durationMin: 50, xp: [{ skillId: 1, amount: 40 }] }),
    task({ id: 2, title: "Tidy desk", kind: "extra", credits: 10 }),
    task({ id: 3, title: "Stretch", kind: "daily", credits: 5, streak: 4 }),
  ],
};

const serve = () => vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(state), { headers: { "Content-Type": "application/json" } })));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear(); });

describe("dashboard", () => {
  it("shows missions, credits and which rewards are affordable", async () => {
    serve();
    render(<App />);
    expect(await screen.findByText("Write report")).toBeTruthy();
    expect(screen.getByText("Tidy desk")).toBeTruthy();
    expect(screen.getByText("+40 XP")).toBeTruthy();
    const buttons = screen.getAllByRole("button").filter((b) => b.className.includes("btn-buy"));
    expect(buttons.map((b) => [b.textContent, (b as HTMLButtonElement).disabled])).toEqual([["Redeem", false], ["−160", true]]);
  });

  it("groups daily missions and shows their streak", async () => {
    serve();
    render(<App />);
    expect(await screen.findByText("Stretch")).toBeTruthy();
    expect(screen.getByText("Daily", { selector: ".group" })).toBeTruthy();
    expect(screen.getByText("Streak 4")).toBeTruthy();
  });

  it("switches between cyberpunk and fantasy and remembers it", async () => {
    serve();
    render(<App />);
    await screen.findByText("Write report");
    fireEvent.click(screen.getByRole("radio", { name: "Fantasy" }));
    expect(document.documentElement.dataset.skin).toBe("fantasy");
    expect(screen.getByRole("heading", { level: 2, name: "Quests" })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Buy" })).toHaveLength(1);
    expect(localStorage.getItem("mb-skin")).toBe("fantasy");
  });

  it("shows the current rank in the active look and lets you edit the ladder", async () => {
    serve(); // 120 XP: overall level 1, so the first rank (Runner needs overall 2)
    render(<App />);
    await screen.findByText("Write report");
    expect(screen.getByText("Street Kid", { selector: ".hud-rank-name" })).toBeTruthy();
    expect(screen.getByText("Your rank")).toBeTruthy();
    expect(screen.getByText("Overall level 2 (1/2)")).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "Fantasy" }));
    expect(screen.getByText("Peasant", { selector: ".hud-rank-name" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Edit ranks" }));
    expect(screen.getAllByRole("group", { name: /Rank \d/ })).toHaveLength(4);
    fireEvent.click(screen.getByRole("button", { name: "+ Add rank" }));
    expect(screen.getAllByRole("group", { name: /Rank \d/ })).toHaveLength(5);
  });

  it("explains when the server can't be reached", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    render(<App />);
    expect(await screen.findByText(/Can't reach the Mission Board server/)).toBeTruthy();
  });
});
