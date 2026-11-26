// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { App } from "./App";
import type { BoardState } from "../shared/game";

const state: BoardState = {
  balance: 40,
  skills: [{ id: 1, name: "Focus" }],
  rewards: [{ id: 1, name: "30 min of gaming", cost: 30 }, { id: 2, name: "Night out", cost: 200 }],
  spends: [],
  tasks: [
    { id: 1, title: "Write report", kind: "duration", credits: 25, durationMin: 50, day: null, start: null, end: null, xp: [{ skillId: 1, amount: 40 }], done: false, doneAt: null, createdAt: "2026-11-26T10:00:00Z" },
    { id: 2, title: "Tidy desk", kind: "extra", credits: 10, durationMin: null, day: null, start: null, end: null, xp: [], done: false, doneAt: null, createdAt: "2026-11-26T10:00:00Z" },
  ],
};

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("dashboard", () => {
  it("shows missions, credits and which rewards are affordable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(state), { headers: { "Content-Type": "application/json" } })));
    render(<App />);
    expect(await screen.findByText("Write report")).toBeTruthy();
    expect(screen.getByText("Tidy desk")).toBeTruthy();
    expect(screen.getByText("+40 XP")).toBeTruthy();
    const buttons = screen.getAllByRole("button").filter((b) => b.className.includes("btn-buy"));
    expect(buttons.map((b) => [b.textContent, (b as HTMLButtonElement).disabled])).toEqual([["Redeem", false], ["−160", true]]);
  });

  it("explains when the server can't be reached", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    render(<App />);
    expect(await screen.findByText(/Can't reach the Mission Board server/)).toBeTruthy();
  });
});
