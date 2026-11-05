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
process.env.HUDCTL_WAZE_SOCK = path.join(dir, 'waze.sock');
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

/* a fake waze-on-cluster 0.9.0 on the helper's control socket path */
async function fakeWaze(status) {
    const net = require('net');
    const got = [];
    const conns = [];
    const srv = net.createServer((c) => {
        conns.push(c);
        c.setEncoding('utf8');
        c.on('data', (d) => d.split('\n').filter(Boolean).forEach((l) => got.push(JSON.parse(l))));
        c.on('error', () => {});
        c.write(`${JSON.stringify(Object.assign({ ev: 'status' }, status))}\n`);
    });
    try { fs.unlinkSync(process.env.HUDCTL_WAZE_SOCK); } catch (e) { /* none */ }
    await new Promise((res) => srv.listen(process.env.HUDCTL_WAZE_SOCK, res));
    return { got, conns, status(st) { conns.forEach((c) => c.write(`${JSON.stringify(Object.assign({ ev: 'status' }, st))}\n`)); },
        done() { conns.forEach((c) => c.destroy()); srv.close(); } };
}
const wait = (ms) => new Promise((res) => setTimeout(res, ms));

test('waze: the mode decides which feeds waze-on-cluster 0.9.0 draws; commands are not repeated', async () => {
    const w = await fakeWaze({ state: 'showing', cluster: 1, hud: 0, hud_state: 'off', hud_width_pct: 0 });
    const d = new ctl.Daemon();
    try {
        d.waze.open();
        await wait(200);
        assert.strictEqual(d.layout().native, true);
        assert.strictEqual(d.view().waze.native, true);
        assert.deepStrictEqual(w.got, [], 'cluster only is what it already shows: nothing to send');
        d.handle({ cmd: 'set', mode: 'both' });
        await wait(100);
        assert.deepStrictEqual(w.got.filter((m) => m.cmd !== 'hud' || m.on), [{ cmd: 'hud', on: '1' }]);
        d.handle({ cmd: 'set', mode: 'hud' });          /* waze has not answered yet: asked once, not twice */
        d.handle({ cmd: 'set', mode: 'hud' });
        await wait(100);
        assert.strictEqual(w.got.filter((m) => m.cmd === 'cluster').length, 1);
        assert.deepStrictEqual(w.got.filter((m) => m.cmd === 'cluster')[0], { cmd: 'cluster', on: '0' });
        w.status({ state: 'idle', cluster: 0, hud: 1, hud_state: 'showing', hud_width_pct: 0 });
        await wait(100);
        assert.strictEqual(d.view().waze.hudState, 'showing');
        const n = w.got.length;
        w.status({ state: 'idle', cluster: 0, hud: 1, hud_state: 'showing', hud_width_pct: 0 });
        await wait(100);
        assert.strictEqual(w.got.length, n, 'what waze shows is what is wanted: nothing more is sent');
    } finally {
        d.waze.close();
        w.done();
    }
});

test('waze: the HUD size follows the map\'s size once it settles; an older waze-on-cluster is left alone', async () => {
    const w = await fakeWaze({ state: 'showing', cluster: 0, hud: 1, hud_state: 'showing', hud_width_pct: 0 });
    const d = new ctl.Daemon();
    try {
        d.handle({ cmd: 'set', mode: 'hud' });
        d.handle({ cmd: 'rect', which: 'hud', w: 400, h: 100 });      /* 400 px wide = 50 % of 800 */
        d.waze.open();
        await wait(900);
        assert.deepStrictEqual(w.got.filter((m) => m.hud_width_pct), [{ cmd: 'hud', hud_width_pct: '50' }]);
        d.handle({ cmd: 'rect', which: 'hud', w: 300, h: 300 });      /* as tall as 300 x 2.27 wide = 680 px = 85 % */
        d.handle({ cmd: 'rect', which: 'hud', w: 300, h: 320 });
        await wait(900);
        assert.deepStrictEqual(w.got.filter((m) => m.hud_width_pct).map((m) => m.hud_width_pct), ['50', '91']);
    } finally {
        d.waze.close();
        w.done();
    }
    const old = await fakeWaze({ state: 'showing', target: 'map', page: 'map' });
    const d2 = new ctl.Daemon();
    try {
        d2.handle({ cmd: 'set', mode: 'both' });
        d2.waze.open();
        await wait(300);
        assert.strictEqual(d2.layout().native, false);
        assert.deepStrictEqual(old.got, []);
    } finally {
        d2.waze.close();
        old.done();
    }
});
