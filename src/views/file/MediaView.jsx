// @ts-check
"use client";

import { useEffect, useState } from "react";
import { readFileBytes } from "@/lib/tauri-api";

/** Extension → MIME type for files the webview can show itself. */
export const MEDIA_TYPES = new Map([
  ["pdf", "application/pdf"],
  ["png", "image/png"],
  ["jpg", "image/jpeg"],
  ["jpeg", "image/jpeg"],
  ["gif", "image/gif"],
  ["webp", "image/webp"],
  ["svg", "image/svg+xml"],
  ["bmp", "image/bmp"],
  ["ico", "image/x-icon"],
  ["avif", "image/avif"],
]);

/**
 * A PDF in the webview's own viewer, or an image in an <img>: the bytes come
 * over IPC (local, or fetched over ssh) and play from a blob: URL, so the
 * webview never gets a path it could read on its own. An SVG in <img> runs
 * no scripts.
 *
 * @param {{ host: string, factory: string, file_path: string, mime: string }} props
 * @returns {React.JSX.Element}
 */
export default function MediaView({ host, factory, file_path, mime }) {
  const [url, set_url] = useState(/** @type {string | null} */ (null));
  const [error, set_error] = useState(/** @type {string | null} */ (null));
  const is_pdf = mime === "application/pdf";

  useEffect(() => {
    let cancelled = false;
    /** @type {string | null} */
    let made = null;
    set_url(null);
    set_error(null);
    readFileBytes(host, factory, file_path)
      .then((bytes) => {
        if (cancelled) return;
        made = URL.createObjectURL(new Blob([bytes], { type: mime }));
        set_url(made);
      })
      .catch((e) => !cancelled && set_error(String(e)));
    return () => {
      cancelled = true;
      if (made) URL.revokeObjectURL(made);
    };
  }, [host, factory, file_path, mime]);

  if (error) return <p style={errorStyle}>{error}</p>;
  if (!url)
    return (
      <p style={mutedStyle}>{is_pdf ? "Loading PDF…" : "Loading image…"}</p>
    );
  if (is_pdf) return <iframe src={url} title={file_path} style={frameStyle} />;
  return (
    <div style={imageWrapStyle}>
      <img
        src={url}
        alt={file_path}
        style={imageStyle}
        onError={() => set_error("The webview can't display this image.")}
      />
    </div>
  );
}

/** @type {React.CSSProperties} */
const frameStyle = {
  display: "block",
  width: "100%",
  height: "100%",
  minHeight: 480,
  border: "1px solid var(--border)",
  borderRadius: 6,
  background: "#fff",
};

/** @type {React.CSSProperties} */
const imageWrapStyle = {
  padding: 12,
  border: "1px solid var(--border)",
  borderRadius: 6,
  background:
    "repeating-conic-gradient(var(--muted) 0% 25%, transparent 0% 50%) 0 0 / 16px 16px",
  overflow: "auto",
};

/** @type {React.CSSProperties} */
const imageStyle = {
  display: "block",
  maxWidth: "100%",
  height: "auto",
  margin: "0 auto",
};

/** @type {React.CSSProperties} */
const mutedStyle = { color: "var(--muted-foreground)", fontSize: 13 };

/** @type {React.CSSProperties} */
const errorStyle = { color: "#ff7b72", fontSize: 13, whiteSpace: "pre-wrap" };
