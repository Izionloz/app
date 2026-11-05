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
