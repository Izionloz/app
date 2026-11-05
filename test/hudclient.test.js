// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { HudClient } = require('../designer/app/hudclient.js');

test('designer: changes in the demo are not queued for a later connection', () => {
    const c = new HudClient({ path: '/nonexistent/ctl.sock' });
    c.rect('hud', { x: 10, y: 20 });
    assert.strictEqual(c.state().hud.x, 10);
    assert.deepStrictEqual(c.pend, { hud: null, map: null });
    assert.strictEqual(c.sendTimer, null);
});

test('designer: dragging the orange focus mark sets fx/fy inside the map rectangle', () => {
    const { Designer, rectOnPage, focusOnPage } = require('../designer/app/designer.js');
    const c = new HudClient({ path: '/nonexistent/ctl.sock' });
    const d = new Designer(c);
    const p = rectOnPage('hud', c.state().hud);
    const f = focusOnPage(p, c.state().hud);
    d.touch(1, f.x, f.y);
    assert.strictEqual(d.drag.hit.type, 'focus');
    d.touch(2, p.x + p.w * 0.7, p.y + p.h * 0.75);
    d.touch(3, p.x + p.w * 0.7, p.y + p.h * 0.75);
    assert.deepStrictEqual([c.state().hud.fx, c.state().hud.fy], [0.7, 0.75]);
    d.touch(1, p.x + p.w * 0.7, p.y + p.h * 0.75);
    d.touch(2, p.x + p.w * 3, p.y - 500);
    assert.deepStrictEqual([c.state().hud.fx, c.state().hud.fy], [1, 0], 'held to the rectangle');
});

function listRig() {
    const D = require('../designer/app/designer.js');
    const c = new HudClient({ path: '/nonexistent/ctl.sock' });
    const modes = [];
    c.setMode = (m) => { modes.push(m); c.demo.mode = m; };
    const d = new D.Designer(c);
    const at = (key) => {
        const r = d.rows().find((x) => x.id === key);
        d.scroll = Math.max(0, Math.min(d.maxScroll(), r.top - 40));    /* scrolled to it, as on the car */
        return { r, y: d.rowY(r), b: D.bar(D.LIST.x, d.rowY(r), D.LIST.w) };
    };
    const tap = (x, y) => { d.touch(1, x, y); d.touch(3, x, y); };
    return { D, c, d, at, tap, modes };
}

test('designer list: + and − step a setting, the row lights up', () => {
    const { c, d, at, tap } = listRig();
    const before = c.state().hud.opacity;
    const s = at('bright');
    tap(s.b.minus.x + 20, s.b.cy);
    assert.strictEqual(c.state().hud.opacity, Math.round((before - 0.05) * 100) / 100);
    assert.strictEqual(d.rows()[d.selected].id, 'bright');
    tap(s.b.plus.x + 20, s.b.cy);
    tap(s.b.plus.x + 20, s.b.cy);
    assert.strictEqual(c.state().hud.opacity, 1, 'held to 100 %');
});

test('designer list: dragging along a bar sets the value; Độ cao up is a smaller y', () => {
    const { c, d, at } = listRig();
    d.scroll = d.rows().find((x) => x.id === 'zoom').top - 100;     /* scrolled to it, as on the car */
    const z = at('zoom');
    d.touch(1, z.b.trackX + z.b.trackW, z.b.cy);
    d.touch(3, z.b.trackX + z.b.trackW, z.b.cy);
    assert.strictEqual(c.state().hud.zoom, 3);
    d.scroll = 0;
    const h = at('height');
    const y0 = c.state().hud.y;
    d.touch(1, h.b.plus.x + 20, h.b.cy);
    d.touch(3, h.b.plus.x + 20, h.b.cy);
    assert.strictEqual(c.state().hud.y, y0 - 4);
});

