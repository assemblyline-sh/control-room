// @ts-check
"use client";

import ViewLayout from "@/components/ViewLayout";

/**
 * @typedef {import("@/lib/resource-id").ResourceId} ResourceId
 */

/**
 * Stub view. Work-records are part of the watch-shell resource taxonomy but
 * the on-disk shape isn't yet confirmed (Open Question 4). This view
 * surfaces what we know so the user isn't surprised by an empty tab if they
 * stumble into one.
 *
 * @param {{ resource: Extract<ResourceId, { type: 'work-record' }> }} props
 * @returns {React.JSX.Element}
 */
export default function ViewWorkRecord({ resource }) {
  return (
    <ViewLayout
      title={resource.work_record}
      sub={`${resource.line} · ${resource.station} · work-record`}
    >
      <p style={paragraphStyle}>
        Work-record views aren&apos;t implemented yet. The on-disk shape needs to
        be confirmed before this view can list runs, outputs, or definitions
        — see <code>docs/wip/watch-shell.md</code> Open Question 4.
      </p>
      <p style={paragraphStyle}>
        Until then, work-records appear in the rail but open as this
        placeholder.
      </p>
    </ViewLayout>
  );
}

/** @type {React.CSSProperties} */
const paragraphStyle = {
  margin: "0 0 12px",
  fontSize: 13,
  color: "var(--muted-foreground)",
  lineHeight: 1.5,
  maxWidth: 640,
};
