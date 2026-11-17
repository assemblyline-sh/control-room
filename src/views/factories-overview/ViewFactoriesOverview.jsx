// @ts-check
"use client";

import { DataTable } from "@fob/lib-ui/primitives/data-table/data-table";
import { useFactoriesOverview } from "@/views/factories-overview/useFactoriesOverview";
import ViewLayout from "@/components/ViewLayout";

/**
 * @typedef {import("@/lib/resource-id").ResourceId} ResourceId
 * @typedef {import("@/views/factories-overview/useFactoriesOverview").FactoryOverviewRow} FactoryOverviewRow
 */

/**
 * Cross-factory process table with Start All (the stopped ones) / Stop All
 * (the ones under pm2). Refreshes every
 * 2s while open — see useFactoriesOverview for why this view is exempt from
 * the app's usual manual-refresh pattern.
 *
 * @param {{ resource: Extract<ResourceId, { type: 'factories-overview' }> }} props
 * @returns {React.JSX.Element}
 */
export default function ViewFactoriesOverview({ resource }) {
  const { rows, error, startAll, stopAll } = useFactoriesOverview(resource.host);

  return (
    <ViewLayout
      title="Factories"
      sub={`${resource.host === "local" ? "This machine" : resource.host} · live process status, refreshed every 2s`}
      error={error}
      actions={
        <>
          <button type="button" style={actionButtonStyle} onClick={startAll}>
            Start All
          </button>
          <button type="button" style={actionButtonStyle} onClick={stopAll}>
            Stop All
          </button>
        </>
      }
    >
      {rows === null && <p style={emptyStyle}>Loading…</p>}
      {rows && rows.length === 0 && <p style={emptyStyle}>No factories configured.</p>}
      {rows && rows.length > 0 && (
        <div>
          <DataTable columns={COLUMNS} data={rows} size="sm" hidePagination={rows.length <= 30} />
        </div>
      )}
    </ViewLayout>
  );
}

const NUMERIC = { headerClassName: "text-right", cellClassName: "text-right tabular-nums" };

// Blank PID, CPU and memory (a stopped factory) sort last either way. pid
// arrives as a string, so it sorts through Number().
/** @type {import("@tanstack/react-table").ColumnDef<FactoryOverviewRow, any>[]} */
const COLUMNS = [
  { id: "name", accessorKey: "name", header: "Factory", sortingFn: "alphanumeric" },
  { id: "status", accessorFn: (row) => displayStatus(row.status), header: "Status" },
  {
    id: "pid",
    accessorFn: (row) => (row.pid ? Number(row.pid) : undefined),
    header: "PID",
    sortingFn: "basic",
    sortUndefined: "last",
    meta: NUMERIC,
    cell: ({ row }) => row.original.pid ?? "—",
  },
  {
    id: "cpu",
    accessorFn: (row) => row.cpu ?? undefined,
    header: "CPU",
    sortingFn: "basic",
    sortUndefined: "last",
    meta: NUMERIC,
    cell: ({ row }) => (row.original.cpu != null ? `${row.original.cpu}%` : "—"),
  },
  {
    id: "memory",
    accessorFn: (row) => row.memory ?? undefined,
    header: "Memory",
    sortingFn: "basic",
    sortUndefined: "last",
    meta: NUMERIC,
    cell: ({ row }) => (row.original.memory != null ? formatBytes(row.original.memory) : "—"),
  },
];

/** @param {string} status */
function displayStatus(status) {
  if (status === "online") return "online (pm2)";
  if (status === "direct") return "running directly";
  return status;
}

/** @param {number} bytes */
function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** @type {React.CSSProperties} */
const actionButtonStyle = {
  padding: "5px 12px",
  background: "transparent",
  border: "1px solid var(--border)",
  borderRadius: 6,
  color: "var(--foreground)",
  fontSize: 12,
  cursor: "pointer",
  whiteSpace: "nowrap",
};

/** @type {React.CSSProperties} */
const emptyStyle = {
  color: "var(--muted-foreground)",
  fontStyle: "italic",
};
