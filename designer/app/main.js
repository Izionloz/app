// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
/**
 * HUD map designer: the CarPlay map on the HUD and the cluster, moved, resized, dimmed, zoomed and turned with
 * the finger. The page is drawn by designer.js; touch comes raw from the kit (ctx.onTouch); changes go to the
 * mgux-hud-ctl helper through hudclient.js. Needs the GPU renderer with touch routing (idrive7-renderd).
 */
const mgu = require('./kit/mgu');
const G = require('./kit/gauges');
const { HudClient } = require('./hudclient');
const { Designer } = require('./designer');

mgu.run({
    async start(ctx) {
        const client = new HudClient({ log: ctx.log });
        const ui = new Designer(client);
        client.open();
        ctx.onTouch((phase, x, y) => ui.touch(phase, x, y));
        if (ctx.onKnob) {
            ctx.onKnob((e) => ui.knob(e));      // the iDrive controller: turn, press, push (kit-patch)
        }
        ctx.loop('MAIN', 30, () => {
            const t = ctx.theme();
            const cv = ctx.canvas(1600, 520).clear(t.bg);
            G.frame(cv, t, ['HUD map'], 0, []);
            ui.draw(cv);
            return ctx.ui.image('MAIN_GFX', cv);
        });
    },
});