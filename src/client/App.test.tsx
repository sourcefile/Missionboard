// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { App } from "./App";
import type { BoardState, Task } from "../shared/game";
import { DEFAULT_RANKS } from "../shared/ranks";

const base = { durationMin: null, day: null, start: null, end: null, xp: [], subtasks: [], done: false, doneAt: null, streak: 0, createdAt: "2026-11-26T10:00:00Z" };
const task = (t: Partial<Task> & Pick<Task, "id" | "title" | "kind" | "credits">): Task => ({ ...base, ...t });

const state: BoardState = {
  balance: 40,
  weekStart: 1,
  ranks: DEFAULT_RANKS.map((r, i) => ({ ...r, id: i + 1, position: i })),
  skills: [{ id: 1, name: "Focus" }, { id: 2, name: "Fitness" }],
  skillXp: { 1: 120 },
  rewards: [{ id: 1, name: "30 min of gaming", cost: 30, minRankId: null }, { id: 2, name: "Night out", cost: 200, minRankId: null }, { id: 3, name: "Weekend trip", cost: 20, minRankId: 3 }],
  spends: [],
  completions: [],
  tasks: [
    task({ id: 1, title: "Write report", kind: "duration", credits: 25, durationMin: 50, xp: [{ skillId: 1, amount: 40 }] }),
    task({ id: 2, title: "Tidy desk", kind: "extra", credits: 10 }),
    task({ id: 3, title: "Stretch", kind: "daily", credits: 5, streak: 4, xp: [{ skillId: 2, amount: 10 }] }),
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
    expect(buttons.map((b) => [b.textContent, (b as HTMLButtonElement).disabled])).toEqual([["Redeem", false], ["−160", true], ["Locked", true]]);
    expect(screen.getByText("Needs Netrunner")).toBeTruthy();
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
    expect(screen.getByText("Needs Knight")).toBeTruthy();
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

  it("searches missions by title and filters them by skill", async () => {
    serve();
    render(<App />);
    await screen.findByText("Write report");
    const search = screen.getByRole("searchbox", { name: "Search missions by title" });
    fireEvent.change(search, { target: { value: "REP" } });
    expect(screen.getByText("Write report")).toBeTruthy();
    expect(screen.queryByText("Tidy desk")).toBeNull();
    expect(screen.getByText("Showing 1 of 3")).toBeTruthy();
    fireEvent.change(search, { target: { value: "" } });

    const skills = screen.getByRole("group", { name: "Filter by skill" });
    const fitness = within(skills).getByRole("button", { name: "Fitness" });
    fireEvent.click(fitness);
    expect(fitness.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("Stretch")).toBeTruthy();
    expect(screen.queryByText("Write report")).toBeNull();
    fireEvent.click(within(skills).getByRole("button", { name: "Focus" }));
    expect(screen.getByText("Write report")).toBeTruthy();
    expect(screen.getByText("Showing 2 of 3")).toBeTruthy();

    fireEvent.change(search, { target: { value: "nothing like this" } });
    expect(screen.getByText("No missions match")).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "Clear filters" })[0]!);
    expect(screen.getByText("Tidy desk")).toBeTruthy();
    expect((search as HTMLInputElement).value).toBe("");
    expect(fitness.getAttribute("aria-pressed")).toBe("false");
  });

  it("shows an operation's subtasks, named Raid in the fantasy look", async () => {
    const op = task({
      id: 4, title: "Launch website", kind: "operation", credits: 50, xp: [{ skillId: 2, amount: 30 }],
      subtasks: [
        { id: 11, title: "Write copy", credits: 20, xp: [{ skillId: 1, amount: 15 }], done: true, doneAt: "2026-11-26T11:00:00Z" },
        { id: 12, title: "Go live", credits: 10, xp: [], done: false, doneAt: null },
      ],
    });
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ ...state, tasks: [...state.tasks, op] }), { headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    render(<App />);
    expect(await screen.findByText("Launch website")).toBeTruthy();
    expect(screen.getByText("Operation", { selector: ".tag" })).toBeTruthy();
    expect(screen.getByText("Operations", { selector: ".group" })).toBeTruthy();
    expect(screen.getByRole("img", { name: "1 of 2 subtasks done" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Complete Go live" }));
    expect(fetchMock).toHaveBeenCalledWith("/api/tasks/4/subtasks/12/complete", expect.objectContaining({ method: "POST" }));

    // Search finds subtasks; the skill filter counts subtask XP.
    fireEvent.change(screen.getByRole("searchbox", { name: "Search missions by title" }), { target: { value: "go live" } });
    expect(screen.getByText("Launch website")).toBeTruthy();

    fireEvent.click(screen.getByRole("radio", { name: "Fantasy" }));
    expect(screen.getByText("Raid", { selector: ".tag" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Raids" })).toBeTruthy();
  });

  it("builds an operation with subtasks in the form", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify(state), { headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    render(<App />);
    await screen.findByText("Write report");
    fireEvent.click(screen.getByRole("button", { name: "+ New mission" }));
    fireEvent.change(screen.getByPlaceholderText("e.g. Finish quarterly report"), { target: { value: "Launch website" } });
    fireEvent.click(screen.getByRole("radio", { name: /Operation/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "Subtask 1" }), { target: { value: "Write copy" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: "CR for subtask 1" }), { target: { value: "30" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Skill for subtask 1" }), { target: { value: "1" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Subtask 2" }), { target: { value: "Go live" } });
    expect(screen.getByText(/Suggested: 10 CR/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add mission" }));
    await vi.waitFor(() => expect(fetchMock.mock.calls.some(([u, i]) => u === "/api/tasks" && i?.method === "POST")).toBe(true));
    const [, init] = fetchMock.mock.calls.find(([u, i]) => u === "/api/tasks" && i?.method === "POST")!;
    expect(JSON.parse(String(init!.body))).toMatchObject({
      kind: "operation",
      credits: 10,
      subtasks: [{ title: "Write copy", credits: 30, xp: [{ skillId: 1, amount: 10 }] }, { title: "Go live", credits: 10, xp: [] }],
    });
  });

  it("explains when the server can't be reached", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    render(<App />);
    expect(await screen.findByText(/Can't reach the Mission Board server/)).toBeTruthy();
  });
});
