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

## EVA cluster (Sport mode)
`eva_cluster` (`eva/`) is a second app: when the car goes to **Sport**, the whole instrument cluster is redrawn in the
EVA HUD style of the design supplied for this car (330i G20, B48): a 48-segment rev rail on a 0-8000 rpm scale (orange
below 3500, yellow from 3500, red from 5000, flashing from the redline, 6500 by default), the rpm number and a HIGH RPM /
REDLINE warning, the gear (P R N D, S or M by the shifter programme) with its word, a big speed, the drive mode, clock,
coolant (mint, amber from 105 C), range and outside temperature, and the pilot picture. What the design only
simulated (fuel rate, trip distance, "system online", sync, drive link, preview captions) is left out. Other modes
(Comfort, Eco Pro) show BMW's own cluster again (setting per mode in the app).
- It is built on the cluster engine of `bimmer-lab/apps` (MIT): `eva/engine.patch` adds the `evadash` widget (frames, two
  segmented rails and a hatched stripe in ONE effect layer), the `picture` widget, the EVA theme and the tokens
  `{{evaAlert}}` and `{{gearWord}}`; `eva/app/hud/layouts/eva.json` is generated by `eva/tools/gen_layout.py`; the fonts and
  the pilot are baked by `eva/tools/make_assets.py` (the outputs are committed). `node release/eva.js --kit <bimmer-lab/apps
  checkout at the commit in release.yml> --out dist` builds the package (reproducibly).
- With the cluster coded M-style, BMW's own cluster claims the screen slot again and again in Sport, so EVA and the M cluster
  alternate; cluster-render's take-over and the drive-mode debounce (0.1.2 to 0.2.1) did not stop it, and 0.3.0 is back to
  the plain 0.1.1 app (the event log, the debounce, `contend` and the take-over setting are gone). It only puts a leftover
  `panel_take_over_stock = 1` back to `0` through mgux-hud-ctl (nothing happens when it was never set). A normal (not
  M-style) cluster is what it is made for.
- Switching to Sport is quick: the EVA layers are built once at start, hidden (`config.standby`), and a drive-mode change
  only shows or hides them (no new layers, no upload); the HUD map always gives way to EVA while it shows.
- EVA, the HUD map and the cluster's map are kept on three scenes (setting "EVA and the HUD map together", on by default).
  cluster-render gives the cluster's panel and the HUD one scene id (`0x01000400`) and never has both up, so a HUD map shown while
  navigating kept EVA off the cluster. With the setting on, EVA asks `mgux-hud-ctl` (`panelScene`) for
  `panel_scene_id = 0x010004f1` in `/var/opt/cluster-render/cluster-render.local.conf` and cluster-render is restarted once.
  0.5.0 used `0x010004f0` (verified for the panel on another car by PenguinDukeYDAuto), but that is the cluster map's id, and
  the map did not come back on the cluster after EVA (the owner's guess: EVA shares its layer with the map); `0x010004f1` is the
  guide hold's, up only while the cluster's map shows. While EVA shows (it tells the helper with `evaOn` now and every 10 s; the
  helper lets go after 30 s of silence) the helper hides the cluster map's layers, which EVA covers anyway; the HUD map stays.
  Off: the default id is put back and the HUD map's layers give way instead. Experimental: not verified on a car.
- The backdrop covers the whole cluster again (0.4.2 stopped it at y 640 to let BMW's bottom row show, as
  `PenguinDukeYDAuto/idrive7-EVAHUD` does; the owner did not want that row). BMW's gear letter P is drawn above our layers
  and cannot be hidden; 0.5.1 put a small frame around its place (x 1375-1455, y 650-706), which the owner did not like (an empty
  frame when no letter shows), so 0.5.3 leaves plain black there.
- 0.5.1 to 0.5.4 listed cluster-render's status text and the helper's state on the app's page, to find why the map on the cluster was
  missing in Comfort: the KOMBI reported the map slot `0x100` "locked" (`target map: waiting slot locked`), i.e. the cluster's own
  layout has no map area; not EVA's doing. The lines are removed in 0.5.5.
- **Speed correction and tyre pressure (0.8.0):** BMW's speedometer reads a little above the true speed the car sends, so EVA's speed
  was always about 1 km/h lower: the setting "Speed correction" (0-5 km/h, 1 by default) is added to the speed while the car moves (a
  stopped car still reads 0), on the cluster and the HUD. The cluster shows the four tyre pressures (FL FR RL RR, bar; psi with
  the US units) under DRIVE MODE, from `de.bmw.infotainment.vehicle.TPMS` (declared in `app.json` again; the 0.1.0 install failed on
  an interface the unit lacked, 0.1.1 dropped the optional ones, and which one it was is not known: if this install fails, the TPMS
  declaration is the first thing to remove).
- **Rev bar effects and coolant on the HUD (0.9.0):** the rev bar (cluster and HUD) has more going on: the zones are marked on the unlit
  segments (warm before the redline, red from it), the lit part brightens towards a white-hot head, a bright band sweeps along it (from
  3500 rpm, 1.4 s), the frame and a glow round the bar grow with the level and breathe from 5000 rpm, and at the redline the whole bar and
  its last six segments strobe (shift lights). The effects are uniform values (`u_fx`) sent a few times a second, no new layers. The HUD
  layouts also show the coolant (a 14-segment ramp rail and the number, bottom right, clear of BMW's speed; the cluster already had it).
- **Oil temperature and the Redline shift features (0.10.0):** after cauliflowermossgrape's Redline app (MIT; the engine's `shift_score.js`
  already held its rules). The cluster has an OIL panel beside COOLANT (`{{oil}}`), the HUD an oil rail and number with the water
  number beside its caption (the oil is what was missing, not the water). **Shift lights**: 12 on the cluster (above the rev bar) and 10
  on the HUD (in the header), drawn by the `evadash` shader (`lights`): they fill over the last 2000 rpm before the shift point (green,
  yellow, red) and all strobe at it (`u_led`, `u_ledP`). The shift point is the redline minus the new setting "Shift point before the
  redline" (300 rpm), lowered by the **cold-engine guard** (setting, on) until the oil is warm (80 C: 4500 rpm at 30 C, rising in 50 rpm
  steps); the cluster says so (`COLD . LIMIT 5400`). **SHIFT** shows as the warning at the shift point (before HIGH RPM and REDLINE),
  and the cluster has a LAST SHIFT line: the gears, the rpm and the verdict (SPOT ON / EARLY / LATE / LIMITER / COLD REV), coloured by it.
