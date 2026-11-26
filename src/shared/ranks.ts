// Configurable rank ladder. A rank is reached when ALL of its requirements are met;
// your rank is the highest one on the ladder you qualify for.

import { levelOf } from "./game.js";

export interface SkillRequirement {
  skillId: number;
  minLevel: number;
}

export interface RankInput {
  /** Set when editing an existing rank, so shop items that require it keep pointing at it. */
  id?: number;
  nameCyberpunk: string;
  nameFantasy: string;
  /** Overall (operator / hero) level, from total XP across all skills. 0 = no requirement. */
  minOverallLevel: number;
  /** "At least `anySkillCount` skills at level `anySkillLevel` or higher". 0 count = no requirement. */
  anySkillCount: number;
  anySkillLevel: number;
  /** Specific skills that must reach a level. */
  skills: SkillRequirement[];
}

export interface Rank extends RankInput {
  id: number;
  position: number; // 0 = lowest rank
}

export const MAX_RANKS = 12;

/** Four example ranks, seeded once. */
export const DEFAULT_RANKS: RankInput[] = [
  { nameCyberpunk: "Street Kid", nameFantasy: "Peasant", minOverallLevel: 0, anySkillCount: 0, anySkillLevel: 0, skills: [] },
  { nameCyberpunk: "Runner", nameFantasy: "Squire", minOverallLevel: 2, anySkillCount: 1, anySkillLevel: 1, skills: [] },
  { nameCyberpunk: "Netrunner", nameFantasy: "Knight", minOverallLevel: 4, anySkillCount: 2, anySkillLevel: 2, skills: [] },
  { nameCyberpunk: "Chrome Legend", nameFantasy: "Champion of the Realm", minOverallLevel: 7, anySkillCount: 3, anySkillLevel: 3, skills: [] },
];

export interface Requirement {
  label: string;
  have: number;
  need: number;
  met: boolean;
}

export interface Progress {
  overallLevel: number;
  skillLevels: Map<number, number>;
}

export function progressFrom(skillXp: Record<number, number> | Map<number, number>, skillIds: number[]): Progress {
  const xp = skillXp instanceof Map ? skillXp : new Map(Object.entries(skillXp).map(([k, v]) => [Number(k), v]));
  const total = [...xp.values()].reduce((a, b) => a + b, 0);
  return {
    overallLevel: levelOf(total),
    skillLevels: new Map(skillIds.map((id) => [id, levelOf(xp.get(id) ?? 0)])),
  };
}

export function requirementsOf(rank: RankInput, p: Progress, skillName: (id: number) => string = (id) => `Skill ${id}`): Requirement[] {
  const out: Requirement[] = [];
  if (rank.minOverallLevel > 0) {
    out.push({ label: `Overall level ${rank.minOverallLevel}`, have: p.overallLevel, need: rank.minOverallLevel, met: p.overallLevel >= rank.minOverallLevel });
  }
  if (rank.anySkillCount > 0) {
    const have = [...p.skillLevels.values()].filter((l) => l >= rank.anySkillLevel).length;
    const what = rank.anySkillCount === 1 ? "1 skill" : `${rank.anySkillCount} skills`;
    out.push({ label: `${what} at level ${rank.anySkillLevel}+`, have, need: rank.anySkillCount, met: have >= rank.anySkillCount });
  }
  for (const s of rank.skills) {
    const have = p.skillLevels.get(s.skillId) ?? 0;
    out.push({ label: `${skillName(s.skillId)} level ${s.minLevel}`, have, need: s.minLevel, met: have >= s.minLevel });
  }
  return out;
}

export const qualifies = (rank: RankInput, p: Progress) => requirementsOf(rank, p).every((r) => r.met);

export interface RankStatus {
  /** Index into the sorted ladder, or -1 if not even the first rank is met. */
  current: number;
  next: number | null;
}

