import { describe, expect, it } from "vitest";
import { DEFAULT_RANKS, progressFrom, rankStatus, requirementsOf, validateRanks, type Rank } from "./ranks";

const ladder: Rank[] = DEFAULT_RANKS.map((r, i) => ({ ...r, id: i + 1, position: i }));

describe("ranks", () => {
  it("starts everyone at the first default rank", () => {
    expect(rankStatus(ladder, progressFrom({}, [1, 2]))).toEqual({ current: 0, next: 1 });
  });

  it("needs every requirement of a rank", () => {
    // 300 XP in one skill: overall level 2, that skill level 2 -> Runner (needs overall 2 + one skill at 1)
    expect(rankStatus(ladder, progressFrom({ 1: 300 }, [1, 2])).current).toBe(1);
    // overall level 4 (1000 XP) but only one skill levelled -> still Runner, Netrunner needs 2 skills at level 2
    const p = progressFrom({ 1: 1000 }, [1, 2]);
    expect(rankStatus(ladder, p).current).toBe(1);
    expect(requirementsOf(ladder[2]!, p).map((r) => [r.label, r.met])).toEqual([["Overall level 4", true], ["2 skills at level 2+", false]]);
    // add a second skill at level 2 -> Netrunner
    expect(rankStatus(ladder, progressFrom({ 1: 1000, 2: 300 }, [1, 2])).current).toBe(2);
  });

  it("supports specific skill requirements", () => {
    const custom: Rank[] = [
      { ...ladder[0]!, id: 1 },
      { id: 2, position: 1, nameCyberpunk: "Medic", nameFantasy: "Healer", minOverallLevel: 0, anySkillCount: 0, anySkillLevel: 0, skills: [{ skillId: 2, minLevel: 2 }] },
    ];
    expect(rankStatus(custom, progressFrom({ 1: 5000 }, [1, 2])).current).toBe(0);
    expect(rankStatus(custom, progressFrom({ 2: 300 }, [1, 2]))).toEqual({ current: 1, next: null });
  });

  it("orders by position, not by list order", () => {
    const shuffled = [ladder[3]!, ladder[0]!, ladder[2]!, ladder[1]!];
    expect(rankStatus(shuffled, progressFrom({ 1: 300 }, [1])).current).toBe(1);
  });

  it("validates a ladder", () => {
    expect(validateRanks(DEFAULT_RANKS).ok).toBe(true);
    expect(validateRanks([]).ok).toBe(false);
    expect(validateRanks([{ ...DEFAULT_RANKS[0], nameFantasy: " " }]).ok).toBe(false);
    expect(validateRanks([{ ...DEFAULT_RANKS[0], skills: [{ skillId: 9, minLevel: 2 }] }], new Set([1])).ok).toBe(false);
    expect(validateRanks([{ ...DEFAULT_RANKS[0], minOverallLevel: -1 }]).ok).toBe(false);
  });
});