test('designer list: a finger moving up scrolls the list and taps nothing', () => {
    const { d, modes, at } = listRig();
    const m = at('mode');
    d.touch(1, 300, m.y + 30);
    d.touch(2, 300, m.y + 30 - 200);
    d.touch(3, 300, m.y + 30 - 200);
    assert.ok(d.scroll > 0 && d.scroll <= d.maxScroll());
    assert.deepStrictEqual(modes, []);
});

test('designer list: a tap on Hiện bản đồ trên goes Đồng hồ -> HUD -> Cả hai; Đang chỉnh switches the display', () => {
    const { d, modes, at, tap } = listRig();
    const m = at('mode');
    tap(300, m.y + 30);
    tap(300, m.y + 30);
    assert.deepStrictEqual(modes, ['both', 'map']);
    const w = at('which');
    tap(300, w.y + 30);
    assert.strictEqual(d.which, 'map');
});

test('viet: letters are split into a base and its marks', () => {
    const V = require('../designer/app/viet.js');
    assert.deepStrictEqual(V.split('ộ'), { base: 'o', marks: ['circ', 'dot'], upper: false });
    assert.deepStrictEqual(V.split('Đ'), { base: 'D', marks: ['bar'], upper: true });
    assert.deepStrictEqual(V.split('ư'), { base: 'u', marks: ['horn'], upper: false });
    assert.deepStrictEqual(V.split('Ẳ'), { base: 'A', marks: ['breve', 'hook'], upper: true });
    assert.deepStrictEqual(V.runs('Độ sáng').map((r) => r.text), ['D', 'o', ' s', 'a', 'ng']);
});

test('designer: width and height rows keep the middle; the + places the focus, the map drags to move', () => {
    const { D, c, d, at } = listRig();
    const r0 = Object.assign({}, c.state().hud);
    d.scroll = d.rows().find((x) => x.id === 'width').top - 60;
    const w = at('width');
    d.touch(1, w.b.plus.x + 20, w.b.cy);
    d.touch(3, w.b.plus.x + 20, w.b.cy);
    let r = c.state().hud;
    assert.strictEqual(r.w, r0.w + 4);
    assert.strictEqual(r.x + r.w / 2, r0.x + r0.w / 2, 'the middle stays');
    assert.strictEqual(r.h, r0.h, 'height untouched');
    const t = at('tall');
    d.touch(1, t.b.minus.x + 20, t.b.cy);
    d.touch(3, t.b.minus.x + 20, t.b.cy);
    assert.strictEqual(c.state().hud.h, r0.h - 4);
    // the preview: the orange + moves the focus only; a drag elsewhere on the map moves the map, its size kept
    const b = D.previewBox('hud');
    r = Object.assign({}, c.state().hud);
    const p = D.rectOnPage('hud', r), f = D.focusOnPage(p, r);
    d.touch(1, f.x, f.y);
    d.touch(2, p.x + 2, p.y + 2);
    d.touch(3, p.x + 2, p.y + 2);
    let after = c.state().hud;
    assert.deepStrictEqual([after.x, after.y, after.w, after.h], [r.x, r.y, r.w, r.h], 'the + does not move the map');
    assert.ok(after.fx < 0.05 && after.fy < 0.05);
    const gx = p.x + p.w - 6, gy = p.y + p.h - 6;      /* a corner of the map, away from the + */
    d.touch(1, gx, gy);
    d.touch(2, gx - 10 * b.s, gy - 20 * b.s);
    d.touch(3, gx - 10 * b.s, gy - 20 * b.s);
    after = c.state().hud;
    assert.deepStrictEqual([after.x, after.y, after.w, after.h], [r.x - 10, r.y - 20, r.w, r.h]);
    // outside the map: nothing
    d.touch(1, b.x + 2, b.y + b.h - 2);
    assert.strictEqual(d.drag, null);
});

