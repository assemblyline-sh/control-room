// @ts-check
"use client";

import { createContext, useContext, useReducer } from "react";
import { tree_initial_state, treeReducer } from "@/state/tree";

/**
 * @typedef {import("@/state/tree").TreeState} TreeState
 * @typedef {import("@/state/tree").TreeAction} TreeAction
 */

/**
 * @typedef {{ state: TreeState, dispatch: (a: TreeAction) => void }} TreeContextValue
 */

const TreeContext = createContext(/** @type {TreeContextValue | null} */ (null));

/**
 * @param {{ children: React.ReactNode }} props
 * @returns {React.JSX.Element}
 */
export function TreeProvider({ children }) {
  const [state, dispatch] = useReducer(treeReducer, tree_initial_state);
  return (
    <TreeContext.Provider value={{ state, dispatch }}>
      {children}
    </TreeContext.Provider>
  );
}

/**
 * @returns {TreeContextValue}
 */
export function useTree() {
  const ctx = useContext(TreeContext);
  if (!ctx) throw new Error("useTree must be inside <TreeProvider>");
  return ctx;
}
