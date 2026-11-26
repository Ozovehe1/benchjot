// listGroup cases shared with the Android app (its scripts/web-fixtures.mjs writes them to
// list_group.json): [name, then, now, expected heading], stamps as local [year, month, day, hour, minute].
import type { LocalStamp } from "@/lib/ui/format";

export const LIST_GROUP_CASES: [string, LocalStamp, LocalStamp, string][] = [
  ["earlier today", [2026, 11, 5, 0, 1], [2026, 11, 5, 23, 0], "Today"],
  ["in the future (clock skew) is today", [2026, 11, 7, 10, 0], [2026, 11, 5, 10, 0], "Today"],
  ["just before midnight is yesterday", [2026, 11, 4, 23, 59], [2026, 11, 5, 0, 0], "Yesterday"],
  ["two days back", [2026, 11, 3, 12, 0], [2026, 11, 5, 9, 0], "Previous 7 days"],
  ["seven days back", [2026, 10, 29, 12, 0], [2026, 11, 5, 9, 0], "Previous 7 days"],
  ["eight days back", [2026, 10, 28, 12, 0], [2026, 11, 5, 9, 0], "Previous 30 days"],
  ["thirty days back", [2026, 10, 6, 12, 0], [2026, 11, 5, 9, 0], "Previous 30 days"],
  ["thirty-one days back is its month", [2026, 10, 5, 12, 0], [2026, 11, 5, 9, 0], "October"],
  ["earlier this year", [2026, 1, 2, 9, 0], [2026, 11, 5, 9, 0], "January"],
  ["last year is its year", [2025, 11, 3, 9, 0], [2026, 11, 5, 9, 0], "2025"],
  ["new year's eve seen on new year's day", [2025, 12, 31, 23, 30], [2026, 1, 1, 0, 10], "Yesterday"],
  ["across the new year, within 30 days", [2025, 12, 10, 10, 0], [2026, 1, 2, 10, 0], "Previous 30 days"],
  ["leap day", [2028, 2, 29, 10, 0], [2028, 3, 1, 10, 0], "Yesterday"],
];
