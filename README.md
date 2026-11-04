# HUD map (mgux)

An independent iDrive 7 (MGU) app that moves the CarPlay map between the instrument
cluster and the head-up display, and sets its size and position from the HMI.

- `apps/mgux_hud_map` - the HMI app (source package, built on the head unit).
- `native/mgux-hud-ctl` - a small root helper. waze-on-cluster reads its target and
  `map_rect` only at its start, so the helper stores your choice, passes it to
  waze-on-cluster through a drop-in and restarts that service (a few seconds) after
  the last change. The choice survives a head-unit restart.

Needs the stock `waze-on-cluster` tool (0.6.0 or newer) from the mgu Store. No fork.

## Publish (done in the browser)
1. Create a repository on GitHub and upload the contents of this folder.
2. Releases -> "Draft a new release":
   - tag `mgux-hud-ctl@1.1.0`, attach `release-assets/mgux-hud-ctl@1.1.0.tgz`
   - tag `mgux_hud_map@1.3.0`, attach `release-assets/mgux_hud_map@1.3.0.tgz`
   - tag `catalog`, attach `catalog.json` (see below)
3. `release-assets/catalog.json` is ready for `Izionloz/app`; if you use another
   repository, replace `Izionloz/app` in it.
4. Add the source in the Store: Settings -> Add source -> `Izionloz/app`
   (Releases).

## Build
```
node release/tool_artifact.js native/mgux-hud-ctl --out dist
cd apps/mgux_hud_map && node tools/build.js
```

GPL-3.0-or-later. The app is derived from robertn_waze_cluster by Robert Nisipeanu.