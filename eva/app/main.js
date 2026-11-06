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
// up yet. It gives the cluster's panel a scene of its own and hides the layers that share one while EVA shows (see below).
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
        // "separate": the panel gets its own scene id (cluster-render's local conf, set by mgux-hud-ctl) so EVA and the HUD map
        // show at once; the cluster's map, which has that id, gives way while EVA shows. Off: they share one scene and the HUD
        // map gives way. While EVA shows, the helper is told now and every 10 s (it lets go after 30 s of silence).
        const separate = () => ctx.settings.get('separate') !== false;
        let on = false, keep = null;
        const tell = () => {
            clearInterval(keep);
            keep = null;
            visit(ctx, { cmd: 'evaOn', on, hide: separate() ? 'map' : 'hud' }, 3);
            if (on) keep = setInterval(() => visit(ctx, { cmd: 'evaOn', on: true, hide: separate() ? 'map' : 'hud' }, 1), 10000);
        };
        visit(ctx, { cmd: 'panelScene', on: separate() }, 6);
        hud.onShown((shown) => { on = shown; tell(); });
        ctx.settings.onChange((key) => {
            if (key !== 'separate') return;
            visit(ctx, { cmd: 'panelScene', on: separate() }, 6);
            tell();
        });
        process.on('exit', () => { try { hud.stop(); } catch (e) { /* exiting anyway */ } });
    },
});
