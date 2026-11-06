// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hudctl-'));
process.env.HUDCTL_STATE_DIR = dir;
process.env.HUDCTL_SOCK = path.join(dir, 'ctl.sock');
process.env.HUDCTL_PROXY_SOCK = path.join(dir, 'render.sock');
process.env.HUDCTL_WAZE_STATUS = path.join(dir, 'waze-status.json');
process.env.HUDCTL_CR_CONF = path.join(dir, 'cr', 'cluster-render.local.conf');
process.env.HUDCTL_RESTART_CMD = 'true';
const ctl = require('../native/mgux-hud-ctl/hudctl.js');

test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

test('wrapDeg: turning past one end comes round from the other', () => {
    assert.strictEqual(ctl.wrapDeg(0), 0);
    assert.strictEqual(ctl.wrapDeg(180), 180);
    assert.strictEqual(ctl.wrapDeg(190), -170);
    assert.strictEqual(ctl.wrapDeg(-190), 170);
    assert.strictEqual(ctl.wrapDeg(360), 0);
    assert.strictEqual(ctl.wrapDeg(-45), -45);
});

test('adjustRect: rotation keeps turning past 180', () => {
    let r = ctl.normaliseRect('hud', { rot: 175 });
    r = ctl.adjustRect('hud', r, { drot: 15 });
    assert.strictEqual(r.rot, -170);
});

test('normaliseRect: even sizes, inside the canvas, limits on brightness and zoom', () => {
    const r = ctl.normaliseRect('hud', { w: 2001, h: 7, x: -50, y: 999, opacity: 5, zoom: 0 });
    assert.strictEqual(r.w, 800);
    assert.strictEqual(r.h, 20);
    assert.strictEqual(r.x, 0);
    assert.strictEqual(r.y, 460);
    assert.strictEqual(r.opacity, 1);
    assert.strictEqual(r.zoom, 0.3);
});

test('adjustRect: edges move on their own', () => {
    const r0 = ctl.normaliseRect('hud', { x: 100, y: 100, w: 200, h: 100 });
    const r = ctl.adjustRect('hud', r0, { el: 20, eb: 10 });
    assert.deepStrictEqual([r.x, r.y, r.w, r.h], [80, 100, 220, 110]);
    assert.strictEqual(r.custom, true);
});

test('Daemon: a burst of changes is saved once, after it ends', async () => {
    const d = new ctl.Daemon();
    const file = path.join(dir, 'state.json');
    d.save();
    const before = fs.readFileSync(file, 'utf8');
    for (let i = 0; i < 20; i++) {
        d.handle({ cmd: 'adjust', which: 'hud', dx: 2 });
    }
    assert.strictEqual(fs.readFileSync(file, 'utf8'), before, 'not written during the burst');
    assert.ok(d.saveTimer, 'a save is pending');
    await new Promise((res) => setTimeout(res, 1200));
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.strictEqual(saved.hud.x, d.state.hud.x);
    assert.strictEqual(d.saveTimer, null);
});

test('focus: kept, nudged, held to 0-1 and carried by centre', () => {
    let r = ctl.normaliseRect('hud', { fx: 0.674, fy: 1.4 });
    assert.deepStrictEqual([r.fx, r.fy], [0.67, 1]);
    r = ctl.adjustRect('hud', r, { dfx: 0.05, dfy: -0.2 });
    assert.deepStrictEqual([r.fx, r.fy], [0.72, 0.8]);
    r = ctl.centredRect('hud', r);
    assert.deepStrictEqual([r.fx, r.fy], [0.72, 0.8]);
    assert.deepStrictEqual([ctl.defaultRect('map').fx, ctl.defaultRect('map').fy], [0.5, 0.5]);
});

