# Remote data: control-room vs. VS Code Remote-SSH

How control-room gets data from a remote host, how VS Code Remote-SSH does the same job, and which of VS Code's pieces control-room should copy. It was written after switching tabs on an SSH host turned out to take seconds per tab while VS Code over SSH feels instant. Read this before changing caching, polling or the SSH transport.

## TL;DR

- VS Code feels instant for three separate reasons: **a client-side cache** (switching tabs never touches the network), **push-based change events** (the remote tells the client what changed) and **one long-lived connection** to a server process on the remote.
- control-room currently has none of the three. Switching tabs unmounts the view and drops its data. Every query is a fresh `ssh … node -` that pipes the whole probe in, starts node, re-reads the factory from disk and exits.
- Adopt them in that order. The cache fixes the lag on tab switches by itself (see `docs/wip/tab-data-cache.md`). Push events and a long-lived process are for later and are described here so the design stays connected.

## How control-room fetches today

```
tab becomes active
   → View<X> mounts → use<X>Data → useFetcher (state starts at null)
   → invoke("show_line", {host, factory, line})
   → Source::Ssh → ssh -o ControlMaster=auto … -- <alias> 'node --input-type=module -'
        stdin  = probe.js + main(<query>)
        remote = node starts, walks temp/stations + .orchestrator, prints JSON, exits
   → view renders
tab becomes inactive
   → View<X> unmounts → data is gone
```

Per call on a remote host you pay for the network round trip, an ssh exec on the existing ControlMaster socket, sending the probe source, node startup and a full read of the factory. ControlMaster saves only the SSH handshake. On `local` the same call is a few filesystem reads in Rust, so the problem is barely visible there.

Freshness today comes from three sources:
- **Remounting.** Every tab switch refetches. Freshness is a side effect of the lag.
- **`counts-store.js`.** `hostCounts` is polled every 2s, with one probe call for the whole host. Rail rows show the counts. Bin views include their count in `useFetcher`'s deps, so a bin refetches when its count moves. This is a cheap, coarse change signal that already exists.
- **`data-epoch.js`.** Bumped after a clear or retry from this window. Every mounted `useFetcher` re-runs.

## How VS Code Remote-SSH does it

| Concern | VS Code Remote-SSH | control-room today |
|---|---|---|
| Remote side | Installs `vscode-server` on the host once and keeps it running | No install. The probe is piped in on every call |
| Connection | One SSH connection with a multiplexed RPC channel over it. Each request costs about one round trip | A new process per query: ssh exec + node start + probe |
| Change detection | The server watches files with OS events (inotify on Linux, via `@parcel/watcher`) and **pushes** change events to the client | Polling: counts every 2s, plus a refetch on every remount |
| Client state | Each open document is an in-memory model. A tab switch just shows a different model; models are freed when the tab closes | State lives in the component and is lost on unmount |
| On change | Re-reads only the changed resource | Re-reads the whole query |

Changes show up almost immediately in VS Code because a change event arrives and the client re-reads that one file. Tab switches cost nothing because they never use the network.

## Mapping it onto control-room

### 1. Client-side cache (doing now)
Data lives in a cache keyed by query, outside React components. A view that mounts shows the cached result immediately and refreshes in the background (stale-while-revalidate). Identical queries that are already in flight share one call. The epoch and counts signals invalidate entries instead of remounting views. Details are in `docs/wip/tab-data-cache.md`.

This is the counterpart of VS Code's text models. It needs no Rust or probe changes.

VS Code also keeps each editor's **view state** (scroll, folding, selection) across tab switches. control-room gets the same by keeping inactive tabs mounted but hidden. Data tabs are hidden in React's `<Activity>`, which pauses their fetching and polling until shown, when they catch up. Terminal and logs tabs stay fully running while hidden, so a shell session or log tail survives a switch.

### 2. Push change events (later)
- **Local:** watch each factory's `temp/stations` and `.orchestrator` with the `notify` crate.
- **Remote:** run one long-lived `ssh <alias> node -` per host with the probe in watch mode (`fs.watch(root, { recursive: true })`). It writes one debounced JSON line per change to stdout. This keeps the "nothing installed on the host" property.
- Rust emits `factory-changed { host, factory, paths }`. The cache marks matching keys stale and refetches only those that a mounted view is reading. The process lifecycle matches the pm2 log tail: managed state, killed when the window closes.
- Once this works, `counts-store` polling can become a fallback for when the watcher is down.

Caveats:
- Recursive `fs.watch` on Linux needs Node 20 or later and uses one inotify watch per directory, so large `temp/stations` trees can hit `fs.inotify.max_user_watches`. The fallback is a cheap "stamp" query (bin-directory mtimes) polled every few seconds.
- The watch mode belongs in al-control's `src/probe.js` first, then gets copied here (probe parity).

### 3. One persistent process per host (later, if needed)
The watcher process from step 2 can also serve queries: requests go in on stdin and responses come back on stdout, one JSON line each. That removes the ssh exec and node startup from every call, leaving about one round trip per query. This is the `vscode-server` equivalent. It still doesn't need an install, because the probe is streamed in when the process starts.

Measure before building it: time one call against a remote host and split it into ssh exec, node startup and probe work. If the round trip dominates, step 3 gains little.

## What not to copy

- **Installing a server on the host.** control-room's promise is that a remote host needs only node (and pm2). Streaming the probe over stdin gives the same long-lived process without an install step or version management.
- **A full remote filesystem abstraction.** VS Code needs arbitrary file editing. control-room reads a handful of probe-shaped queries and has two guarded writes (clear, requeue). Keep the `Source` trait narrow.
