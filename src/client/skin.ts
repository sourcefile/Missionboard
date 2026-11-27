export type SkinName = "cyberpunk" | "fantasy";

export interface Skin {
  name: SkinName;
  label: string;
  kicker: string;
  title: string;
  currency: string; // short unit after numbers
  currencyName: string;
  missions: string;
  mission: string;
  newMission: string;
  level: string;
  lv: string;
  shop: string;
  redeem: string;
  log: string;
  boot: string;
  completed: (credits: number) => string;
  levelUp: string;
  rankUp: string;
  /** The mission type with subtasks. */
  operation: string;
  operations: string;
  subtaskDone: (credits: number) => string;
  operationDone: (bonus: number) => string;
}

export const SKINS: Record<SkinName, Skin> = {
  cyberpunk: {
    name: "cyberpunk",
    label: "Cyberpunk",
    kicker: "// personal ops terminal",
    title: "MISSION BOARD",
    currency: "CR",
    currencyName: "Credits",
    missions: "Missions",
    mission: "mission",
    newMission: "+ New mission",
    level: "Operator LV",
    lv: "LV",
    shop: "Leisure shop",
    redeem: "Redeem",
    log: "Credit log",
    boot: "Booting Mission Board…",
    completed: (c) => `Mission complete. +${c} credits`,
    levelUp: "Level up!",
    rankUp: "Rank up! You're now",
    operation: "Operation",
    operations: "Operations",
    subtaskDone: (c) => `Objective cleared. +${c} credits`,
    operationDone: (b) => `Operation complete! Bonus +${b} credits`,
  },
  fantasy: {
    name: "fantasy",
    label: "Fantasy",
    kicker: "~ the adventurer's ledger ~",
    title: "Quest Board",
    currency: "GP",
    currencyName: "Gold",
    missions: "Quests",
    mission: "quest",
    newMission: "+ New quest",
    level: "Hero level",
    lv: "Lv",
    shop: "The tavern",
    redeem: "Buy",
    log: "Treasury",
    boot: "Unrolling the quest board…",
    completed: (c) => `Quest complete! +${c} gold`,
    levelUp: "Level up!",
    rankUp: "You have risen to",
    operation: "Raid",
    operations: "Raids",
    subtaskDone: (c) => `Foe vanquished! +${c} gold`,
    operationDone: (b) => `Raid complete! Bonus +${b} gold`,
  },
};

const KEY = "mb-skin";

export function loadSkin(): SkinName {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "cyberpunk" || v === "fantasy") return v;
  } catch {
    /* storage blocked */
  }
  return "cyberpunk";
}

export function applySkin(name: SkinName) {
  document.documentElement.dataset.skin = name;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", name === "fantasy" ? "#efe2c2" : "#05060b");
  try {
    localStorage.setItem(KEY, name);
  } catch {
    /* storage blocked */
  }
}