test('settings: saved with a backup, read back after a restart, the backup used when the file is bad', () => {
    const file = path.join(dir, 'state.json');
    const d = new ctl.Daemon();
    d.handle({ cmd: 'rect', which: 'hud', x: 300, y: 100, w: 300, h: 132, zoom: 2, fx: 0.67, fy: 0.72 });
    d.save();
    assert.ok(fs.existsSync(`${file}.bak`));
    let l = ctl.loadState();
    assert.strictEqual(l.from, 'saved');
    assert.deepStrictEqual([l.state.hud.x, l.state.hud.zoom, l.state.hud.fx], [300, 2, 0.67]);
    fs.writeFileSync(file, '{"hud":');                 /* a file cut short */
    l = ctl.loadState();
    assert.strictEqual(l.from, 'backup');
    assert.strictEqual(l.state.hud.x, 300);
    assert.strictEqual(new ctl.Daemon().view().loaded.from, 'backup');
});

test('settings: a file that cannot be read is not overwritten with the defaults at start', () => {
    const file = path.join(dir, 'state.json');
    fs.writeFileSync(file, 'not json');
    fs.writeFileSync(`${file}.bak`, 'not json either');
    const d = new ctl.Daemon();
    assert.strictEqual(d.loaded.from, 'defaults');
    assert.strictEqual(d.noSavedFiles(), false);
    /* what start() decides: nothing is written */
    assert.strictEqual(fs.readFileSync(file, 'utf8'), 'not json');
    fs.unlinkSync(file);
    fs.unlinkSync(`${file}.bak`);
});

test('soft edges: 0.15 on the HUD by default, none on the cluster, held to 0-0.45', () => {
    assert.strictEqual(ctl.defaultRect('hud').fe, 0.15);
    assert.strictEqual(ctl.normaliseRect('hud', {}).fe, 0.15);
    assert.strictEqual(ctl.normaliseRect('map', { fe: 0.3 }).fe, 0);
    assert.strictEqual(ctl.normaliseRect('hud', { fe: 0.9 }).fe, 0.45);
    assert.strictEqual(ctl.adjustRect('hud', ctl.normaliseRect('hud', { fe: 0.2 }), { dfe: -0.05 }).fe, 0.15);
});

/* waze-on-cluster writes its status every second to a file; the helper only reads it */
const STATUS = process.env.HUDCTL_WAZE_STATUS;
const wait = (ms) => new Promise((res) => setTimeout(res, ms));
const writeStatus = (st) => fs.writeFileSync(STATUS, `${JSON.stringify(Object.assign({ ev: 'status' }, st))}\n`);

test('waze: the status file tells a 0.9.0 (hud_state) from an older one and from none', () => {
    const { WazeStatus } = require('../native/mgux-hud-ctl/wazestatus.js');
    let changes = 0;
    const w = new WazeStatus({ file: STATUS, onChange: () => { changes++; } });
    try { fs.unlinkSync(STATUS); } catch (e) { /* none */ }
    w.poll();
    assert.deepStrictEqual([w.native(), w.summary().connected], [false, false]);
    writeStatus({ state: 'showing', target: 'map' });
    w.poll();
    assert.deepStrictEqual([w.native(), w.summary().connected, w.summary().state], [false, true, 'showing']);
    writeStatus({ state: 'showing', cluster: 1, hud: 1, hud_state: 'idle', hud_width_pct: 0 });
    w.poll();
    assert.deepStrictEqual([w.native(), w.summary().hud, w.summary().hudState], [true, 1, 'idle']);
    const n = changes;
    w.poll();
    assert.strictEqual(changes, n, 'no change, no report');
    const old = new Date(Date.now() - 60000);
    fs.utimesSync(STATUS, old, old);                  /* waze-on-cluster stopped writing it */
    w.poll();
    assert.strictEqual(w.native(), false);
    assert.strictEqual(w.summary().connected, false);
    fs.unlinkSync(STATUS);
});

