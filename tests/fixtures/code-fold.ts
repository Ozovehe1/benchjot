// Code fold cases shared with the Android app (its scripts/web-fixtures.mjs writes code_fold.json).
const lines = (n: number) => Array.from({ length: n }, (_, i) => `x${i} = ${i}`).join("\n");
export const CODE_FOLD_CASES: string[] = ["", "print(1)", lines(12), lines(12) + "\n", lines(13), lines(40)];
