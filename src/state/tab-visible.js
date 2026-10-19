// @ts-check
"use client";

import { createContext, useContext } from "react";

/**
 * Whether an always-on tab (terminal, logs) is the active one. TabContent
 * keeps those mounted with their effects running, so a shell session or log
 * tail survives a tab switch; they read this to refit xterm when shown and to
 * flag the tab for attention while hidden. Every other tab is in an
 * <Activity>, which pauses its effects instead, so it never needs this.
 */
export const TabVisibleContext = createContext(true);

/** @returns {boolean} */
export function useTabVisible() {
  return useContext(TabVisibleContext);
}
