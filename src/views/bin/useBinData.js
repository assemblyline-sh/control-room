// @ts-check
"use client";

import { listBinWorkpieces, listFailures, showStation } from "@/lib/tauri-api";
import { useFetcher } from "@/lib/use-fetcher";
import { useNodeCounts } from "@/state/counts-store";

/**
 * The bin's polled count — a signal that revalidates the list when it moves.
 * @param {string} host
 * @param {string} factory
 * @param {string} station
 * @param {string} bin
 */
function useBinCount(host, factory, station, bin) {
  return useNodeCounts({ type: "bin", host, factory, line: "", station, bin });
}

/**
 * @param {string} host
 * @param {string} factory - name in the central config
 * @param {string} station
 * @param {string} bin
 */
export function useBinData(host, factory, station, bin) {
  return useFetcher(
    ["listBinWorkpieces", host, factory, station, bin],
    () => listBinWorkpieces(host, factory, station, bin),
    [useBinCount(host, factory, station, bin)],
  );
}

/**
 * A failed bin's error per workpiece, plus its orphaned folders. Resolves to
 * null for any other bin.
 * @param {string} host
 * @param {string} factory
 * @param {string} station
 * @param {string} bin
 */
export function useBinFailures(host, factory, station, bin) {
  return useFetcher(
    ["binFailures", host, factory, station, bin],
    async () => {
      if (bin !== "failed") return null;
      const [w] = await listFailures(host, factory);
      return (w?.failures ?? []).filter((f) => f.station === station);
    },
    [useBinCount(host, factory, station, bin)],
  );
}

/**
 * Whether the bin's station is its line's terminal — known from the rail,
 * fetched otherwise (only output bins need it: terminal output is clearable).
 * @param {string} host
 * @param {string} factory
 * @param {string} line
 * @param {string} station
 * @param {string} bin
 * @param {boolean | undefined} known
 */
export function useIsTerminal(host, factory, line, station, bin, known) {
  const { data } = useFetcher(["isTerminal", host, factory, line, station, bin, known], async () =>
    known !== undefined || bin !== "output" ? known ?? false : (await showStation(host, factory, line, station)).is_terminal,
  );
  return data ?? false;
}
