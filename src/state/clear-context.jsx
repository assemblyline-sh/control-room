// @ts-check
"use client";

import { createContext, useContext, useState } from "react";
import ClearDialog from "@/components/ClearDialog";

/**
 * @typedef {Object} ClearRequest
 * @property {string} host
 * @property {import("@/lib/tauri-api").ClearScope[]} scopes
 * @property {import("@/lib/tauri-api").ClearFilter} filter
 * @property {string} [label] - what was asked for, e.g. "factory-alex · line EM"
 * @property {number} [expected] - the count the caller showed, to flag drift
 */

const ClearContext = createContext(/** @type {((r: ClearRequest) => void) | null} */ (null));

/**
 * One clear dialog for the whole window. Every entry point (rail menu, views,
 * Housekeeping) opens it through useClear(), so the dry run, the confirm and
 * the refresh afterwards are the same everywhere.
 *
 * @param {{ children: React.ReactNode }} props
 */
export function ClearProvider({ children }) {
  const [request, set_request] = useState(/** @type {ClearRequest | null} */ (null));
  return (
    <ClearContext.Provider value={set_request}>
      {children}
      {request && <ClearDialog request={request} onClose={() => set_request(null)} />}
    </ClearContext.Provider>
  );
}

/** @returns {(r: ClearRequest) => void} */
export function useClear() {
  const open = useContext(ClearContext);
  if (!open) throw new Error("useClear outside ClearProvider");
  return open;
}
