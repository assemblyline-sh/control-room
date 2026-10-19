// @ts-check
"use client";

import { useMemo } from "react";
import { useFileData } from "@/views/file/useFileData";
import LogJsonlTable from "@/views/file/LogJsonlTable";
import MediaView, { MEDIA_TYPES } from "@/views/file/MediaView";
import { formatBytes } from "@/lib/format";
import ViewLayout from "@/components/ViewLayout";
import { fetchFile, openInFinder, showError } from "@/lib/tauri-api";

/**
 * @typedef {import("@/lib/resource-id").ResourceId} ResourceId
 */

/**
 * File viewer. Specialized renderers:
 *   - `log.jsonl` → 4-column event table with clickable station + wr (see
 *     `LogJsonlTable`).
 *   - `.json` (any other) → pretty-printed via `JSON.stringify(JSON.parse(...))`.
 *   - `.jsonl` (any other) → each parsed object dumped block-style.
 *   - `.pdf` and images → the webview's PDF viewer or an <img> (see
 *     `MediaView`).
 *   - everything else → plain monospace text.
 *
 * Files larger than the read cap arrive with `truncated: true` and we
 * show a banner. Live tailing is Out of Scope.
 *
 * @param {{ resource: Extract<ResourceId, { type: 'file' }> }} props
 * @returns {React.JSX.Element}
 */
export default function ViewFile({ resource }) {
  const { data, loading, refreshing, fetched_at, error, refresh } = useFileData(
    resource.host,
    resource.factory,
    resource.file_path,
  );

  const name = useMemo(() => basename(resource.file_path), [resource.file_path]);
  const ext = useMemo(() => extension(resource.file_path), [resource.file_path]);
  const is_log_jsonl = name === "log.jsonl";
  const media_type = MEDIA_TYPES.get(ext);
  const openDefault = () =>
    fetchFile(resource.host, resource.factory, resource.file_path).then(openInFinder).catch(showError);

  const rendered = useMemo(() => {
    if (!data || is_log_jsonl) return null;
    if (ext === "json") return prettyJson(data.content);
    if (ext === "jsonl") return prettyJsonl(data.content);
    return data.content;
  }, [data, ext, is_log_jsonl]);

  return (
    <ViewLayout
      title={name}
      sub={
        data
          ? `${formatBytes(data.size)}${data.truncated && !media_type ? " · truncated" : ""}`
          : resource.file_path
      }
      loading={loading}
      refreshing={refreshing}
      fetched_at={fetched_at}
      error={error}
      onRefresh={refresh}
      actions={
        media_type ? (
          <button type="button" style={buttonStyle} onClick={openDefault}>
            Open in default app
          </button>
        ) : undefined
      }
    >
      {data?.truncated && !media_type && (
        <div style={warnStyle}>
          File larger than the read cap. Showing the first ~1 MiB.
        </div>
      )}
      {/* Some PDFs have no NUL in their first 8 KB, and SVGs are text, so go by the extension. */}
      {data && media_type && (
        <MediaView
          host={resource.host}
          factory={resource.factory}
          file_path={resource.file_path}
          mime={media_type}
        />
      )}
      {data?.is_binary && !media_type && (
        <div style={binaryStyle}>
          <p style={{ margin: "0 0 12px" }}>Binary file · {formatBytes(data.size)}</p>
          <button
            type="button"
            style={buttonStyle}
            onClick={openDefault}
          >
            Open in default app
          </button>
        </div>
      )}
      {data && !data.is_binary && !media_type && is_log_jsonl && (
        <LogJsonlTable
          host={resource.host}
          factory={resource.factory}
          content={data.content}
        />
      )}
      {data && !data.is_binary && !media_type && !is_log_jsonl && <pre style={preStyle}>{rendered}</pre>}
    </ViewLayout>
  );
}

/**
 * @param {string} content
 */
function prettyJson(content) {
  try {
    return JSON.stringify(JSON.parse(content), null, 2);
  } catch {
    return content;
  }
}

/**
 * @param {string} content
 */
function prettyJsonl(content) {
  return content
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.stringify(JSON.parse(line), null, 2);
      } catch {
        return line;
      }
    })
    .join("\n\n");
}

/**
 * @param {string} p
 */
function basename(p) {
  const trimmed = p.replace(/[/\\]+$/, "");
  const i = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return i === -1 ? trimmed : trimmed.slice(i + 1);
}

/**
 * @param {string} p
 * @returns {string}
 */
function extension(p) {
  const name = basename(p);
  const i = name.lastIndexOf(".");
  return i === -1 ? "" : name.slice(i + 1).toLowerCase();
}


/** @type {React.CSSProperties} */
const preStyle = {
  margin: 0,
  padding: 12,
  background: "var(--muted)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  fontSize: 12,
  fontFamily: "ui-monospace, Menlo, monospace",
  overflow: "auto",
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
};

/** @type {React.CSSProperties} */
const warnStyle = {
  marginBottom: 12,
  padding: "8px 12px",
  background: "rgba(255, 166, 87, 0.1)",
  color: "#ffa657",
  borderRadius: 6,
  fontSize: 12,
};

/** @type {React.CSSProperties} */
const binaryStyle = { color: "var(--muted-foreground)", fontSize: 13 };

/** @type {React.CSSProperties} */
const buttonStyle = {
  padding: "6px 12px",
  background: "transparent",
  border: "1px solid var(--border)",
  borderRadius: 6,
  color: "var(--accent)",
  fontSize: 12,
  cursor: "pointer",
};
