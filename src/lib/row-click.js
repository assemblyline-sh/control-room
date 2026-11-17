// @ts-check

/**
 * Whole-row click for a lib-ui DataTable, which has no row handler: a click
 * anywhere in a body row presses that row's first button (the control that
 * opens the row, reachable by keyboard). Clicks on a control keep their own
 * meaning. Put it on an element wrapping the table.
 *
 * @param {React.MouseEvent<HTMLElement>} e
 */
export function clickRowButton(e) {
  const target = /** @type {HTMLElement} */ (e.target);
  if (target.closest("button, a, input, [role=separator]")) return;
  target.closest("tbody tr")?.querySelector("button")?.click();
}

/** DataTable `className`: body rows show they can be clicked. */
export const CLICKABLE_ROWS = "[&_tbody_tr]:cursor-pointer";