- **Battery and a clean HUD (0.10.1):** the cluster header shows the 12 V battery's charge (`{{battery}}` %, from CDS `statusBattery2`, an
  interface the app already declares; the voltage itself is not on the signals the app can reach). The HUD no longer shows oil or water
  (the oil stays on the cluster). **Boost:** a BOOST readout in the cluster header (`{{boost}}`, from the FES sport display's `displayBoostPressure`, the interface
  the app already declares; M Vitals reads the same field). **S / M again:** `MDrive.dataDisplayGearbox` is declared again, this time with mode `s` (notify only), as
  the M Vitals app declares it (0.9.1 used `rs`, which is the likely reason that install failed); the gear then reads S3 / M3.
  If this install fails, remove that declaration first.
- **EVA Comfort (0.11.0, with mgux-hud-ctl 2.15.0):** a second cluster layout from the owner's `EVA_Comfort_Cluster` design (header with
  the drive mode, rev panel, speed, gear, tyre pressures, a bottom row of coolant, oil, battery and range), chosen per drive mode like
  EVA (settings "Layout", "In Comfort", "In Sport", "In Eco Pro": *EVA Comfort (the map stays in its window)*; off by default, so
  nothing changes until it is chosen). The map window is a see-through hole cut out of the backdrop (new `hole` of the `evadash`
  widget, and `bg: false` for a second, transparent `evadash` layer that holds the car outline and the oil ramp, as the frame arrays
  hold 12 each), and while it shows the helper hides no map layers (`evaOn` with `hide: "none"`, which is why it needs
  mgux-hud-ctl 2.15.0). Where it differs from the design: the header and the rev panel sit as in EVA (the hood hides the top corners),
  the middle row is a little shorter, the map window is 800 wide and BMW's black gear box (x 1406-1597, y 342-419) stays in the gear
  section, the battery shows its charge in % and there are no icons. Only seen on the bench: whether the car's map shows in the
  window (and above or below the panel) needs the car.
  **Look of the reference render** (the second design the owner sent): frames with each corner cut on its own and a glow (`evadash`
  frames take `cut: [tl, tr, br, bl]` and `glow`), a hexagonal gear box and map window, the header in three plates, slanted rules
  (frame `kind: 3`) between the sections of the bottom row, the selector row P R N D M with the engaged letter lit (token
  `{{sel:P}}` .. `{{sel:M}}` over dim letters), tyre pressures with their temperatures beside the car, and coolant, oil and fuel
  rails (a rail takes its own `signal`, `max`, `color` and `plain`; the fuel rail has E and F). Not done: the 3D map art (the real map
  shows in the window) and the italic type.
  The owner's `EVA_Comfort_Complete_Assets` pack adds the art: the four icons of the bottom row (thermometer, oil can, battery, fuel
  pump), the car with its four tyre sensors beside the tyre pressures, and red hazard dashes (drawn by `eva/tools/make_assets.py
  --comfort <folder>`; the baked pictures are committed). They join the text sheets (the layout still has 7 layers, 4.9 MiB). Not
  used: the pack's flat background, header frame and the map, route and turn-arrow art (the real map shows in the window).
