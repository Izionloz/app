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
- tag `mgux-hud-ctl@2.4.1`: `mgux-hud-ctl@2.4.1.tgz`
- tag `mgux_hud_map@2.3.0`: `mgux_hud_map@2.3.0.tgz`
- tag `hud_designer@1.0.1`: `hud_designer@1.0.1.tgz`
- tag `catalog`: `catalog.json`

Add the source in the Store: Settings -> Add source -> `Izionloz/app` (Releases).

To release: change the code, bump the component's version (`native/<id>/component.json` or
`apps/<id>/mgu-app.json`), run `node release/catalog.js --out dist` and commit `catalog.json`. On `main`, the
`release` workflow then builds the artifacts (reproducibly: the same bytes as `catalog.json` names), makes the
missing `<id>@<version>` releases and puts `catalog.json` on the `catalog` release. CI fails when the code changed
and the version did not. The designer is not built in CI (it needs the kit and the unit's oap-sdk): build it as in
`designer/README.md` and upload it to a release `hud_designer@<version>` by hand.

### Moving the map without a blink (to try)
A brightness change is sent to cluster-render as a `set`. A move, resize, zoom or turn drops the layer and makes it
again (with the last frame replayed). To try sending those as a `set` too, on the head unit:
```
mkdir -p /etc/systemd/system/mgux-hud-ctl.service.d
printf '[Service]\nEnvironment=HUDCTL_LIVE_SET=1\n' > /etc/systemd/system/mgux-hud-ctl.service.d/live-set.conf
systemctl daemon-reload && systemctl restart mgux-hud-ctl
```
If the map then does not move when you move it, cluster-render does not take a place in a `set`: remove the file
and restart the helper again.

## Build
```
node release/tool_artifact.js native/mgux-hud-ctl --out dist
cd apps/mgux_hud_map && node tools/build.js
```
The designer is built with the idrive7-apps kit: see `designer/README.md`.

## Tests
```
npm test
```
Runs the tests in `test/` (Node 18 or newer; the shipped code itself stays Node 8 compatible). CI runs them on every
push. `mgux-hud-map-source.zip` is built from this tree with `npm run zip`: change the files here, not in the zip.

GPL-3.0-or-later (the kit patches and the designer app follow the kit's MIT license). The HMI app is derived from
robertn_waze_cluster by Robert Nisipeanu.