/** The highest rank whose requirements are all met. Ranks are sorted by position first. */
export function rankStatus(ranks: Rank[], p: Progress): RankStatus {
  const ladder = [...ranks].sort((a, b) => a.position - b.position);
  let current = -1;
  ladder.forEach((r, i) => { if (qualifies(r, p)) current = i; });
  return { current, next: current + 1 < ladder.length ? current + 1 : null };
}

type Result<T> = { ok: true; value: T } | { ok: false; error: string };
const isInt = (n: unknown, min: number, max: number): n is number => typeof n === "number" && Number.isInteger(n) && n >= min && n <= max;

/** Validates a whole ladder, lowest rank first. */
export function validateRanks(raw: unknown, knownSkills?: Set<number>): Result<RankInput[]> {
  if (!Array.isArray(raw) || raw.length === 0) return { ok: false, error: "Add at least one rank." };
  if (raw.length > MAX_RANKS) return { ok: false, error: `Use at most ${MAX_RANKS} ranks.` };
  const out: RankInput[] = [];
  for (const [i, r] of (raw as Record<string, unknown>[]).entries()) {
    const n = i + 1;
    if (!r || typeof r !== "object") return { ok: false, error: `Rank ${n} is malformed.` };
    const nameCyberpunk = typeof r.nameCyberpunk === "string" ? r.nameCyberpunk.trim() : "";
    const nameFantasy = typeof r.nameFantasy === "string" ? r.nameFantasy.trim() : "";
    if (!nameCyberpunk || !nameFantasy) return { ok: false, error: `Rank ${n} needs both a cyberpunk and a fantasy name.` };
    if (nameCyberpunk.length > 40 || nameFantasy.length > 40) return { ok: false, error: `Keep rank ${n}'s names under 40 characters.` };
    if (!isInt(r.minOverallLevel, 0, 100)) return { ok: false, error: `Rank ${n}: overall level must be a whole number from 0 to 100.` };
    if (!isInt(r.anySkillCount, 0, 50)) return { ok: false, error: `Rank ${n}: number of skills must be from 0 to 50.` };
    if (!isInt(r.anySkillLevel, 0, 100)) return { ok: false, error: `Rank ${n}: skill level must be from 0 to 100.` };
    const skillsRaw = Array.isArray(r.skills) ? (r.skills as Record<string, unknown>[]) : [];
    const seen = new Set<number>();
    const skills: SkillRequirement[] = [];
    for (const s of skillsRaw) {
      if (!s || !isInt(s.skillId, 1, Number.MAX_SAFE_INTEGER) || !isInt(s.minLevel, 1, 100)) return { ok: false, error: `Rank ${n}: each skill requirement needs a skill and a level from 1 to 100.` };
      if (seen.has(s.skillId)) return { ok: false, error: `Rank ${n}: each skill can only be listed once.` };
      if (knownSkills && !knownSkills.has(s.skillId)) return { ok: false, error: `Rank ${n} uses a skill that no longer exists.` };
      seen.add(s.skillId);
      skills.push({ skillId: s.skillId, minLevel: s.minLevel });
    }
    const id = isInt(r.id, 1, Number.MAX_SAFE_INTEGER) ? r.id : undefined;
    if (id !== undefined && out.some((x) => x.id === id)) return { ok: false, error: `Rank ${n} is listed twice.` };
    out.push({ ...(id !== undefined ? { id } : {}), nameCyberpunk, nameFantasy, minOverallLevel: r.minOverallLevel, anySkillCount: r.anySkillCount, anySkillLevel: r.anySkillLevel, skills });
  }
  return { ok: true, value: out };
}

/**
 * Can someone at ladder index `currentIndex` buy an item that needs `minRankId`?
 * Unknown rank ids (shouldn't happen) count as unrestricted.
 */
export function meetsRank(ranks: Rank[], currentIndex: number, minRankId: number | null): boolean {
  if (minRankId == null) return true;
  const ladder = [...ranks].sort((a, b) => a.position - b.position);
  const need = ladder.findIndex((r) => r.id === minRankId);
  return need < 0 || currentIndex >= need;
}