test('waze: with a 0.9.0 the HUD rect is waze-on-cluster\'s own place until a place is set here', () => {
    const d = new ctl.Daemon();
    d.waze.status = { ev: 'status', hud_state: 'showing', hud: 1, cluster: 0 };
    d.proxy.hudPlace = () => ({ x: 300, y: 120, w: 200, h: 88 });
    assert.deepStrictEqual([d.view().hud.x, d.view().hud.y, d.view().hud.w, d.view().hud.h, d.view().hud.placed], [300, 120, 200, 88, false]);
    /* a look change does not take the place */
    d.handle({ cmd: 'rect', which: 'hud', zoom: 2 });
    assert.strictEqual(d.state.hud.placed, false);
    assert.strictEqual(d.view().hud.x, 300);
    /* a size change starts from waze-on-cluster's place and takes it */
    d.handle({ cmd: 'rect', which: 'hud', w: 240 });
    assert.deepStrictEqual([d.state.hud.placed, d.state.hud.x, d.state.hud.y, d.state.hud.w, d.state.hud.h], [true, 300, 120, 240, 88]);
    assert.strictEqual(d.state.hud.zoom, 2, 'the look is kept');
    /* reset hands it back */
    d.handle({ cmd: 'reset', which: 'hud' });
    assert.strictEqual(d.state.hud.placed, false);
    assert.strictEqual(d.view().hud.x, 300);
    /* adjust: a move takes it, brightness does not */
    d.handle({ cmd: 'adjust', which: 'hud', dop: -0.1 });
    assert.strictEqual(d.state.hud.placed, false);
    d.handle({ cmd: 'adjust', which: 'hud', dx: 10 });
    assert.deepStrictEqual([d.state.hud.placed, d.state.hud.x], [true, 310]);
});

test('waze: an older waze-on-cluster (no hud_state) keeps the HUD rect of its own', () => {
    const d = new ctl.Daemon();
    d.waze.status = { ev: 'status', state: 'showing' };
    d.proxy.hudPlace = () => ({ x: 1, y: 1, w: 1, h: 1 });
    assert.strictEqual(d.layout().native, false);
    assert.strictEqual(d.view().hud.x, d.state.hud.x);
});

test('waze: the mode asks waze-on-cluster 0.9.0 for its feeds in a short visit, again after a restart; "follow" asks nothing', async () => {
    const net = require('net');
    const sock = path.join(dir, 'waze.sock');
    const got = [];
    const srv = net.createServer((c) => {
        c.setEncoding('utf8');
        c.write('{"ev":"status","state":"showing","cluster":1,"hud":0,"hud_state":"off"}\n');
        c.on('data', (d) => d.split('\n').filter(Boolean).forEach((l) => got.push(JSON.parse(l))));
        c.on('error', () => {});
    });
    await new Promise((res) => srv.listen(sock, res));
    const d = new ctl.Daemon();
    d.control.path = sock;
    d.waze.status = { ev: 'status', state: 'showing', cluster: 1, hud: 0, hud_state: 'off' };
    try {
        assert.strictEqual(d.state.mode, 'follow', 'the default leaves it to waze-on-cluster\'s own app');
        d.syncWaze();
        await wait(500);
        assert.deepStrictEqual(got, [], 'follow: nothing is asked');
        d.handle({ cmd: 'set', mode: 'hud' });
        await wait(600);
        assert.deepStrictEqual(got, [{ cmd: 'cluster', on: '0' }, { cmd: 'hud', on: '1' }]);
        /* asked again at the next look only after a while, and only while it is not as asked */
        got.length = 0;
        d.syncWaze();
        await wait(300);
        assert.deepStrictEqual(got, [], 'not twice in a row');
        d.waze.status = { ev: 'status', state: 'showing', cluster: 0, hud: 1, hud_state: 'showing' };
        d.visited = 0;
        d.syncWaze();
        await wait(300);
        assert.deepStrictEqual(got, [], 'it is as asked');
        /* waze-on-cluster restarted: HUD off again, so asked again */
        d.waze.status = { ev: 'status', state: 'idle', cluster: 1, hud: 0, hud_state: 'off' };
        d.visited = 0;
        d.syncWaze();
        await wait(500);
        assert.deepStrictEqual(got, [{ cmd: 'cluster', on: '0' }, { cmd: 'hud', on: '1' }]);
        /* an older waze-on-cluster has no feeds to ask for */
        got.length = 0;
        d.waze.status = { ev: 'status', state: 'showing' };
        d.visited = 0;
        d.syncWaze();
        await wait(300);
        assert.deepStrictEqual(got, []);
    } finally {
        srv.close();
    }
});

