// @ts-check
"use client";

import { Activity } from "react";
import { useTabs } from "@/state/tabs-context";
import { TabVisibleContext } from "@/state/tab-visible";
import ViewFactory from "@/views/factory/ViewFactory";
import ViewLine from "@/views/line/ViewLine";
import ViewStation from "@/views/station/ViewStation";
import ViewBin from "@/views/bin/ViewBin";
import ViewWorkpiece from "@/views/workpiece/ViewWorkpiece";
import ViewWorkRecord from "@/views/work-record/ViewWorkRecord";
import ViewFile from "@/views/file/ViewFile";
import ViewFactoriesOverview from "@/views/factories-overview/ViewFactoriesOverview";
import ViewFactoryLogs from "@/views/factory-logs/ViewFactoryLogs";
import ViewFailures from "@/views/failures/ViewFailures";
import ViewHousekeeping from "@/views/housekeeping/ViewHousekeeping";
import ViewTerminal from "@/views/terminal/ViewTerminal";

/**
 * @typedef {import("@/lib/resource-id").ResourceId} ResourceId
 */

/**
 * Tabs whose effects must keep running while hidden: a terminal's shell
 * session and a log tail end when their effects clean up.
 */
const ALWAYS_ON = new Set(["terminal", "factory-logs"]);

/**
 * Renders every open tab's resource by switching on resource.type, showing
 * only the active one. Inactive tabs stay mounted, so their UI state (open
 * groups, filters, scroll) survives a switch. Data tabs sit in an
 * <Activity>, which pauses their effects (fetching, polling) while hidden;
 * ALWAYS_ON tabs are only hidden, and read TabVisibleContext instead. Each
 * View<X> takes its own narrowed `resource` shape.
 *
 * @returns {React.JSX.Element}
 */
export default function TabContent() {
  const { state } = useTabs();

  if (!state.tabs.some((t) => t.id === state.active_id)) {
    return (
      <div style={emptyStyle}>
        <p style={emptyTitleStyle}>No tab open</p>
        <p style={emptyHintStyle}>
          Click a factory (or anything below it) in the rail to open it as a tab.
        </p>
      </div>
    );
  }

  return (
    <>
      {state.tabs.map((tab) => {
        const visible = tab.id === state.active_id;
        if (ALWAYS_ON.has(tab.resource.type)) {
          return (
            <div key={tab.id} style={visible ? paneStyle : hiddenStyle}>
              <TabVisibleContext.Provider value={visible}>{renderResource(tab.resource)}</TabVisibleContext.Provider>
            </div>
          );
        }
        return (
          <Activity key={tab.id} mode={visible ? "visible" : "hidden"}>
            <div style={paneStyle}>{renderResource(tab.resource)}</div>
          </Activity>
        );
      })}
    </>
  );
}

/**
 * @param {ResourceId} resource
 * @returns {React.JSX.Element}
 */
function renderResource(resource) {
  switch (resource.type) {
    case "factory":
      return <ViewFactory resource={resource} />;
    case "line":
      return <ViewLine resource={resource} />;
    case "station":
      return <ViewStation resource={resource} />;
    case "bin":
      return <ViewBin resource={resource} />;
    case "workpiece":
      return <ViewWorkpiece resource={resource} />;
    case "work-record":
      return <ViewWorkRecord resource={resource} />;
    case "file":
      return <ViewFile resource={resource} />;
    case "factories-overview":
      return <ViewFactoriesOverview resource={resource} />;
    case "factory-logs":
      return <ViewFactoryLogs resource={resource} />;
    case "failures":
      return <ViewFailures resource={resource} />;
    case "housekeeping":
      return <ViewHousekeeping resource={resource} />;
    case "terminal":
      return <ViewTerminal resource={resource} />;
    default: {
      const _exhaustive = /** @type {never} */ (resource);
      return <div>Unknown resource: {JSON.stringify(_exhaustive)}</div>;
    }
  }
}

/** @type {React.CSSProperties} */
const paneStyle = {
  flex: 1,
  display: "flex",
  flexDirection: "column",
  minHeight: 0,
  minWidth: 0,
};

/** @type {React.CSSProperties} */
const hiddenStyle = { display: "none" };

/** @type {React.CSSProperties} */
const emptyStyle = {
  flex: 1,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  color: "var(--muted-foreground)",
  textAlign: "center",
  padding: 32,
};

/** @type {React.CSSProperties} */
const emptyTitleStyle = {
  margin: 0,
  fontSize: 14,
  fontWeight: 500,
};

/** @type {React.CSSProperties} */
const emptyHintStyle = {
  margin: "8px 0 0",
  fontSize: 12,
};
