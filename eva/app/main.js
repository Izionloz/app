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

// mgux-hud-ctl (the HUD map's root service): one short visit to its socket per message, tried a few times when it is not
// up yet. It hides the HUD map's layers while EVA shows (the cluster's panel and the HUD share one slot, and whoever holds it
// keeps it, so a HUD map shown while navigating kept EVA off the cluster), and puts a leftover panel_take_over_stock = 1
// (0.2.0 / 0.2.1) back to 0: nothing changes or restarts when it was never set.
const HELPER = '/dev/shm/mgux-hud/ctl.sock';
function visit(ctx, msg, tries) {
    const c = net.createConnection(HELPER);
    let done = false;
    c.on('error', () => { if (!done) { done = true; if (tries > 1) setTimeout(() => visit(ctx, msg, tries - 1), 20000); } });
    c.on('connect', () => { done = true; c.end(JSON.stringify(msg) + '\n'); });
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
        visit(ctx, { cmd: 'panelTakeOver', on: false }, 6);
        // while EVA shows, tell the helper now and every 10 s (it lets the HUD map back after 30 s of silence, e.g. if this app dies)
        let keep = null;
        hud.onShown((on) => {
            clearInterval(keep);
            keep = null;
            visit(ctx, { cmd: 'evaOn', on }, 3);
            if (on) keep = setInterval(() => visit(ctx, { cmd: 'evaOn', on: true }, 1), 10000);
        });
        process.on('exit', () => { try { hud.stop(); } catch (e) { /* exiting anyway */ } });
    },
});