test('panelTakeOver: sets panel_take_over_stock in cluster-render\'s local conf, only when it is not already so', () => {
    const conf = process.env.HUDCTL_CR_CONF;
    assert.strictEqual(ctl.setConfKey('', 'panel_take_over_stock', '1'), 'panel_take_over_stock = 1\n');
    assert.strictEqual(ctl.setConfKey('a = 1', 'panel_take_over_stock', '1'), 'a = 1\npanel_take_over_stock = 1\n');
    assert.strictEqual(ctl.setConfKey('x = 2\npanel_take_over_stock=0\ny = 3\n', 'panel_take_over_stock', '1'), 'x = 2\npanel_take_over_stock = 1\ny = 3\n');
    const d = new ctl.Daemon();
    d.handle({ cmd: 'panelTakeOver', on: true });
    assert.strictEqual(fs.readFileSync(conf, 'utf8'), 'panel_take_over_stock = 1\n');
    assert.match(d.note, /restarted/);
    d.handle({ cmd: 'panelTakeOver', on: true });
    assert.match(d.note, /already 1/);
    d.handle({ cmd: 'panelTakeOver', on: 'yes' });         /* not a boolean: nothing */
    assert.strictEqual(fs.readFileSync(conf, 'utf8'), 'panel_take_over_stock = 1\n');
    d.handle({ cmd: 'panelTakeOver', on: false });
    assert.strictEqual(fs.readFileSync(conf, 'utf8'), 'panel_take_over_stock = 0\n');
    /* off when it was never set: no file change, no restart */
    fs.unlinkSync(conf);
    d.handle({ cmd: 'panelTakeOver', on: false });
    assert.ok(!fs.existsSync(conf));
    assert.match(d.note, /already 0/);
});

test('evaOn: the HUD map is hidden while the EVA cluster app says it shows, and comes back when it stops or goes silent', async () => {
    const d = new ctl.Daemon();
    let updates = 0;
    d.proxy.update = () => { updates++; };
    assert.strictEqual(d.layout().hide, null);
    d.handle({ cmd: 'evaOn', on: true });
    assert.strictEqual(d.layout().hide, 'hud');
    assert.strictEqual(updates, 1);
    d.handle({ cmd: 'evaOn', on: true });                 /* the keep-alive: nothing to redo */
    assert.strictEqual(updates, 1);
    d.handle({ cmd: 'evaOn', on: 'yes' });                /* not a boolean: nothing */
    assert.strictEqual(d.layout().hide, 'hud');
    d.handle({ cmd: 'evaOn', on: false });
    assert.strictEqual(d.layout().hide, null);
    assert.strictEqual(updates, 2);
    d.handle({ cmd: 'evaOn', on: true });
    d.evaUntil = Date.now() - 1;                           /* no keep-alive for 30 s */
    assert.strictEqual(d.layout().hide, null);
    clearTimeout(d.evaT);
});

test('panelScene and evaOn hide: the panel gets the map\'s scene so the HUD can stay; the cluster map gives way instead of the HUD', () => {
    const conf = process.env.HUDCTL_CR_CONF;
    try { fs.unlinkSync(conf); } catch (e) { /* none */ }
    const d = new ctl.Daemon();
    d.proxy.update = () => {};
    d.handle({ cmd: 'panelScene', on: false });                 /* never set: nothing to undo */
    assert.ok(!fs.existsSync(conf));
    assert.match(d.note, /already/);
    d.handle({ cmd: 'panelScene', on: true });
    assert.strictEqual(fs.readFileSync(conf, 'utf8'), 'panel_scene_id = 0x010004f1\n');
    assert.match(d.note, /restarted/);
    d.handle({ cmd: 'panelScene', on: true });
    assert.match(d.note, /already/);
    d.handle({ cmd: 'panelScene', on: false });
    assert.strictEqual(fs.readFileSync(conf, 'utf8'), 'panel_scene_id = 0x01000400\n');
    d.handle({ cmd: 'evaOn', on: true, hide: 'map' });
    assert.strictEqual(d.layout().hide, 'map');
    d.handle({ cmd: 'evaOn', on: true, hide: 'hud' });          /* the setting changed while it shows */
    assert.strictEqual(d.layout().hide, 'hud');
    d.handle({ cmd: 'evaOn', on: false });
    assert.strictEqual(d.layout().hide, null);
    clearTimeout(d.evaT);
});