- **S and M (0.9.1, withdrawn in 0.9.2):** 0.9.1 declared `de.bmw.infotainment.misc.MDrive` (`dataDisplayGearbox`, the shifter programme)
  and the Store's install failed on the car (`UPDATE_FAILED; the previous version was kept`), so that interface is one the unit lacks;
  it is not declared in 0.9.2. The gear reads D1 .. D8 (S / M only if the gearbox signal itself carries the programme).
- **The gear (0.8.1):** the gear box shows what BMW's selector shows, P R N or D with the engaged gear (D1 .. D8; S / M by the shifter
  programme when known), on the cluster and the HUD (`{{gear}}` instead of `{{stage}}`; fonts `e_gearn`, `w_gear`).
- **EVA HUD on the windshield (0.6.0):** a second display of the same app on cluster-render's `hud` target, from the owner's
  "EVA Windshield HUD" design: the NERV mark, `DRIVE MODE : <mode>`, a 38-segment rev bar (0-8000, the level colours and the flashing
  redline as on the cluster), the gear box (P R N D with its word), the big speed with its unit, and a REDLINE / HIGH RPM warning.
  Nothing for coolant, fuel, trip or the character, as in the design. It has its own connection and layout
  (`eva/app/hud/layouts/eva_hud.json`, generated by `eva/tools/gen_layout_hud.py`; fonts `w_*`), follows the cluster display's car
  data and drive mode (engine patch: `new HudApp(ctx, { follow })`, `config.settingsPrefix` "wind", `config.needs` "separate"), and
  is set per drive mode with the settings "HUD in Sport / Comfort / Eco Pro" (Sport by default). On the glass black is no light, so
  only lines and numbers are drawn, inside the part the driver sees (x 120, y 100, 485x278), clear of BMW's own content at the lower
  left (BMW's white speed there cannot be removed: turning the speed off in the iDrive HUD settings turns the whole HUD off; the
  REDLINE warning is centred to the right of it). A trial layout (0.7.0, `eva_hud_bmw`, the default for Sport) builds the HUD around that
  number instead: no big speed of ours; the big number is the rev count, with a bracket over BMW's speed and "SPEED" at its
  left; the other layout (`eva_hud`) stays selectable in the settings. The position of BMW's number is an estimate from one photo.
  While it shows, `mgux-hud-ctl` (2.14.0: `evaOn` has `who`, the holds of the cluster and the HUD are kept apart) hides the HUD
  map's layers, so in Sport with the EVA HUD the HUD map gives way; in the other modes the HUD map shows as before. It needs
  "EVA and the HUD map together" on (the HUD and the cluster then have their own scenes). Checked on the bench only.
- It needs `cluster-render` (Store source `robertnisipeanu/idrive-apps`). cluster-render has one screen slot for the cluster
  and the HUD, so **the HUD map is off while EVA shows** and comes back in the other modes (what you chose).
- Placed clear of BMW's black gear box (x 1406-1597, y 342-419) and the belt light, and of the hood at the top corners.
  Layers: 8 on one connection (the limit), 4.9 MiB of cluster-render's 16 MiB of pixel memory.
- **Not tested on a car**: only on the bench (headless Chrome, a stand-in for cluster-render). Colours on the real LCD (the
  car brightens dark tints, so panels are pure black), the drive-mode signal and the Sport switch-over need a first run.
- The pilot picture is third-party artwork (see the app's NOTICE); delete `eva/app/hud/pictures/pilot.json` to drop it.

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