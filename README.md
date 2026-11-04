# HUD map (mgux)

CarPlay's map on the iDrive 7 instrument cluster, the head-up display, or both, changed live: size, position (also
edge by edge), brightness, zoom and rotation, separately for each display. Two apps and one helper, all independent
of any fork:

- `mgux-hud-ctl` (`native/mgux-hud-ctl`) - a small root helper. waze-on-cluster is started with its render socket pointed
  at the helper's proxy (`renderproxy.js`), which sits between waze-on-cluster and cluster-render. It creates the map's
  layer on the cluster, the HUD or both and re-creates it with the new settings (the last frame is replayed at once), so
  nothing restarts and CarPlay's cluster stream is never cut. Settings survive a head-unit restart.
- **HUD map** (`apps/mgux_hud_map`) - a page of buttons and bars (source package, built on the head unit).
- **HUD map designer** (`designer/`) - a touch page: drag the map on a preview, drag the dots to resize, move sliders.

Needs the stock `waze-on-cluster` tool (0.6.0 or newer) from the mgu Store. The designer also needs the GPU renderer
with touch (`idrive7-renderd`) and `mgu-inputgate`, which the idrive7-apps source installs.
After installing, restart the head unit once so waze-on-cluster starts through the proxy.
The map shows only while CarPlay is navigating (the phone draws nothing otherwise).
Removing `mgux-hud-ctl` in the Store puts waze-on-cluster back on its direct connection.

## Releases (this repository's Store source)
- tag `mgux-hud-ctl@2.4.0`: `mgux-hud-ctl@2.4.0.tgz`
- tag `mgux_hud_map@2.3.0`: `mgux_hud_map@2.3.0.tgz`
- tag `hud_designer@1.0.1`: `hud_designer@1.0.1.tgz`
- tag `catalog`: `catalog.json`

Add the source in the Store: Settings -> Add source -> `Izionloz/app` (Releases).

## Build
```
node release/tool_artifact.js native/mgux-hud-ctl --out dist
cd apps/mgux_hud_map && node tools/build.js
```
The designer is built with the idrive7-apps kit: see `designer/README.md`.

GPL-3.0-or-later (the kit patches and the designer app follow the kit's MIT license). The HMI app is derived from
robertn_waze_cluster by Robert Nisipeanu.