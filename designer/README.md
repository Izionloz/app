# HUD map designer

A touch page for the HUD map: drag the map on a preview of the HUD or cluster, drag a dot to resize, move the
sliders for size, brightness, zoom and rotation. It is an app of the idrive7-apps kit
(https://github.com/cauliflowermossgrape/idrive7-apps, MIT) and talks to `mgux-hud-ctl`.

- `app/` - the app (`app.json`, `main.js`, `designer.js`, `hudclient.js`, `icon.png`).
- `kit-patch/` - three files of the kit with a small addition: `ctx.onTouch(fn)`, the page's raw touch
  (phase 1 down, 2 move, 3 up). `mgu.js` and `display.js` replace `kit/runtime/`, `hu-stub.js` replaces `kit/tools/`.

The released `hud_designer@1.0.1.tgz` is this app built with the kit and **without** BMW's oap-sdk: the head unit's
deploy tool generates that module from its own firmware when it installs the package.

To build it yourself: put the app in the kit's `apps/hud_designer/`, copy the three patched files over the kit's,
take `oap-sdk/index.js` and `package.json` from your own head unit (`mgu-deploy.sh sdk-donor`) into the kit's
`oap-sdk/`, then `python kit/tools/build.py hud_designer` and remove `node_modules/oap-sdk` from the tgz.
Needs the GPU renderer with touch (idrive7-renderd) and `mgux-hud-ctl` 2.4.0 or newer.