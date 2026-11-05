# HUD map (mgux)

Extras for CarPlay's map on the iDrive 7 instrument cluster and head-up display, **beside waze-on-cluster 0.9.0 and its
own app**, which draw the map on either display or both, give the HUD map its black background and soft edges, and set
the HUD map's size and place. HUD map adds, live and for each display: brightness, zoom with a focus point and rotation;
and for the cluster map its place and size. One helper and one app, independent of any fork:

- `mgux-hud-ctl` (`native/mgux-hud-ctl`) - a small root helper. waze-on-cluster is started with its render socket pointed
  at the helper's proxy (`renderproxy.js`), which sits between waze-on-cluster and cluster-render and adds the above to
  each feed's layer while it runs (the last frame is replayed at once when a layer is made again), so nothing restarts
  and CarPlay's cluster stream is never cut. Settings survive a head-unit restart.
- **HUD map** (`designer/`, the app `hud_designer`) - a touch page, also run with the iDrive controller: sliders for
  the settings above and a preview to put the zoom focus on the car.
- `apps/mgux_hud_map` - an older page of buttons (source only, no longer in the catalog).

Needs waze-on-cluster 0.9.0 and cluster-render 0.4.0 (source `robertnisipeanu/idrive-apps`). The designer also needs the
GPU renderer with touch (`idrive7-renderd`) and `mgu-inputgate`, which the idrive7-apps source installs.
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

- tag `mgux-hud-ctl@2.8.0`: `mgux-hud-ctl@2.8.0.tgz`
- tag `hud_designer@1.5.0`: `hud_designer@1.5.0.tgz`
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
Laid out like the car's own Head-Up Display settings, in Vietnamese: a list with − ▬▬ + bars and the row in use lit red.
For the HUD map: Độ sáng, Thu phóng, Xoay, Tâm thu phóng (ngang, dọc) and Đặt lại. For the cluster map also Chiều rộng,
Chiều cao, Độ cao, Vị trí ngang and Căn giữa (its place is only here). "Đang chỉnh" switches between the two. On the
preview, drag the orange + (the zoom focus) onto the car; the cluster map can also be dragged to move it. The iDrive
controller works the list. The kit's fonts have no Vietnamese letters, so `designer/app/viet.js` draws each from its
base letter and stroked marks.

### Beside waze-on-cluster's own app
HUD map **works around** `waze-on-cluster` 0.9.0 and its app (`robertn_waze_cluster`), source `robertnisipeanu/idrive-apps`
(with cluster-render 0.4.0: Store -> Settings -> Add source -> `robertnisipeanu/idrive-apps`), and `mgux-hud-ctl`
requires waze-on-cluster 0.9.0. What that tool and its app have is theirs, and is not here:
- the map on the cluster, the HUD or both; the HUD map's **size and place** and Centre; its **black background** (a HUD
  shows black as nothing: `hud_black_background`), rounded corners and **soft edges** (`hud_edge_fade_pct`); the frame
  rate (`hud_fps`, 10 by default) and Pause. waze-on-cluster draws the HUD's map as a feed of its own, scaled to its
  size.
- mgux-hud-ctl does not touch waze-on-cluster's control socket (one owner at a time: its own app's); it only reads the
  status file waze-on-cluster writes every second (`/run/waze-on-cluster/status.json`) for the line under the preview.

What HUD map adds on top, live and kept across restarts:
- **brightness, zoom with a focus point, rotation** for the HUD map and for the cluster map;
- the **cluster map's place and size** (width, height, place, drag, Centre), which waze-on-cluster only has as a conf
  value (`map_rect`).
The proxy adds these to each feed's layer and passes waze-on-cluster's own `set`s on, so its app's size and move buttons
keep working on the HUD map. With a waze-on-cluster before 0.9.0 there is no feed of its own for the HUD: HUD map no
longer copies the cluster's frames to it.

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