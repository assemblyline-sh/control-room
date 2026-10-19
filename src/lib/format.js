// @ts-check

/**
 * Shared number / date formatting for the triage views.
 */

/** @param {number} n */
export function formatCount(n) {
  return n.toLocaleString();
}

/** @param {number} n - bytes */
export function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
  return `${(n / 1024 / 1024).toFixed(1)} MiB`;
}

/**
 * "12 Jun 2026"
 * @param {number | string | null | undefined} t - ms since epoch or ISO string
 */
export function formatDay(t) {
  if (t === null || t === undefined) return "—";
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return String(t);
  return d.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}

/**
 * "12 Jun 2026, 09:34"
 * @param {number | string | null | undefined} t - ms since epoch or ISO string
 */
export function formatDateTime(t) {
  if (t === null || t === undefined) return "—";
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return String(t);
  return d.toLocaleString(undefined, { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** @param {number} n @param {string} word */
export function plural(n, word) {
  return `${formatCount(n)} ${word}${n === 1 ? "" : "s"}`;
}
