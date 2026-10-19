// @ts-check
"use client";

import { readFile } from "@/lib/tauri-api";
import { useFetcher } from "@/lib/use-fetcher";

/**
 * @param {string} host
 * @param {string} factory - name in the central config
 * @param {string} file_path - relative to the factory root
 */
export function useFileData(host, factory, file_path) {
  return useFetcher(["readFile", host, factory, file_path], () => readFile(host, factory, file_path));
}
