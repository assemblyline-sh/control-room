// @ts-check

import { confirmDialog, requeueWorkpieces, showError } from "@/lib/tauri-api";
import { bumpDataEpoch } from "@/state/data-epoch";

/**
 * Retrying workpieces: a workpiece in a station's `failed` or `done` bin goes
 * back to that same station's `input`. The rail's drag-and-drop and its
 * Retry menu items both go through here; Rust re-checks everything
 * (src-tauri/src/requeue.rs).
 *
 * @typedef {import("@/lib/resource-id").ResourceId} ResourceId
 * @typedef {Extract<ResourceId, { type: "workpiece" }>} WorkpieceId
 * @typedef {Extract<ResourceId, { type: "bin" }>} BinId
 */

/**
 * The workpiece being dragged in the rail. dragover can't read
 * dataTransfer, so drop targets check this instead.
 * @type {WorkpieceId | null}
 */
let dragged = null;

/** @param {WorkpieceId | null} r */
export function setDragged(r) {
  dragged = r;
}

/** @returns {WorkpieceId | null} */
export function getDragged() {
  return dragged;
}

/**
 * @param {ResourceId} r
 * @returns {r is WorkpieceId}
 */
export function isRetryable(r) {
  return r.type === "workpiece" && (r.bin === "failed" || r.bin === "done");
}

/**
 * Whether `source` may be dropped on `target`: only its own station's input.
 * @param {ResourceId | null} source
 * @param {ResourceId} target
 * @returns {boolean}
 */
export function canRetry(source, target) {
  return (
    source !== null &&
    isRetryable(source) &&
    target.type === "bin" &&
    target.bin === "input" &&
    target.host === source.host &&
    target.factory === source.factory &&
    target.station === source.station
  );
}

/**
 * Move workpieces from `from` (a failed / done bin) to its station's input,
 * then refresh. `workpieces` null = the whole bin (failed only). A retry from
 * `done` re-runs a step that already succeeded, so it asks first.
 *
 * @param {BinId} from
 * @param {string[] | null} workpieces
 * @param {(action: import("@/state/tree").TreeAction) => void} tree_dispatch
 * @returns {Promise<void>}
 */
export async function retryWorkpieces(from, workpieces, tree_dispatch) {
  if (from.bin === "done") {
    const what = workpieces?.length === 1 ? workpieces[0] : `${workpieces?.length ?? "all"} workpieces`;
    const ok = await confirmDialog(
      `${what} already finished ${from.station}. Retrying runs the station on it again — anything the step does outside the factory (posting, sending, uploading) happens again unless the step dedups it.`,
      `Retry ${what} from ${from.station}/done?`,
    );
    if (!ok) return;
  }
  try {
    await requeueWorkpieces(from.host, from.factory, from.station, from.bin, workpieces);
  } catch (err) {
    await showError(err);
  } finally {
    bumpDataEpoch();
    for (const bin of [from.bin, "input"]) tree_dispatch({ type: "invalidate", resource: { ...from, bin } });
  }
}
