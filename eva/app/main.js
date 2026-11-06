'use strict';
/**
 * EVA cluster: redraws the iDrive 7 instrument cluster (the 1920x720 "panel" target) through cluster-render.
 *
 * The center screen is the app's settings page (app.json "screens" MAIN, a menu with
 * "settings": true): a status line, then the theme, room for the map, units, redline and which readouts
 * show. The kit builds that page and saves each choice in the app's data/settings.json;
 * the shared engine (hud.js) listens and redraws the cluster at once. It keeps running after the page is
 * closed (OAP apps stay up in the background), so the page is only needed for changes.
 */
const net = require('net');
const mgu = require('./kit/mgu');

// 0.2.0 / 0.2.1 could ask mgux-hud-ctl to set panel_take_over_stock = 1 in cluster-render's conf (it did not help on a car
// whose cluster was coded M-style). This version only puts a leftover 1 back to 0: the helper changes and restarts
// nothing when it was never set. Tried a few times in case the helper is not up yet.
const HELPER = '/dev/shm/mgux-hud/ctl.sock';
function undoTakeOver(ctx, tries) {
    const c = net.createConnection(HELPER);
    let done = false;
    c.on('error', () => { if (!done) { done = true; if (tries > 1) setTimeout(() => undoTakeOver(ctx, tries - 1), 20000); } });
    c.on('connect', () => { done = true; c.end(JSON.stringify({ cmd: 'panelTakeOver', on: false }) + '\n'); });
}

const HudApp = require('./hud');

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
        undoTakeOver(ctx, 6);
        process.on('exit', () => { try { hud.stop(); } catch (e) { /* exiting anyway */ } });
    },
});
