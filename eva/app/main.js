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

// mgux-hud-ctl (the HUD map's root service) can let cluster-render take the cluster's screen slot back from BMW's own
// cluster, which an M-style coded cluster claims again and again in Sport. One short visit to its socket, repeated
// a few times in case the service is not up yet; it only changes anything when the setting is not already as asked.
const HELPER = '/dev/shm/mgux-hud/ctl.sock';
function askTakeOver(ctx, on, tries) {
    const c = net.createConnection(HELPER);
    let done = false;
    const again = () => { if (!done) { done = true; if (tries > 1) setTimeout(() => askTakeOver(ctx, on, tries - 1), 20000); else ctx.log.warn('mgux-hud-ctl is not there: the cluster cannot be taken back from BMW'); } };
    c.on('error', again);
    c.on('connect', () => {
        done = true;
        c.end(JSON.stringify({ cmd: 'panelTakeOver', on }) + '\n');
        ctx.log.info('asked mgux-hud-ctl: panelTakeOver ' + on);
    });
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
        // the last events (drive mode, cluster-render's target and layer states, rebuilds), newest first, for a photo of the screen
        hud.onEvents((lines) => { for (let i = 0; i < 8; i++) ctx.ui.text('L' + (i + 1), lines[i] || '-'); });
        hud.start();
        let lastAsk = null;
        const ask = () => { const on = ctx.settings.get('takeOver') !== false; if (on !== lastAsk) { lastAsk = on; askTakeOver(ctx, on, 6); } };
        ask();
        ctx.settings.onChange((key) => { if (key === 'takeOver') ask(); });
        process.on('exit', () => { try { hud.stop(); } catch (e) { /* exiting anyway */ } });
    },
});
