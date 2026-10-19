// @ts-check
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { addFactory, confirmDialog, loadConfig, localFactories, pickFolder, removeFactory } from "@/lib/tauri-api";

/**
 * @typedef {import("@/lib/tauri-api").FactoryRepo} FactoryRepo
 */

/**
 * Add local factory repos. Each one is written straight to the central config
 * (~/.assemblyline/al-control/config.yml, shared with the al-control CLI) under the
 * `local` host, named after its directory.
 */
export default function OnboardingPage() {
  const router = useRouter();
  const [repos, set_repos] = useState(/** @type {FactoryRepo[]} */ ([]));
  const [error, set_error] = useState(/** @type {string | null} */ (null));

  useEffect(() => {
    (async () => {
      try {
        set_repos(localFactories(await loadConfig()));
      } catch (err) {
        set_error(String(err));
      }
    })();
  }, []);

  async function addRepo() {
    set_error(null);
    try {
      const path = await pickFolder();
      if (!path) return;
      if (repos.some((r) => r.path === path)) {
        set_error("That repo is already added.");
        return;
      }
      set_repos(localFactories(await addFactory("local", path)));
    } catch (err) {
      set_error(String(err));
    }
  }

  /** @param {FactoryRepo} repo */
  async function removeRepo(repo) {
    set_error(null);
    const ok = await confirmDialog(
      `Remove ${repo.label} from the local host? The al-control CLI uses the same config, so it disappears there too. The repo itself isn't touched.`,
      "Remove factory",
    );
    if (!ok) return;
    try {
      set_repos(localFactories(await removeFactory("local", repo.label)));
    } catch (err) {
      set_error(String(err));
    }
  }

  function done() {
    router.replace("/");
  }

  const can_finish = repos.length > 0;

  return (
    <main style={pageStyle}>
      <div style={cardStyle}>
        <h1 style={{ margin: "0 0 8px", fontSize: 22, fontWeight: 600 }}>
          Welcome to Control Room
        </h1>
        <p style={{ margin: "0 0 24px", color: "var(--muted-foreground)" }}>
          Point Control Room at one or more local <code>factory-*</code> repos. They&apos;re saved
          to <code>~/.assemblyline/al-control/config.yml</code> under the <code>local</code> host — the
          same config the al-control CLI reads.
        </p>

        <button onClick={addRepo} style={primaryButtonStyle}>
          + Add factory repo…
        </button>

        {error && <p style={errorStyle}>{error}</p>}

        {repos.length > 0 && (
          <ul style={listStyle}>
            {repos.map((repo) => (
              <li key={repo.path} style={listItemStyle}>
                <div>
                  <div style={{ fontWeight: 500 }}>{repo.label}</div>
                  <div style={{ fontSize: 12, color: "var(--muted-foreground)" }}>
                    {repo.path}
                  </div>
                </div>
                <button onClick={() => removeRepo(repo)} style={removeButtonStyle}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}

        <button
          onClick={done}
          disabled={!can_finish}
          style={{
            ...primaryButtonStyle,
            marginTop: 24,
            opacity: can_finish ? 1 : 0.5,
            cursor: can_finish ? "pointer" : "not-allowed",
          }}
        >
          Done
        </button>
      </div>
    </main>
  );
}

const pageStyle = {
  minHeight: "100vh",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 32,
};

const cardStyle = {
  maxWidth: 560,
  width: "100%",
  background: "var(--muted)",
  border: "1px solid var(--border)",
  borderRadius: 12,
  padding: 32,
};

const primaryButtonStyle = {
  background: "var(--accent)",
  border: "none",
  color: "#0b0e14",
  padding: "10px 16px",
  borderRadius: 6,
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
};

/** @type {React.CSSProperties} */
const listStyle = {
  listStyle: "none",
  padding: 0,
  margin: "20px 0 0",
  display: "flex",
  flexDirection: "column",
  gap: 8,
};

const listItemStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "10px 12px",
  border: "1px solid var(--border)",
  borderRadius: 6,
  background: "var(--background)",
};

const removeButtonStyle = {
  background: "transparent",
  border: "1px solid var(--border)",
  color: "var(--foreground)",
  padding: "4px 10px",
  borderRadius: 4,
  fontSize: 12,
  cursor: "pointer",
};

const errorStyle = {
  margin: "12px 0 0",
  color: "#f85149",
  fontSize: 12,
};
