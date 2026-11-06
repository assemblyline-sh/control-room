// @ts-check

/** @type {React.CSSProperties} */
export const headingStyle = { margin: "0 0 8px", fontSize: 20, fontWeight: 600 };

/** @type {React.CSSProperties} */
export const leadStyle = { margin: "0 0 20px", color: "var(--muted-foreground)", lineHeight: 1.5, fontSize: 14 };

/** @type {React.CSSProperties} */
export const noteStyle = { margin: "12px 0 0", color: "var(--muted-foreground)", lineHeight: 1.5, fontSize: 12 };

/** @type {React.CSSProperties} */
export const listStyle = { display: "flex", flexDirection: "column", gap: 8 };

/** @type {React.CSSProperties} */
export const rowStyle = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "10px 12px",
  border: "1px solid var(--border)",
  borderRadius: 6,
  background: "var(--background)",
  cursor: "pointer",
  fontSize: 14,
};

/** @type {React.CSSProperties} */
export const rowHintStyle = { color: "var(--muted-foreground)", fontSize: 12, overflowWrap: "anywhere" };

/** @type {React.CSSProperties} */
export const footerStyle = { display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 24 };

/** @type {React.CSSProperties} */
export const primaryStyle = {
  background: "var(--accent)",
  border: "none",
  color: "#0b0e14",
  padding: "8px 16px",
  borderRadius: 6,
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
};

/** @type {React.CSSProperties} */
export const secondaryStyle = {
  background: "transparent",
  border: "1px solid var(--border)",
  color: "var(--foreground)",
  padding: "8px 16px",
  borderRadius: 6,
  fontSize: 14,
  cursor: "pointer",
};

/** @type {React.CSSProperties} */
export const inputStyle = {
  width: "100%",
  boxSizing: "border-box",
  padding: "8px 10px",
  background: "var(--background)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  color: "var(--foreground)",
  fontSize: 14,
};

/**
 * @param {boolean} enabled
 * @returns {React.CSSProperties}
 */
export function primaryWhen(enabled) {
  return { ...primaryStyle, opacity: enabled ? 1 : 0.5, cursor: enabled ? "pointer" : "not-allowed" };
}
