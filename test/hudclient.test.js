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
