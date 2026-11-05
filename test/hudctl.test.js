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
