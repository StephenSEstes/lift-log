export function computeNextSetNumber(args: {
  plannedSetCount: number;
  loggedSetsForExercise: Array<{ setNumber?: number | null }>;
}): number {
  const planned = Math.max(1, args.plannedSetCount || 1);
  const nums = (args.loggedSetsForExercise || [])
    .map((s) => Number(s.setNumber || 0))
    .filter((n) => Number.isFinite(n) && n > 0);
  const maxLogged = nums.length ? Math.max(...nums) : 0;
  const next = Math.min(planned, maxLogged + 1);
  return next < 1 ? 1 : next;
}
