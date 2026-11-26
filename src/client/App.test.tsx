// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { App } from "./App";
import type { BoardState, Task } from "../shared/game";

const base = { durationMin: null, day: null, start: null, end: null, xp: [], done: false, doneAt: null, streak: 0, createdAt: "2026-11-26T10:00:00Z" };
const task = (t: Partial<Task> & Pick<Task, "id" | "title" | "kind" | "credits">): Task => ({ ...base, ...t });

const state: BoardState = {
  balance: 40,
  weekStart: 1,
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

  it("explains when the server can't be reached", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    render(<App />);
    expect(await screen.findByText(/Can't reach the Mission Board server/)).toBeTruthy();
  });
});
