# HUD map (mgux)

An independent iDrive 7 (MGU) app that shows the CarPlay map on the instrument cluster,
the head-up display, or both, and resizes and moves it live from the HMI.

- `apps/mgux_hud_map` - the HMI app (a source package, built on the head unit).
- `native/mgux-hud-ctl` - a small root helper. waze-on-cluster is started with its render
  socket pointed at the helper's proxy (`renderproxy.js`), which sits between
  waze-on-cluster and cluster-render. It creates the map's layer on the cluster, the HUD or
  both, and moves or resizes it while the map runs. Nothing restarts, so CarPlay's cluster
  stream is never cut. Settings survive a head-unit restart.

Needs the stock `waze-on-cluster` tool (0.6.0 or newer) from the mgu Store. No fork.
After installing, restart the head unit once so waze-on-cluster starts through the proxy.
Removing `mgux-hud-ctl` in the Store puts waze-on-cluster back on its direct connection.

## Releases (this repository's Store source)
- tag `mgux-hud-ctl@2.0.1`: `mgux-hud-ctl@2.0.1.tgz`
- tag `mgux_hud_map@2.0.0`: `mgux_hud_map@2.0.0.tgz`
- tag `catalog`: `catalog.json`

Add the source in the Store: Settings -> Add source -> `Izionloz/app` (Releases).

## Build
```
node release/tool_artifact.js native/mgux-hud-ctl --out dist
cd apps/mgux_hud_map && node tools/build.js
```

GPL-3.0-or-later. The app is derived from robertn_waze_cluster by Robert Nisipeanu.