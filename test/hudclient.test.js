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

test('designer: width and height rows keep the middle; a touch anywhere on the preview moves only the focus', () => {
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
    // the preview: a touch at its top-left corner puts the focus at the map's top-left, the map does not move
    const b = D.previewBox('hud');
    r = Object.assign({}, c.state().hud);
    d.touch(1, b.x, b.y);
    d.touch(2, b.x + 5, b.y + 5);
    d.touch(3, b.x + 5, b.y + 5);
    const after = c.state().hud;
    assert.deepStrictEqual([after.fx, after.fy], [0, 0]);
    assert.deepStrictEqual([after.x, after.y, after.w, after.h], [r.x, r.y, r.w, r.h]);
});
