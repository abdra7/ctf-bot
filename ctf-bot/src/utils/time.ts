/** Formats milliseconds as MM:SS (or HH:MM:SS if over an hour). */
export function formatDuration(ms: number): string {
  if (ms < 0) ms = 0;
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const mm = minutes.toString().padStart(2, "0");
  const ss = seconds.toString().padStart(2, "0");

  if (hours > 0) {
    return `${hours}:${mm}:${ss}`;
  }
  return `${mm}:${ss}`;
}

/** Formats milliseconds as MM:SS.mmm for tie-break display precision. */
export function formatDurationPrecise(ms: number): string {
  const base = formatDuration(ms);
  const millis = Math.floor(ms % 1000)
    .toString()
    .padStart(3, "0");
  return `${base}.${millis}`;
}

export function minutesToMs(minutes: number): number {
  return minutes * 60 * 1000;
}
