// @ts-check

/**
 * The computer in an ssh value: `alex@box` → `box`. A new host is named this
 * way, so it's also how a typed name is matched to a saved one.
 * @param {string} ssh
 * @returns {string}
 */
export function computerOf(ssh) {
  return ssh.replace(/^.*@/, "");
}

/**
 * The saved remote host a typed computer name means, or null: its `ssh` or
 * name exactly, or the same computer with the user dropped on either side
 * (`alex@box` and `box` are one computer).
 * @param {Pick<import("@/lib/tauri-api").ConfigHost, "name" | "is_local" | "ssh">[]} hosts
 * @param {string} typed
 * @returns {string | null}
 */
export function savedHostFor(hosts, typed) {
  const want = typed.trim();
  if (!want) return null;
  const remote = hosts.filter((h) => !h.is_local);
  const found =
    remote.find((h) => h.ssh === want || h.name === want) ??
    remote.find((h) => h.name === computerOf(want) || (!!h.ssh && computerOf(h.ssh) === computerOf(want)));
  return found?.name ?? null;
}
