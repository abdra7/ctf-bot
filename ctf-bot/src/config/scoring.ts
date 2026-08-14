/**
 * Points awarded per final rank. Anything beyond the mapped ranks falls back
 * to DEFAULT_POINTS. Edit these values to change the leaderboard scoring.
 */
export const RANK_POINTS: Record<number, number> = {
  1: 100,
  2: 75,
  3: 50,
  4: 30,
};

export const DEFAULT_POINTS = 10;

export function pointsForRank(rank: number): number {
  return RANK_POINTS[rank] ?? DEFAULT_POINTS;
}
