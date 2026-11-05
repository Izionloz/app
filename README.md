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
- tag `mgux-hud-ctl@2.6.0`: `mgux-hud-ctl@2.6.0.tgz`
- tag `mgux_hud_map@2.3.0`: `mgux_hud_map@2.3.0.tgz`
- tag `hud_designer@1.2.0`: `hud_designer@1.2.0.tgz`
- tag `catalog`: `catalog.json`

Add the source in the Store: Settings -> Add source -> `Izionloz/app` (Releases).

To release: change the code, bump the component's version (`native/<id>/component.json` or
`apps/<id>/mgu-app.json` or `designer/app/app.json`), run `node release/catalog.js --out dist` and commit
`catalog.json`. On `main`, the
`release` workflow then builds the artifacts (reproducibly: the same bytes as `catalog.json` names), makes the
missing `<id>@<version>` releases and puts `catalog.json` on the `catalog` release. CI fails when the code changed
and the version did not. The workflow builds the designer too, with the idrive7-apps kit at a pinned commit
(`release/designer.js`); its size and sha256 are written into the published `catalog.json`.

### Settings are kept
The helper writes every change to `/var/opt/mgux-hud/state.json` 0.3 s after the last one, with a copy in
`state.json.bak`, and syncs the folder too, so a power cut soon after a change keeps it. At start it reads the file,
else the copy; a file it cannot read is left as it is (not replaced by the defaults). The designer says under its
preview whether the saved settings were restored; `journalctl -u mgux-hud-ctl` says it too.

### Designer
Laid out like the car's own Head-Up Display settings, in Vietnamese: a list (Hiện bản đồ trên, Đang chỉnh, Kích
thước, Chiều rộng, Chiều cao, Độ sáng, Độ cao, Vị trí ngang, Thu phóng, Xoay, Tâm thu phóng, Căn giữa, Đặt lại) with
− ▬▬ + bars and the row in use lit red. Place and size are set in the list only; the preview on the right only
places the zoom focus (the orange +): a touch or drag anywhere on it puts the + under the finger. The kit's fonts have no Vietnamese letters, so `designer/app/viet.js`
draws each from its base letter and stroked marks.

### Zoom focus
CarPlay's cluster map has the car below and right of the middle, so a zoom about the middle pushes the car to the
edge. Each map has a focus (`fx`, `fy`, 0-1 of the picture, the middle by default): the zoom keeps that point in the
middle of the map's rectangle, as far as the zoomed picture still fills it. In the designer, set the zoom to 100 %,
drag the orange + onto the car, then zoom in. The helper sends it as cluster-render's pivot (`px`, `py`).

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