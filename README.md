# HUD map (mgux)

CarPlay's map on the iDrive 7 instrument cluster and head-up display, changed live: where it shows (cluster, HUD or
both), its size and place, brightness, soft edges (HUD), zoom with a focus point and rotation, separately for each
display. One helper and one app, independent of any fork:

- `mgux-hud-ctl` (`native/mgux-hud-ctl`) - a small root helper. waze-on-cluster is started with its render socket pointed
  at the helper's proxy (`renderproxy.js`), which sits between waze-on-cluster and cluster-render and looks after the
  map's layers while they run (the last frame is replayed at once when a layer is made again), so nothing restarts and
  CarPlay's cluster stream is never cut. Settings survive a head-unit restart.
- **HUD map** (`designer/`, the app `hud_designer`) - a touch page, also run with the iDrive controller: a list of
  sliders and a preview to put the zoom focus on the car.
- `apps/mgux_hud_map` - an older page of buttons (source only, no longer in the catalog).

With **waze-on-cluster 0.9.0** (source `robertnisipeanu/idrive-apps`, with cluster-render 0.4.0) the HUD map also has
a black background, which a HUD shows as nothing (see below). The designer also needs the GPU renderer with touch
(`idrive7-renderd`) and `mgu-inputgate`, which the idrive7-apps source installs.
After installing, restart the head unit once so waze-on-cluster starts through the proxy.
The map shows only while CarPlay is navigating (the phone draws nothing otherwise).
Removing `mgux-hud-ctl` in the Store puts waze-on-cluster back on its direct connection.

## Releases (this repository's Store source)
In the Store this is one app, **HUD map** (`hud_designer`). It requires the background service **HUD map
(background service)** (`mgux-hud-ctl`, a root tool: it must run from start-up, with no app open), so the Store
installs and updates that first; the service is marked optional, so it is not offered on its own. `release/catalog.js`
keeps every `requires` on a component of this repository at its current version. The older button app
(`apps/mgux_hud_map`) stays in the source but is no longer in the catalog: HUD map does all it did, the iDrive
controller included (turn to move the red row, press to change a setting and turn to step it, press or push left
to end) and the map's state from waze-on-cluster under the preview.

- tag `mgux-hud-ctl@2.9.1`: `mgux-hud-ctl@2.9.1.tgz`
- tag `hud_designer@1.6.1`: `hud_designer@1.6.1.tgz`
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
A layer made when the head unit starts could keep only part of its place (on the car the height stayed the default
until a setting was touched), so the proxy sends the whole layout again as a `set` with the first frame, 1.5 s and
5 s after making a layer, whenever the renderer says the layer changed state, and after each of waze's own `set`s.

### Designer
Laid out like the car's own Head-Up Display settings, in Vietnamese: a list with − ▬▬ + bars and the row in use lit red:
Hiện bản đồ trên (Đồng hồ, HUD, Cả hai, and with waze-on-cluster 0.9.0 "Theo app waze-on-cluster", the default, which
leaves the choice to its own app), Đang chỉnh (the HUD map or the cluster map), Chiều rộng, Chiều cao, Độ sáng, Làm
mờ viền (HUD), Độ cao, Vị trí ngang, Thu phóng, Xoay, Tâm thu phóng (ngang, dọc), Căn giữa and Đặt lại. On the preview,
drag the map to move it and the orange + (the zoom focus) onto the car. The preview draws the map as the display does:
its rectangle zoomed and turned about the pivot, reaching past the rectangle (a thin outline), with the soft edges along
its own sides. The iDrive controller works the list. The
kit's fonts have no Vietnamese letters, so `designer/app/viet.js` draws each from its base letter and stroked marks.

