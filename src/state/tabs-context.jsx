// @ts-check
"use client";

import { createContext, useContext, useReducer } from "react";
import { tabs_initial_state, tabsReducer } from "@/state/tabs";

/**
 * @typedef {import("@/state/tabs").TabsState} TabsState
 * @typedef {import("@/state/tabs").TabsAction} TabsAction
 */

/**
 * @typedef {{ state: TabsState, dispatch: (a: TabsAction) => void }} TabsContextValue
 */

const TabsContext = createContext(/** @type {TabsContextValue | null} */ (null));

/**
 * @param {{ children: React.ReactNode }} props
 * @returns {React.JSX.Element}
 */
export function TabsProvider({ children }) {
  const [state, dispatch] = useReducer(tabsReducer, tabs_initial_state);
  return (
    <TabsContext.Provider value={{ state, dispatch }}>
      {children}
    </TabsContext.Provider>
  );
}

/**
 * @returns {TabsContextValue}
 */
export function useTabs() {
  const ctx = useContext(TabsContext);
  if (!ctx) throw new Error("useTabs must be inside <TabsProvider>");
  return ctx;
}
