'use strict';
/**
 * EVA cluster: redraws the iDrive 7 instrument cluster (the 1920x720 "panel" target) and the windshield HUD (the 800x480 "hud"
 * target) through cluster-render.
 *
 * The center screen is the app's settings page (app.json "screens" MAIN, a menu with
 * "settings": true): a status line, then the theme, room for the map, units, redline and which readouts
 * show. The kit builds that page and saves each choice in the app's data/settings.json;
 * the shared engine (hud.js) listens and redraws the cluster at once. It keeps running after the page is
 * closed (OAP apps stay up in the background), so the page is only needed for changes.
 */
const net = require('net');
const mgu = require('./kit/mgu');

// mgux-hud-ctl (the HUD map's root service): one short visit to its socket per message, tried a few times when it is not
// up yet. It gives the cluster's panel a scene of its own and hides the layers that share one while EVA shows (see below).
const HELPER = '/dev/shm/mgux-hud/ctl.sock';
function visit(ctx, msg, tries) {
    const c = net.createConnection(HELPER);
    let done = false;
    c.on('error', () => { if (!done) { done = true; if (tries > 1) setTimeout(() => visit(ctx, msg, tries - 1), 20000); } });
    c.on('connect', () => { done = true; c.end(JSON.stringify(msg) + '\n'); });
}

const HudApp = require('./hud');

// EVA Comfort's map window (the hole in eva_comfort.json, cluster px): the cluster map is put there while that layout shows. The map target
// (1088x480) sits at x 416, y 120 on the cluster, so the rectangle is in its own pixels; its shape is the map's (1088:480).
const COMFORT_MAP = { x: 506 - 416, y: 336 - 120, w: 594, h: 262 };

mgu.run({
    start(ctx) {
        let hud;
        try {
            hud = new HudApp(ctx);
        } catch (e) {
            // nothing drawn, but stay up: an exit here would count as a crash on the car
            ctx.log.error('Cluster failed to start: ' + (e && e.stack || e));
            ctx.ui.text('STATUS', 'Cluster failed to start: ' + (e && e.message || e));
            return;
        }
        hud.onStatus((s) => { ctx.ui.text('STATUS', s); });
        hud.start();

        // The EVA HUD on the windshield: a second display of this app on cluster-render's "hud" target, with a connection of
        // its own and layouts of its own (hud/layouts/eva_hud.json, settings windHudLayout / windInSport / ...). It follows
        // this display's car data and drive mode, so both change with the drive mode together.
        let whud = null;
        try {
            const wspec = Object.assign({}, ctx.spec, {
                id: ctx.spec.id + '_hud',
                config: Object.assign({}, ctx.spec.config, { target: 'hud', statusName: 'HUD', settingsPrefix: 'wind', needs: 'separate' }),
            });
            const wctx = Object.create(ctx, { spec: { value: wspec } });
            whud = new HudApp(wctx, { follow: hud });
            whud.onStatus((s) => { ctx.ui.text('HUDSTATUS', s); });
            whud.start();
        } catch (e) {
            ctx.log.error('EVA HUD failed to start: ' + (e && e.stack || e));
            ctx.ui.text('HUDSTATUS', 'EVA HUD failed to start: ' + (e && e.message || e));
            whud = null;
        }

        // "separate": the panel gets its own scene id (cluster-render's local conf, set by mgux-hud-ctl) so EVA and the HUD map
        // show at once; the cluster's map, which has that id, gives way while EVA shows. Off: they share one scene and the HUD
        // map gives way (and the EVA HUD, which needs the separate scenes, stays off). The EVA HUD hides the HUD map while it
        // shows. Each display tells the helper now and every 10 s while it shows (it lets go after 30 s of silence).
        const separate = () => ctx.settings.get('separate') !== false;
        const holds = {};
        const tell = (who) => {
            const h = holds[who] || (holds[who] = { on: false, keep: null });
            clearInterval(h.keep);
            h.keep = null;
            // EVA Comfort leaves a window for the cluster's map, so with the panel on a scene of its own nothing is hidden
            const msg = () => Object.assign({ cmd: 'evaOn', who, on: h.on, hide: who === 'hud' ? (h.layout === 'eva_hud_comfort' ? 'none' : 'hud') : (separate() ? (h.layout === 'eva_comfort' ? 'none' : 'map') : 'hud') }, who === 'panel' && h.layout === 'eva_comfort' && separate() ? { mapRect: COMFORT_MAP } : {});
            visit(ctx, msg(), 3);
            if (h.on) h.keep = setInterval(() => visit(ctx, msg(), 1), 10000);
        };
        visit(ctx, { cmd: 'panelScene', on: separate() }, 6);
        hud.onShown((shown, name) => { const h = holds.panel || (holds.panel = { on: false, keep: null }); h.on = shown; h.layout = name; tell('panel'); });
        if (whud) whud.onShown((shown, name) => { const h = holds.hud || (holds.hud = { on: false, keep: null }); h.on = shown; h.layout = name; tell('hud'); });
        ctx.settings.onChange((key) => {
            if (key !== 'separate') return;
            visit(ctx, { cmd: 'panelScene', on: separate() }, 6);
            tell('panel');
        });
        process.on('exit', () => { try { hud.stop(); if (whud) whud.stop(); } catch (e) { /* exiting anyway */ } });
    },
});
