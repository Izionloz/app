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
const page = require('./settingsui');
const G = require('./kit/gauges');

// Looks for the cruise control among the SOME/IP interface files the unit has (the same folders signals.js reads): any
// interface, field, method or broadcast whose name has cruise / tempomat / set speed / limiter in it. The names go to the app log
// and to the page's STATUS, so the real ones can be read off the screen. Read only; nothing is subscribed.
function findCruise(ctx) {
    const fs = require('fs'), path = require('path');
    let base;
    try { base = path.dirname(require.resolve('./kit/signals')); } catch (e) { return 'no signals module'; }
    const root = path.resolve(base, '..', '..', '..');
    const dirs = [path.join(root, 'someipInterfaces'), path.join(base, '..', '..', 'someipdefs')];
    const re = /cruise|tempomat|set_?speed|speed_?limit|limiter|distronic|\bacc/i;
    const hits = [];
    let files = 0;
    dirs.forEach((d) => {
        let list = [];
        try { list = fs.readdirSync(d); } catch (e) { return; }
        list.filter((f) => /\.json$/.test(f)).forEach((f) => {
            files++;
            let cfg; try { cfg = JSON.parse(fs.readFileSync(path.join(d, f), 'utf8')); } catch (e) { return; }
            const names = [];
            ['fields', 'methods', 'broadcasts', 'events', 'attributes'].forEach((k) => { if (cfg && cfg[k] && typeof cfg[k] === 'object') names.push.apply(names, Array.isArray(cfg[k]) ? cfg[k].map(String) : Object.keys(cfg[k])); });
            names.filter((n) => re.test(n) || re.test(f)).forEach((n) => hits.push(f.replace(/\.json$/, '').replace(/_/g, '.') + ' : ' + n));
        });
    });
    const out = hits.length ? hits.slice(0, 6).join(' | ') : 'no cruise names in ' + files + ' interface files (' + dirs.join(', ') + ')';
    ctx.log.info('cruise finder: ' + hits.length + ' hits, ' + files + ' files: ' + hits.join(' | '));
    return out;
}

// what the page shows under STATUS (the engine's own lines for the cluster and the HUD)
const status = { cluster: 'Starting the cluster', hud: 'Starting the HUD', cruise: '' };

// EVA Comfort (big map): the window is 936x264 at cluster x 440, y 336, wider than the map's shape allows, so the map is drawn at its own
// shape, 936x414, with its top 150 px above the window and cropped by it: the rest of the cluster's backdrop (the panel is above the map)
// hides that, and so the guidance bar at the top of CarPlay's picture
// EVA HUD Comfort: the HUD map goes into the free middle of the window (800x480 HUD pixels), in the map's shape, between the gear box and the
// right edge and under the rev rail; eva_hud_comfort.json keeps that rectangle clear. It is the same target as the EVA HUD's own layers
// (hud), so the map stays under their text.
const HUD_COMFORT_MAP = { x: 242, y: 200, w: 350, h: 154 };
const COMFORT_WIDE_MAP = { x: 440 - 416, y: 66, w: 936, h: 414 };

// the center screen's page (settingsui.js): drawn on the kit's canvas about ten times a second while it shows
function drawPage(ctx) {
    let view = 0;                                          // the header's tab: 0 the cluster's layouts, 1 the HUD's, 2 the options
    if (ctx.onTab) ctx.onTab((i) => { view = i; });
    ctx.loop('MAIN', 10, () => {
        const cv = ctx.canvas(1600, 520);
        page.draw(cv, ctx.settings, status, view);
        // the header with the page's tab (and Settings next to it): the kit's controller ring starts there, so the knob turns onto the
        // page's rows from it; without it the first turn stopped on a Settings tab that was not drawn and nothing seemed to move
        G.frame(cv, ctx.theme(), ['Cluster', 'HUD', 'Options'], view, []);
        return ctx.ui.image('MAIN_GFX', cv);
    });
}

mgu.run({
    start(ctx) {
        let hud;
        try {
            hud = new HudApp(ctx);
        } catch (e) {
            // nothing drawn, but stay up: an exit here would count as a crash on the car
            ctx.log.error('Cluster failed to start: ' + (e && e.stack || e));
            status.cluster = 'Cluster failed to start: ' + (e && e.message || e);
            drawPage(ctx);
            return;
        }
        hud.onStatus((s) => { status.cluster = s; });
        try { status.cruise = findCruise(ctx); } catch (e) { status.cruise = 'finder failed: ' + e; }
        hud.start();
        status.modeOf = () => hud.driveMode;
        drawPage(ctx);

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
            whud.onStatus((s) => { status.hud = s; });
            whud.start();
        } catch (e) {
            ctx.log.error('EVA HUD failed to start: ' + (e && e.stack || e));
            status.hud = 'EVA HUD failed to start: ' + (e && e.message || e);
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
            const msg = () => Object.assign({ cmd: 'evaOn', who, on: h.on, layout: h.layout, hide: who === 'hud' ? (h.layout === 'eva_hud_comfort' ? 'none' : 'hud') : (separate() ? (h.layout === 'eva_comfort_wide' ? 'none' : 'map') : 'hud') }, who === 'panel' && h.layout === 'eva_comfort_wide' && separate() ? { mapRect: COMFORT_WIDE_MAP, panelMap: ctx.settings.get('mapOnPanel') !== false } : who === 'hud' && h.layout === 'eva_hud_comfort' ? { mapRect: HUD_COMFORT_MAP } : {});
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
