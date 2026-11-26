import type { Task, TimingState } from "../shared/game";
import { isRecurring, nextPeriodStart } from "../shared/game";

const day = new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short" });
const time = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });

export const fmtDay = (d: Date) => day.format(d);
export const fmtDuration = (m: number) => {
  const h = Math.floor(m / 60), r = m % 60;
  return h ? `${h}h${r ? ` ${r}m` : ""}` : `${r}m`;
};

const weekday = new Intl.DateTimeFormat(undefined, { weekday: "short" });

/** "Resets at midnight" / "Resets Mon" for daily and weekly missions. */
export function resetLabel(t: Task, weekStart: number, now = new Date()): string {
  if (!isRecurring(t.kind)) return "";
  if (t.kind === "daily") return "Resets at midnight";
  return `Resets ${weekday.format(nextPeriodStart("weekly", now, weekStart))}`;
}

export function whenLabel(t: Task, now = new Date()): string {
  if (isRecurring(t.kind)) return [t.kind === "daily" ? "Every day" : "Every week", t.durationMin ? fmtDuration(t.durationMin) : ""].filter(Boolean).join(" · ");
  if (t.kind === "window" && t.start && t.end) {
    const s = new Date(t.start), e = new Date(t.end);
    const sameDay = s.toDateString() === e.toDateString();
    const dayPart = s.toDateString() === now.toDateString() ? "Today" : fmtDay(s);
    return `${dayPart} ${time.format(s)}–${sameDay ? time.format(e) : `${fmtDay(e)} ${time.format(e)}`}`;
  }
  if (t.kind === "duration") {
    const parts = [fmtDuration(t.durationMin ?? 0)];
    if (t.day) {
      const [y, m, d] = t.day.split("-").map(Number);
      const date = new Date(y!, m! - 1, d!);
      if (date.toDateString() !== now.toDateString()) parts.push(fmtDay(date)); // "Today" shows as a status tag
    }
    return parts.join(" · ");
  }
  return "No deadline";
}

export const stateLabel: Record<TimingState, string> = {
  overdue: "Overdue",
  active: "Live now",
  today: "Today",
  upcoming: "Scheduled",
  none: "",
};

const pad = (n: number) => String(n).padStart(2, "0");
export const toLocalInput = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
