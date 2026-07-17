export const DISCORD_EPOCH_MS = 1420070400000;

/** Local-time day key, YYYY-MM-DD. All rollups use the user's local rhythm. */
export function dateKey(ts: number): string {
  const d = new Date(ts);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/** Local hour of day, 0–23. */
export function hourOf(ts: number): number {
  return new Date(ts).getHours();
}

/** Parses a YYYY-MM-DD key as LOCAL midnight (never UTC). */
export function parseDateKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

export function shiftDate(key: string, days: number): string {
  const date = parseDateKey(key);
  date.setDate(date.getDate() + days);
  return dateKey(date.getTime());
}

/** The Monday beginning the week that contains the given day. */
export function mondayOf(key: string): string {
  const offset = (parseDateKey(key).getDay() + 6) % 7;
  return offset === 0 ? key : shiftDate(key, -offset);
}

/** Millisecond timestamp embedded in a Discord snowflake id, or null. */
export function snowflakeToTs(id: string | undefined | null): number | null {
  if (!id || !/^\d{6,}$/.test(id)) return null;
  try {
    return Number(BigInt(id) >> 22n) + DISCORD_EPOCH_MS;
  } catch {
    return null;
  }
}
