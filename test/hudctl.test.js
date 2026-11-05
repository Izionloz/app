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
    d.handle({ cmd: 'rect', which: 'map', x: 300, y: 100, w: 300, h: 132, zoom: 2, fx: 0.67, fy: 0.72 });
    d.save();
    assert.ok(fs.existsSync(`${file}.bak`));
    let l = ctl.loadState();
    assert.strictEqual(l.from, 'saved');
    assert.deepStrictEqual([l.state.map.x, l.state.map.zoom, l.state.map.fx], [300, 2, 0.67]);
    fs.writeFileSync(file, '{"hud":');                 /* a file cut short */
    l = ctl.loadState();
    assert.strictEqual(l.from, 'backup');
    assert.strictEqual(l.state.map.x, 300);
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

/* waze-on-cluster writes its status every second to a file; the helper only reads it */
const STATUS = process.env.HUDCTL_WAZE_STATUS;
const wait = (ms) => new Promise((res) => setTimeout(res, ms));
const writeStatus = (st) => fs.writeFileSync(STATUS, `${JSON.stringify(Object.assign({ ev: 'status' }, st))}\n`);

test('waze: the status file tells a 0.9.0 (hud_state) from an older one and from none; nothing is ever sent', () => {
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

test('waze: the HUD map is shown where waze-on-cluster has it; its place and size are not ours to change, its look is', () => {
    const d = new ctl.Daemon();
    d.proxy.hudPlace = () => ({ x: 300, y: 120, w: 200, h: 88 });
    assert.deepStrictEqual([d.view().hud.x, d.view().hud.y, d.view().hud.w, d.view().hud.h], [300, 120, 200, 88]);
    /* a place or size sent for the HUD is ignored, a look is kept */
    d.handle({ cmd: 'rect', which: 'hud', x: 10, y: 10, w: 500, h: 300, zoom: 2 });
    assert.strictEqual(d.state.hud.zoom, 2);
    assert.deepStrictEqual([d.view().hud.x, d.view().hud.w], [300, 200]);
    assert.notStrictEqual(d.state.hud.w, 500);
    d.handle({ cmd: 'adjust', which: 'hud', dx: 40, dw: 40, dop: -0.1, drot: 5 });
    assert.deepStrictEqual([d.state.hud.opacity, d.state.hud.rot], [0.9, 5]);
    assert.deepStrictEqual([d.state.hud.x, d.state.hud.w], [ctl.defaultRect('hud').x, ctl.defaultRect('hud').w]);
    d.handle({ cmd: 'centre', which: 'hud' });          /* nothing for the HUD: its own app has Centre */
    assert.strictEqual(d.state.hud.x, ctl.defaultRect('hud').x);
    /* the cluster map's place is ours */
    d.handle({ cmd: 'rect', which: 'map', x: 100, y: 20, w: 600, h: 300 });
    assert.deepStrictEqual([d.state.map.x, d.state.map.w, d.state.map.custom], [100, 600, true]);
    assert.strictEqual(d.layout().map.x, 100);
    assert.strictEqual(d.layout().hud.zoom, 2);
    d.handle({ cmd: 'reset', which: 'hud' });
    assert.strictEqual(d.state.hud.zoom, 1);
    /* there is no mode any more, and no command to set one */
    assert.strictEqual(d.view().mode, undefined);
    d.handle({ cmd: 'set', mode: 'hud' });
    assert.ok(d.note);
});

