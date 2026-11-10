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
The focus only acts above 100 % zoom. While an EVA layout holds the display, dragging the + at 100 % raises the zoom to
130 % so the move is visible at once (the note in the designer says so).

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
  The owner's `EVA_Comfort_Complete_Assets` pack adds the art: the four icons of the bottom row (coolant temperature, oil temperature, battery, fuel pump: Material Design Icons, Apache 2.0, `eva/tools/icons/`), the car with its four tyre sensors beside the tyre pressures, and red hazard dashes (drawn by `eva/tools/make_assets.py
  --comfort <folder>`; the baked pictures are committed). They join the text sheets (the layout still has 7 layers, 4.9 MiB). Not
  used: the pack's flat background, header frame and the map, route and turn-arrow art (the real map shows in the window).
- **EVA Comfort from the owner's icon pack (0.11.1):** the layout now uses the `EVA_HUD_Icons` pack (cut out of the reference render):
  its four icons for the bottom row, the glowing car with its tyre sensors and the red slashed stripes. The new frame shader is a
  separate type, `evadash2` (8 frames a layer); EVA Sport and the HUD keep `evadash`, whose shader is the one that ran on the car in
  0.10.1 (0.11.0 changed that shared shader, and the owner's cluster went dark; the cause is not confirmed, so the shared one is back
  as it was and only EVA Comfort uses the new one).
- **EVA HUD Comfort (0.12.0, the map back in 0.13.0):** a third HUD layout, `eva_hud_comfort` (settings "HUD in Comfort" etc.: *EVA HUD Comfort*; off by
  default): a header (mode, outside temperature, clock), the shift lights and a thin rev rail, the gear box at the left and the HUD map in the
  middle. The app sends `evaOn` with `mapRect` for the HUD (800x480 pixels: 350x154 at x 242, y 200, the map's shape; `HUD_COMFORT_MAP`) and
  `hide: "none"`; the helper puts the HUD map there (its brightness and soft edges are kept) and does not hide it. The HUD map is a layer of
  the same `hud` target as the EVA HUD's own layers, which are transparent and above it, so it is in EVA's own scene and does not depend on
  anything but the HUD itself. BMW's own speed is left alone. The lines are drawn by one transparent `evadash2` layer.
- **The CarPlay map in EVA Comfort's window (0.12.0, with mgux-hud-ctl 2.16.0):** while EVA Comfort shows, the app sends the helper the
  window's rectangle (`evaOn` with `mapRect`, in the map target's own 1088x480 pixels: the window 594x262 at cluster x 506, y 336, the
  map target sitting at x 416, y 120 as in the bimmer-lab cluster themes) and the helper puts the cluster map there (its place, size
  and brightness setting for the map are left alone and nothing is saved; the zoom and turn are 1 and 0 while it does), then gives
  the map back its own place when EVA Comfort stops. The window has the map's shape (1088:480), so the picture is not stretched, and the
  frame fits it (604x268); the speed and gear panels take the room that frees. Where the map target really sits on the cluster is not measured on this car.
- **BMW's gear box in Comfort Plus (0.12.1):** a photo from the car (Nov 7 2026, EVA Comfort) shows BMW's white gear indicator ("D2") at the
  bottom of the cluster, about x 1380-1445, y 670-710, not at the Sport spot (x 1406-1597, y 342-419). EVA Comfort's bottom row now leaves
  x 1350-1460 free for it (range moved right) and the gear panel no longer keeps clear of the Sport spot.
- **EVA Comfort (big map) (0.13.0):** a second Comfort layout, `eva_comfort_wide` (settings "In Comfort" etc.: *EVA Comfort (big map, the CarPlay
  picture cropped)*), for the wider map the owner asked for: the window is 936x264 (cluster x 440, y 336) between a narrower speed panel and a
  gear panel that takes BMW's gear box (x 1406-1597, y 342-419) in whole, with a margin (x 1394-1603, y 332-592). A window that wide cannot have the map's shape, so the map is drawn at its own shape (936x414) behind the window, with its
  top 150 px above it, and the window crops it: the backdrop, which is above the map, hides what is outside, and CarPlay's guidance bar at
  the top of its picture goes with it. That relies on the panel being above the map layer (it is what the README says of EVA covering the
  cluster map; not checked in a photo): if the map shows over the rev panel, use *EVA Comfort* (the first one) instead. `evaOn`'s `mapRect`
  is the rectangle for either layout; the helper needs no change.
- **The CarPlay map in EVA Comfort's own layer (0.13.0, with mgux-hud-ctl 2.17.0):** the BMW cluster shows the map slot (0x100, "the central map area
  under the gauges") only in its map view, so the map vanished whenever the cluster changed view or drive mode. Now, with the setting
  "EVA Comfort: draw the CarPlay map in EVA's own layer" (on by default), the app sends `evaOn` with `panelMap: true` and its `mapRect`, and the
  helper's proxy makes waze-on-cluster's video layer on the **panel** target (the whole-panel slot 0x203, where waze-on-cluster itself puts the
  map at x 416, y 120 when told to run `panel`) in that rectangle instead of on `map`: it is part of EVA's own scene, whatever the BMW cluster
  shows. EVA Comfort's backdrop is class `overlay` and its texts and pictures `alert`, so the map (class `content`) sits under the backdrop and
  shows through its hole, and what the map has outside the window is hidden by the backdrop (the big-map layout relies on that). Only the
  cluster's map moves (the HUD's stays); with the setting off, or the helper older than 2.17.0, it is as before. Not checked on the car.
- **BMW's gear indicator (0.13.2 - 0.13.4, the page rows removed again):** the white gear indicator ("D2") is drawn by the BMW cluster over everything the
  panel has, and nothing in cluster-render's layer protocol can cover it. cluster-render can *hold a slot* so that a box of BMW's is not shown (the
  turn-guidance box, `guide_hold`, `guide_slots`), but its take-over is limited to `guide_take_over` (0x01000310) and runs only while the `map`
  target shows; the seat-belt panel 0x01000314 is refused there on purpose. Whether the gear indicator is a slot box at all is not known. The slot
  table of the owner's car (Nov 7 2026, EVA Comfort, read from the page of 0.13.3): `0x100 s2 0x1000300 c0 m1` (the central map area, shown by the stock map
  0x01000300), `0x101 s2 0x1000312 c1024 m1, 0x1000311 c0 m3`, `0x102 s0 0x1000313`, `0x103 s1`, `0x104 s1`, `0x105 s0`, `0x111 s1`, `0x200 s0`,
  `0x201 s1 0x1000600`, `0x202 s1` (status 0 disabled, 1 free, 2 taken). 0x101's box is only a candidate. The page rows that showed the table (and what
  changed in it) were taken out at the owner's request; the app log still has cluster-render's status, slot rows included.
- **Tidied (0.14.2):** EVA keeps the Sport layout (`eva`) and one Comfort layout, the big-map one (`eva_comfort_wide`, now called "EVA Comfort"); the small-map Comfort (`eva_comfort`) is gone. A setting saved as the old one falls back to the default. The HUD keeps its layouts. The page of 0.14.1 draws the kit's header so the knob starts there.
- **Numbers that were not shown (0.23.2):** on the car the torque, power, G LAT, G LONG and load read "--" and the boost 0.00. The app did not declare the signals they need (the kit only passes the signals an app lists in `app.json`): the g forces (`CDS2` statusLongitudinal/LateralAccelerationMassCenter), the engine's torque (`FES` statusActualValueTorque2, for the torque, the power % and the load %), and the engine unit over read-only UDS for the boost (`InternalTasu` and `config.dme`, copied from the kit's other apps; the car's sport display sends no boost here). They are declared now, as in the kit's cluster_themes app. Whether this car sends them is only known on the car.
- **Layer fix (0.23.1):** the car draws 8 layers a connection and drops the ninth, so a layout that needs more loses its last sheet, usually the bottom row (the owner's photo: EVA Comfort with no coolant, oil, battery or range). EVA Comfort needed 9 layers since the columns of 0.14.3 (and EVA, the Sport layout, 10): text boxes that overlapped made extra sheets. The boxes are narrowed so that they do not overlap and the right units sit in the same sheet; EVA Comfort now needs 7 layers and EVA 7. A test now plans every layout as the engine does (`shared/hud.js`: groups by class and z, an overlap opens a new sheet, the size limit is doubled up to unlimited) and fails if one needs more than 8 on a connection.
- **EVA V12 GPU text (0.23.0):** a test of the advice to pre-load textures and draw from them instead of streaming pixels: `eva_v12_gpu` is V12 with its three biggest numbers (the speed, the rpm, the gear) as `atext` widgets. The glyph atlas of each font goes up once (an R8 asset, 0.6 + 0.1 + 0.7 MiB) and a new value is one small uniform message, no pixels, no 5-a-second limit; each is a layer of its own on a second connection to cluster-render (`conn: 1`; 8 layers per connection), so the 8 layers of the rest stay (11 layers on 2 connections, 10.2 MiB of pixel memory on the bench). The cells are all alike, so the numbers are right-aligned in them; the gear is one cell showing `{{gearnum}}` (the programme is in the selector row); the three have no glow (a GPU text has none). Made by `eva/tools/gen_layout_v12_gpu.py` from `eva_v12.json`; pick it as "V12 GPU". On the bench it looks like V12; whether it is smoother and lighter on the car is not known yet (the second connection and the R8 asset have not run on a car by this app).
- **A gallery of layout pictures (0.22.1):** the EVA page on the center screen has three tabs in its header, Cluster, HUD and Options. Cluster shows a card with a picture for every cluster layout (240x90, baked from bench pictures by `eva/tools/make_previews.py` into `hud/previews/<layout>.json` and drawn with the kit's pixel images), the chosen one lit and small letters D, C, S, E on a card for the settings that use it (default, Comfort, Sport, Eco Pro); the chips above say whose layout a tap sets (the default one or a drive mode's), and "By drive mode" is there too. Options has the rows (drive-mode layouts, the HUD, units, clock, redline and the rest). The HUD tab is the same for the windshield HUD's layouts (pictures 240x138 of the part of the HUD the driver sees, and the chips set the HUD's default or drive-mode layout). A layout with no picture gets a plain card. Pictures are of the bench, not the car.
- **EVA Vector (0.21.1, with five more colourings):** a modern, sporty, science-fiction cluster of our own: black, steel-blue lines with hot orange accents, slanted panels, no map. Two big glass dials with a technical look (a ring of short segments, two hairline rings, bracket corners, a glow round the lit part, a flare on the needle): the left one the rev counter with the rpm as seven-segment digits, the right one the speed along the speed scale with big seven-segment digits under BMW's black gear box; between them a slanted bar with the drive mode and the clock, a wedge with the gear and the selector row P R N D S M, three chips (boost, torque, load) and the four tyres; the bottom row of coolant, oil, battery and range; stars, a vignette and light streaks from the middle behind. Three effect layers (the frames, the left dial as a whole-cluster layer, the right dial) and five sheets make the 8 layers. New in `eva/engine.patch`: `evadial` `flat: 3` (the technical lines and segments, flat colours, but the glow, stars and vignette stay). Pick it in "In Comfort / In Sport / In Eco Pro". Checked on the bench, not on the car. Five more colourings of the same layout, chosen by the owner from a sheet of samples: `eva_vector_red` (fire red, yellow accents), `_violet` (neon purple, pink), `_lime` (acid green, yellow), `_mono` (white, red accent) and `_gold` (amber, orange); made by `eva/tools/gen_layout_vector_colours.py` (the layouts and the recoloured icons `v_*_r _v _l _m _g`). The settings page shows the layout cards four to a row so that all of them fit.
- **EVA Neo (0.20.0):** our own cluster design (ideas, not copies, from the open-source digital clusters looked at): two glass dials either side of a column, no map, no frames. The left dial is the rev counter (ring, ticks, needle, the red zone, 11 shift dots from both ends) with the rpm as seven-segment digits; the right dial shows the speed along the speed scale (`{{spd:0..8}}` labels, so mph and km/h both fit) with the speed as big seven-segment digits under BMW's black gear box; between them the clock and the drive mode, the gear with its selector row P R N D S M, boost, torque and load, and the four tyres; the bottom row of coolant, oil, battery and range. The seven-segment fonts `e_seg` and `e_segs` are drawn by `eva/tools/make_seg.py`, not taken from a font. In `eva/engine.patch` the `evadial` layer got `signal: 'speed'` (the speed scale), `redFrom`, `fx: false` (no streaks, stars or flash), `clip`, `bg` (the layer paints the whole cluster black: the left dial's layer is the whole cluster, so it is BMW's gauges' cover, the stars' and the vignette's, and the warp streaks fly from `origin`, the middle of the cluster) and `origin`. Two effect layers and six image sheets make the 8 layers. Pick it in "In Comfort / In Sport / In Eco Pro". Checked on the bench, not on the car.
- **EVA HUD V12 (0.19.0):** the V12 look for the windshield HUD, kept small and technical: `eva_hud_v12` (yellow), `eva_hud_v12_sport` (red), `eva_hud_v12_eco` (blue), chosen in "HUD layout" and "HUD in Comfort / Sport / Eco Pro". A round rev counter in the HUD's visible window made of short segments (ring, ticks, needle, 11 shift dots filling from both ends, the red zone's 7 and 8) with two thin hairline rings and yellow bracket corners round it, the speed inside it and the gear beside it, and the redline alert; no header, selector row or rpm digits. While the car accelerates, thin flat light streaks fly out from the ring to the edges of the window (outside the ring only, so the speed stays clear; "Light effects" turns them off). BMW's own white speed stays under the ring's open bottom. On the glass black is no light, so the counter is `flat` (`flat` 1: flat colours, no dish, bezel, vignette, stars, shading, glow or shadows; `flat` 2 adds the technical lines and the segments). Drawn by `eva/tools/gen_layout_hud_v12.py`. Checked on the bench, not on the car.
- **EVA V12 (0.17.1):** a new cluster layout in the manner of a V12 grand tourer's display: black, white lines, one accent colour, no map. A big round rev counter in the middle (ring, lit part, red zone from the redline, ticks, 0-8 numbers) with the speed and the rpm inside it, boost, torque, power and the shift point on the left, the g forces and the load at the top right, the gear (under BMW's black box, with a selector row P R N D S M: D, S and M each lit on its own, new token `{{selx:X}}`) and the tyres, and the bottom row of coolant, oil, battery and range. Three colourings, one per drive mode: `eva_v12` (Comfort, yellow), `eva_v12_sport` (red), `eva_v12_eco` (blue): pick each in "In Comfort / In Sport / In Eco Pro". The counter is one new effect layer, `evadial` (shaders.js, in `eva/engine.patch`): an analog needle with a glow runs over the ring, the counter sweeps up to the end of the scale and back for 1.5 s whenever the layout shows ("sweepMs"), and 15 shift dots round the top fill from both ends towards the middle (green, yellow, red) and strobe at the shift point ("wings"). The counter has depth: a dark dish with a sheen of glass and a soft diagonal reflection, a shadow on its inner side by the ring, a chrome bezel with bright and dark stretches, a ring that reads as a tube (bright along its middle, with a highlight) and a glow round its lit part, shadows under the ticks and the needle, and glass beads for the shift dots. While the car accelerates, light streaks fly out of the middle, over the ring and on to the edges of the whole cluster (a little fainter over the panels, so their words stay clear), as in a jump to light speed; the counter is a layer over the whole 1920x720 cluster for that (`evadial` `u_w`): the strength follows the speed's change a second, smoothed (quick to rise, slow to fall: about 0.06 g starts it, 0.32 g is full), and the start-up sweep runs it too; more light effects came in 0.17.0, all in the one `evadial` layer: a field of faint stars drifting far back, a vignette that darkens the cluster's edges, a red glow from the edges at the redline, a brief white flash when the shift point is reached, the lit part of the ring burning brighter towards its head like a comet, a flare at the needle's tip, and the chrome bezel's highlight moving with the rpm. The setting "Light effects (V12)" turns the stars, the streaks, the flash and the red glow off (the clock for them is 8 messages a second while only the stars drift, 25 while streaks or a flash show). `evadash2` takes an optional `pal` (three line colours). Drawn by `eva/tools/gen_layout_v12.py`; the icons in the three colours by `eva/tools/tint_v12.py`. Ideas looked up in open-source clusters (idrive7-EVAHUD, MIT, and Qt/QML demos); no code or asset was copied from them. Checked on the bench (a picture, 8 layers, 8.6 MiB), not on the car.
- **Readout columns (0.14.4):** EVA Comfort's map window sits in the middle between two columns, ENGINE on the left (boost, torque, power % of the peak) and DYNAMICS on the right (lateral and longitudinal g, the shift point). The map is still the one 936x414 map; the window (`hole` [608, 336, 600, 264]) shows its middle.
- **EVA's own page (0.14.0):** the center screen's EVA page is no longer the HMI's list of words. It is a page drawn like the HUD map app's (three columns: CLUSTER with the four layout cards, the drive-mode rows and the CarPlay-map switch; HUD (WINDSHIELD) with its layouts and the status lines; GENERAL with units, clock, redline, shift point, speed correction, cold-engine guard and demo data). A tap, or the controller turned onto a row and pressed, changes a setting at once. Drawn by `eva/app/settingsui.js` on the kit's canvas (`cv.target`), so it needs the GPU renderer with touch; elsewhere the page shows the values and the Settings button opens the HMI's own list, which keeps every setting. Checked on the bench (a picture of the page and the loop running), not on the car.
- **Adjusting EVA's map windows in the HUD map app (0.13.5, with mgux-hud-ctl 2.18.0):** while an EVA layout holds a display's map (EVA Comfort's cluster
  window, EVA HUD Comfort's middle), the designer's sliders and buttons for that display work on *that rectangle*: the page shows the layout's
  rectangle (a note says the change is for EVA's window), and a move, a size, the zoom, the focus, the turn or the brightness set there is
  kept for that layout (`evaRects` in the helper's state, per display and layout: `map:eva_comfort_wide`) and used in place of the layout's own,
  also after EVA stops and comes back; Centre or Reset on that display puts the layout's rectangle back. The display's own rectangle (when EVA
  does not hold it) is not changed by these edits and works as before. For the big-map layout (the map is cropped by the window) a move or a
  zoom pans the map behind the window.
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
  number instead: no big speed of ours; the big number is the rev count (0.13.4: the bracket over BMW's speed and "SPEED" at its left are
  gone); the other layout (`eva_hud`) stays selectable in the settings. The position of BMW's number is an estimate from one photo.
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