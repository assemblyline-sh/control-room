// @ts-check
"use client";

/**
 * Placeholder hook for work-records. Blocked on watch-shell Open Question 4:
 * the on-disk shape of a work-record (file? directory? where?) needs to be
 * confirmed before we can list or render them. Returns a static "not yet
 * supported" state so the View renders an explainer.
 *
 * @returns {{ data: null, loading: false, error: null, refresh: () => void }}
 */
export function useWorkRecordData() {
  return { data: null, loading: false, error: null, refresh: () => {} };
}
