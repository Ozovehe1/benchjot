// listDate cases shared with the Android app (its scripts/web-fixtures.mjs writes them to
// list_date.json): [name, then, now, expected], stamps as local [year, month, day, hour, minute].
import type { LocalStamp } from "@/lib/format";

export const LIST_DATE_CASES: [string, LocalStamp, LocalStamp, string][] = [
  ["today shows the time", [2026, 11, 5, 14, 5], [2026, 11, 5, 18, 0], "14:05"],
  ["just after midnight is today", [2026, 11, 5, 0, 1], [2026, 11, 5, 0, 2], "00:01"],
  ["just before midnight is yesterday", [2026, 11, 4, 23, 59], [2026, 11, 5, 0, 0], "Yesterday"],
  ["yesterday morning", [2026, 11, 4, 8, 0], [2026, 11, 5, 23, 59], "Yesterday"],
  ["two days back is a weekday", [2026, 11, 3, 12, 0], [2026, 11, 5, 9, 0], "Tue"],
  ["six days back is a weekday", [2026, 10, 30, 12, 0], [2026, 11, 5, 9, 0], "Fri"],
  ["seven days back is a date", [2026, 10, 29, 12, 0], [2026, 11, 5, 9, 0], "29 Oct"],
  ["earlier this year", [2026, 1, 2, 9, 0], [2026, 11, 5, 9, 0], "2 Jan"],
  ["last year, months ago", [2025, 11, 3, 9, 0], [2026, 11, 5, 9, 0], "3 Nov 2025"],
  ["new year's eve seen on new year's day", [2025, 12, 31, 23, 30], [2026, 1, 1, 0, 10], "Yesterday"],
  ["last week of last year is a weekday", [2025, 12, 29, 10, 0], [2026, 1, 2, 10, 0], "Mon"],
  ["eight days back across the new year", [2025, 12, 24, 10, 0], [2026, 1, 1, 10, 0], "24 Dec 2025"],
  ["leap day", [2028, 2, 29, 10, 0], [2028, 3, 1, 10, 0], "Yesterday"],
  ["in the future (clock skew) shows the date", [2026, 11, 7, 10, 0], [2026, 11, 5, 10, 0], "7 Nov"],
];
