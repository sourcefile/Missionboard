import type { BoardState, Reward, Skill, Task, TaskInput } from "../shared/game";
import type { Rank, RankInput } from "../shared/ranks";

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `Request failed (${res.status}).`);
  return data as T;
}

export const api = {
  state: () => call<BoardState>("GET", "/api/state"),
  addTask: (t: TaskInput) => call<Task>("POST", "/api/tasks", t),
  updateTask: (id: number, t: TaskInput) => call<Task>("PUT", `/api/tasks/${id}`, t),
  complete: (id: number) => call<BoardState>("POST", `/api/tasks/${id}/complete`),
  reopen: (id: number) => call<BoardState>("POST", `/api/tasks/${id}/reopen`),
  completeSubtask: (id: number, sid: number) => call<BoardState>("POST", `/api/tasks/${id}/subtasks/${sid}/complete`),
  reopenSubtask: (id: number, sid: number) => call<BoardState>("POST", `/api/tasks/${id}/subtasks/${sid}/reopen`),
  deleteTask: (id: number) => call<void>("DELETE", `/api/tasks/${id}`),
  addSkill: (name: string) => call<Skill>("POST", "/api/skills", { name }),
  deleteSkill: (id: number) => call<void>("DELETE", `/api/skills/${id}`),
  addReward: (r: { name: string; cost: number; minRankId: number | null }) => call<Reward>("POST", "/api/rewards", r),
  updateReward: (id: number, r: { name: string; cost: number; minRankId: number | null }) => call<Reward>("PUT", `/api/rewards/${id}`, r),
  deleteReward: (id: number) => call<void>("DELETE", `/api/rewards/${id}`),
  saveRanks: (ranks: RankInput[]) => call<Rank[]>("PUT", "/api/ranks", ranks),
  redeem: (id: number) => call<BoardState>("POST", `/api/rewards/${id}/redeem`),
};