### With waze-on-cluster 0.9.0 and its own app
waze-on-cluster 0.9.0 draws the cluster's map and the HUD's each as a feed of its own connection and layer, the HUD's
scaled to the size it is shown at with a **black background** (a night map's field fades to black, so the HUD shows the
roads, route and labels), rounded corners and optional feathered edges (`hud_black_background`, `hud_round_corners`,
`hud_edge_fade_pct`; `hud_fps` is the HUD's frame rate, 10 by default). It starts with the HUD **off** (`hud = 0`).
mgux-hud-ctl works with it and with its app (`robertn_waze_cluster`):
- **Where the map shows.** With "Hiện bản đồ trên" on Đồng hồ, HUD or Cả hai, the helper asks waze-on-cluster for those
  feeds (`{"cmd":"cluster"|"hud","on":...}`) and asks again when it finds them otherwise (after a restart, or if its
  app changed them). It does so in a short visit to the control socket (connect, send, close): the socket has one
  owner at a time, which is its own app, and waze-on-cluster does nothing when an owner goes, so the app is free
  whenever it is opened. On "Theo app waze-on-cluster" nothing is asked. The helper otherwise only reads the status
  file waze-on-cluster writes every second (`/run/waze-on-cluster/status.json`).
- **Place and size of the HUD map.** They are waze-on-cluster's own (its app's size and move buttons) until a place or
  size is changed here (width, height, place, drag, Centre); from then on they are ours, and the frame waze-on-cluster
  scales is sized to match (`hud_width_pct`). "Đặt lại bản đồ này" gives them back. The preview says "(theo waze)"
  while they are its.
- **Soft edges** here are a layer over the HUD map (below), on top of whatever `hud_edge_fade_pct` does.
Without 0.9.0 (its status has no `hud_state`), the proxy copies the cluster's frames to the HUD as before: the HUD then
shows Waze's own background, and HUD map says so under the preview.

### If the HUD shows nothing
The line under HUD map's preview names both feeds:
- **"HUD tắt (chọn ở Hiện bản đồ trên)"**: waze-on-cluster starts with the HUD off. Set "Hiện bản đồ trên" to HUD or
  Cả hai (it is kept, and asked again after each start), or choose it in waze-on-cluster's own app.
- **"HUD bị cluster-render chặn"** (`hud_state` `disabled`): cluster-render's mapping guard turned the HUD off after two
  restarts of the cluster renderer in 10 s, which several updates in a row can cause. As root: `cluster-render
  guard-reset` (choosing the HUD again does not undo it).
- **"HUD chờ CarPlay dẫn đường"**: nothing is wrong, the HUD shows the map while CarPlay navigates.
- **"chưa thấy waze-on-cluster"** or **"cũ"**: it is not running, not 0.9.0, or the head unit was not restarted.

### Soft edges (HUD)
So the HUD map does not end in a square, its four sides fade out (`fe`: how far in, as a part of its shorter side;
0.15 by default, 0 to 0.45; "Làm mờ viền"). The proxy puts an effect layer just above the HUD map, at its place and
turn **and scale** (zoom, about the same pivot), showing and hiding with it: black, opaque at the sides and clear inside (`FEATHER_FS`, GLSL ES 1.00, `u_f` the
fade's width as a part of the width and height). cluster-render blends quads with their alpha and black is no light on
the HUD, so the map fades into the glass. A change of `fe` is a `uniform`, not a new layer. Not on the cluster, where
the fade would be a black frame.

### Zoom focus
CarPlay's cluster map has the car below and right of the middle, so a zoom about the middle pushes the car to the
edge. Each map has a focus (`fx`, `fy`, 0-1 of the picture, the middle by default): the zoom keeps that point in the
middle of the map's rectangle, as far as the zoomed picture still fills it. In the designer, set the zoom to 100 %,
drag the orange + onto the car, then zoom in. The helper sends it as cluster-render's pivot (`px`, `py`).

### Moving the map without a blink
A move, resize, zoom, turn or brightness change is sent to cluster-render as a `set` on the layer, which re-places
it (cluster-render's `server.cpp` `apply()` -> `Compositor::changed()` -> `place()`), so the map follows a drag
without a blink. Should an older cluster-render not move the map that way, go back to dropping and re-making the
layer on the head unit:
```
mkdir -p /etc/systemd/system/mgux-hud-ctl.service.d
printf '[Service]\nEnvironment=HUDCTL_LIVE_SET=0\n' > /etc/systemd/system/mgux-hud-ctl.service.d/live-set.conf
systemctl daemon-reload && systemctl restart mgux-hud-ctl
```

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