// @ts-check
"use client";

import { useTabs } from "@/state/tabs-context";
import { useStationData } from "@/views/station/useStationData";
import ViewLayout from "@/components/ViewLayout";

/**
 * @typedef {import("@/lib/resource-id").ResourceId} ResourceId
 */

const BINS = /** @type {const} */ (["input", "doing", "output", "failed", "done"]);

/**
 * Station view: per-bin workpiece id lists + the station's definitional
 * metadata if present.
 *
 * @param {{ resource: Extract<ResourceId, { type: 'station' }> }} props
 * @returns {React.JSX.Element}
 */
export default function ViewStation({ resource }) {
  const { data, loading, refreshing, fetched_at, error, refresh } = useStationData(
    resource.host,
    resource.factory,
    resource.line,
    resource.station,
  );
  const { dispatch } = useTabs();

  /**
   * @param {string} bin
   */
  const openBin = (bin) =>
    dispatch({
      type: "open_tab",
      resource: {
        type: "bin",
        host: resource.host,
        factory: resource.factory,
        line: resource.line,
        station: resource.station,
        bin,
      },
    });

  /**
   * @param {string} workpiece
   */
  const openWorkpiece = (workpiece) =>
    dispatch({
      type: "open_tab",
      resource: {
        type: "workpiece",
        host: resource.host,
        factory: resource.factory,
        line: resource.line,
        station: resource.station,
        bin: data?.bins
          ? findBinFor(workpiece, data.bins) ?? "input"
          : "input",
        workpiece,
      },
    });

  return (
    <ViewLayout
      title={`Station ${resource.station}`}
      link={data?.orchestrator && `${data.orchestrator}/stations/${encodeURIComponent(resource.station)}`}
      sub={
        data?.def?.name
          ? `${data.def.name}${data.is_terminal ? " · terminal" : ""}`
          : data?.is_terminal
            ? "terminal"
            : undefined
      }
      loading={loading}
      refreshing={refreshing}
      fetched_at={fetched_at}
      error={error}
      onRefresh={refresh}
    >
      {data?.def?.description && (
        <p style={descStyle}>{data.def.description}</p>
      )}
      {data && (
        <div style={binsWrapStyle}>
          {BINS.map((bin) => {
            const ids = data.bins[bin] ?? [];
            return (
              <section key={bin} style={binSectionStyle}>
                <header style={binHeaderStyle}>
                  <button
                    type="button"
                    style={binTitleStyle}
                    onClick={() => openBin(bin)}
                  >
                    {bin}
                  </button>
                  <span style={countStyle}>{ids.length}</span>
                </header>
                {ids.length === 0 ? (
                  <p style={emptyStyle}>(empty)</p>
                ) : (
                  <ul style={listStyle}>
                    {ids.slice(0, 50).map((id) => (
                      <li
                        key={id}
                        style={itemStyle}
                        onClick={() => openWorkpiece(id)}
                      >
                        {id}
                      </li>
                    ))}
                    {ids.length > 50 && (
                      <li style={moreStyle}>… {ids.length - 50} more</li>
                    )}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      )}
    </ViewLayout>
  );
}

/**
 * @param {string} workpiece
 * @param {Object<string, string[]>} bins
 */
function findBinFor(workpiece, bins) {
  for (const [bin, ids] of Object.entries(bins)) {
    if (ids.includes(workpiece)) return bin;
  }
  return null;
}

/** @type {React.CSSProperties} */
const descStyle = {
  margin: "0 0 16px",
  fontSize: 13,
  color: "var(--muted-foreground)",
  lineHeight: 1.5,
};

/** @type {React.CSSProperties} */
const binsWrapStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: 16,
};

/** @type {React.CSSProperties} */
const binSectionStyle = {
  border: "1px solid var(--border)",
  borderRadius: 6,
  background: "var(--muted)",
  padding: "10px 12px",
};

/** @type {React.CSSProperties} */
const binHeaderStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  marginBottom: 8,
};

/** @type {React.CSSProperties} */
const binTitleStyle = {
  background: "transparent",
  border: "none",
  color: "var(--accent)",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
  padding: 0,
  fontFamily: "ui-monospace, Menlo, monospace",
};

/** @type {React.CSSProperties} */
const countStyle = {
  fontSize: 11,
  color: "var(--muted-foreground)",
  fontVariantNumeric: "tabular-nums",
};

/** @type {React.CSSProperties} */
const listStyle = {
  listStyle: "none",
  margin: 0,
  padding: 0,
  display: "flex",
  flexDirection: "column",
  gap: 2,
};

/** @type {React.CSSProperties} */
const itemStyle = {
  fontSize: 12,
  fontFamily: "ui-monospace, Menlo, monospace",
  color: "var(--foreground)",
  cursor: "pointer",
  padding: "2px 4px",
  borderRadius: 3,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

/** @type {React.CSSProperties} */
const moreStyle = {
  fontSize: 11,
  color: "var(--muted-foreground)",
  fontStyle: "italic",
  padding: "2px 4px",
};

/** @type {React.CSSProperties} */
const emptyStyle = {
  margin: 0,
  fontSize: 12,
  color: "var(--muted-foreground)",
  fontStyle: "italic",
};