test('designer list: + on any setting changes that setting only; every other row keeps its value', () => {
    const D = require('../designer/app/designer.js');
    const defs = D.sliders('hud');
    defs.forEach((def) => {
        const { c, at, tap } = listRig();
        /* a map away from the display's edges, so no step is held back by an edge */
        Object.assign(c.demo.hud, { x: 300, y: 150, w: 200, h: 120, opacity: 0.5, zoom: 1.5, rot: 0, fx: 0.5, fy: 0.5 });
        const before = defs.map((d) => d.get(c.state().hud));
        const { b } = at(def.key);
        tap(b.plus.x + 20, b.cy);
        const after = defs.map((d) => d.get(c.state().hud));
        defs.forEach((d, i) => {
            if (d.key === def.key) {
                assert.notStrictEqual(after[i], before[i], `${def.key} changes`);
            } else {
                assert.ok(Math.abs(after[i] - before[i]) < 1e-9, `${def.key} + left ${d.key} as it was (${before[i]} -> ${after[i]})`);
            }
        });
    });
});

test('designer knob: turn moves the red row and scrolls to it; press, turn and press change a setting; push left ends', () => {
    const { c, d } = listRig();
    const rows = d.rows();
    d.selected = 0;
    assert.strictEqual(d.knob({ turn: rows.length + 5 }), true);
    assert.strictEqual(d.selected, rows.length - 1, 'held to the last row');
    assert.strictEqual(d.scroll, d.maxScroll(), 'scrolled to it');
    d.knob({ turn: -100 });
    assert.strictEqual(d.selected, 0);
    assert.strictEqual(d.scroll, 0);
    const bi = rows.findIndex((r) => r.id === 'bright');
    d.knob({ turn: bi });
    const before = c.state().hud.opacity;
    d.knob({ press: true });
    assert.strictEqual(d.editing, true);
    d.knob({ turn: -2 });
    assert.strictEqual(c.state().hud.opacity, Math.round((before - 0.1) * 100) / 100);
    assert.strictEqual(d.selected, bi, 'turning while changing keeps the row');
    assert.strictEqual(d.knob({ tilt: 'W' }), true, 'push left ends the change');
    assert.strictEqual(d.editing, false);
    assert.strictEqual(d.knob({ tilt: 'W' }), false, 'push left again is the kit\'s (leave the app)');
});

test('designer knob: a press on a choice or a command runs it', () => {
    const { d, modes } = listRig();
    const rows = d.rows();
    d.select(rows.findIndex((r) => r.id === 'mode'));
    d.knob({ press: true });
    assert.deepStrictEqual(modes, ['both']);
    d.select(rows.findIndex((r) => r.id === 'which'));
    d.knob({ press: true });
    assert.strictEqual(d.which, 'map');
    assert.strictEqual(d.editing, false);
});

test('designer: the map line says what waze-on-cluster and the service report', () => {
    const { statusLine } = require('../designer/app/designer.js');
    assert.deepStrictEqual(statusLine({ live: true, connections: 1, map: { state: 'showing' } }), { text: 'Bản đồ: đang hiện', warn: false });
    assert.strictEqual(statusLine({ live: true, connections: 0, map: { state: 'showing' } }).warn, true);
    assert.ok(statusLine({ live: true, connections: 0, map: { state: 'showing' } }).text.includes('khởi động lại head unit'));
    assert.deepStrictEqual(statusLine({ live: false, map: null }), { text: 'Bản đồ: chưa thấy waze-on-cluster', warn: true });
    assert.strictEqual(statusLine({ live: true, connections: 1, map: { state: 'frozen' } }).warn, true);
});

test('designer: waze-on-cluster\'s status is read from its socket', async () => {
    const net = require('net'), fs = require('fs'), os = require('os'), path = require('path');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'woc-'));
    const sock = path.join(dir, 'ctl.sock');
    const srv = net.createServer((c) => c.write('{"ev":"status","state":"showing","page":"map"}\n'));
    await new Promise((res) => srv.listen(sock, res));
    const c = new HudClient({ path: path.join(dir, 'none.sock'), wazePath: sock });
    c.open();
    await new Promise((res) => setTimeout(res, 150));
    assert.strictEqual(c.info().map.state, 'showing');
    c.close();
    srv.close();
    fs.rmSync(dir, { recursive: true, force: true });
});
