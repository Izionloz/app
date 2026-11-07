// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const APP = path.join(__dirname, '..', 'eva', 'app');
const json = (...p) => JSON.parse(fs.readFileSync(path.join(APP, ...p), 'utf8'));
const layout = json('hud', 'layouts', 'eva.json');
const app = json('app.json');

test('eva layout: ids are unique, every widget is inside the 1920x720 cluster, types are known', () => {
    const ids = new Set();
    const types = ['text', 'evadash', 'picture'];
    layout.widgets.forEach((w) => {
        assert.ok(!ids.has(w.id), `two widgets are called ${w.id}`);
        ids.add(w.id);
        assert.ok(types.includes(w.type), `${w.id}: type ${w.type}`);
        assert.ok(w.x >= 0 && w.y >= 0 && w.x + w.w <= 1920 && w.y + w.h <= 720, `${w.id} runs off the cluster`);
    });
    assert.strictEqual(layout.schemaVersion, 2);
});

test('eva layout: nothing but the backdrop sits under BMW\'s gear box or belt light, and the picture clears the box', () => {
    const boxes = [[1406, 342, 1597, 419], [587, 663, 626, 700]];
    layout.widgets.filter((w) => w.type !== 'evadash').forEach((w) => {
        boxes.forEach((b) => {
            const hit = w.x < b[2] && w.x + w.w > b[0] && w.y < b[3] && w.y + w.h > b[1];
            assert.ok(!hit, `${w.id} overlaps BMW's box ${b}`);
        });
    });
});

test('eva layout: each text widget\'s font is baked, and has the letters of its fixed text', () => {
    layout.widgets.filter((w) => w.type === 'text').forEach((w) => {
        const f = json('hud', 'fonts', `${w.font}.json`);
        assert.ok(w.h >= f.cellHeight - 2 && w.h <= f.cellHeight + 2, `${w.id}: h ${w.h}, the font's cell is ${f.cellHeight}`);
        if (!/\{\{/.test(w.text)) {
            for (const ch of w.text) {
                assert.ok(f.glyphs[ch], `${w.id}: font ${w.font} has no "${ch}"`);
            }
        }
    });
});

test('eva layout: the evadash frames and rails fit the shader\'s arrays', () => {
    const d = layout.widgets.find((w) => w.type === 'evadash');
    assert.ok(d.frames.length <= 12);
    assert.ok(d.rails.length <= 2);
    d.frames.concat(d.rails).forEach((r) => {
        assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= 1920 && r.y + r.h <= 720);
    });
});

test('eva layout: the pilot picture is baked at its widget\'s size', () => {
    const w = layout.widgets.find((x) => x.type === 'picture');
    const pic = json('hud', 'pictures', `${w.name}.json`);
    assert.deepStrictEqual([pic.w, pic.h], [w.w, w.h]);
    assert.strictEqual(Buffer.from(pic.rgba, 'base64').length, w.w * w.h * 4);
});

test('eva app: Sport shows EVA and the others leave BMW\'s cluster (and the HUD) alone', () => {
    const s = (k) => app.settings.find((x) => x.key === k);
    assert.strictEqual(s('inSport').default, 'eva');
    assert.strictEqual(s('inComfort').default, 'off');
    assert.strictEqual(s('inEco').default, 'off');
    assert.strictEqual(s('byMode').default, true);
    assert.strictEqual(app.config.target, 'panel');
    assert.strictEqual(s('redline').default, 6500);
    assert.strictEqual(s('units').default, 'metric');
});

test('eva engine.patch only touches the engine files it names', () => {
    const files = fs.readFileSync(path.join(__dirname, '..', 'eva', 'engine.patch'), 'utf8')
        .split('\n').filter((l) => l.startsWith('diff --git')).map((l) => l.split(' ')[2]).sort();
    assert.deepStrictEqual(files, ['a/shared/hud.js', 'a/shared/hud_themes.js', 'a/shared/layouts.js', 'a/shared/shaders.js']);
});

test('eva app: only the signals it shows are declared (an interface this car lacks fails the install)', () => {
    assert.deepStrictEqual(Object.keys(app.signals).sort(), [
        'de.bmw.infotainment.KombiIF', 'de.bmw.infotainment.drivingexcitement.FES', 'de.bmw.infotainment.vehicle.CDS',
        'de.bmw.infotainment.vehicle.TPMS', 'de.bmw.infotainment.vehicle.Vehicle2', 'de.bmw.infrastructure.EnvironmentalInformation',
        'de.bmw.infrastructure.VehicleInformation']);
    assert.deepStrictEqual(Object.keys(app.signals['de.bmw.infotainment.vehicle.TPMS']).filter((k) => k[0] !== '_'), ['statusTyrePressure', 'statusTyreTemperature']);
    assert.deepStrictEqual(Object.keys(app.signals['de.bmw.infotainment.drivingexcitement.FES']), ['statusFESVehicleDynamicSwitchHMI']);
});

const hudLayout = json('hud', 'layouts', 'eva_hud.json');
const WINDOW = [120, 100, 485, 278];      /* what the driver sees of the 800x480 HUD (shared/visible.js) */

test('eva HUD layout: ids are unique, widgets are inside the part of the HUD the driver sees, and clear BMW\'s own content at the lower left', () => {
    const ids = new Set();
    hudLayout.widgets.forEach((w) => {
        assert.ok(!ids.has(w.id), `two widgets are called ${w.id}`);
        ids.add(w.id);
        assert.ok(['text', 'evadash'].includes(w.type), `${w.id}: type ${w.type}`);
        assert.ok(w.x >= WINDOW[0] && w.y >= WINDOW[1] && w.x + w.w <= WINDOW[0] + WINDOW[2] && w.y + w.h <= WINDOW[1] + WINDOW[3],
            `${w.id} is outside the visible HUD window`);
        if (w.type === 'text') {
            assert.ok(!(w.x < 360 && w.y + w.h > 312), `${w.id} is where BMW's own HUD content sits (lower left)`);
        }
    });
    assert.strictEqual(hudLayout.schemaVersion, 2);
});

test('eva HUD layout: each text widget\'s font is baked and has the letters of its fixed text', () => {
    hudLayout.widgets.filter((w) => w.type === 'text').forEach((w) => {
        const f = json('hud', 'fonts', `${w.font}.json`);
        assert.ok(w.h >= f.cellHeight - 2 && w.h <= f.cellHeight + 2, `${w.id}: h ${w.h}, the font's cell is ${f.cellHeight}`);
        if (!/\{\{/.test(w.text)) {
            for (const ch of w.text) {
                assert.ok(f.glyphs[ch], `${w.id}: font ${w.font} has no "${ch}"`);
            }
        }
    });
    const d = hudLayout.widgets.find((w) => w.type === 'evadash');
    assert.ok(d.frames.length <= 12 && d.rails.length <= 2);
});

test('eva HUD layout (BMW speed): nothing of ours is drawn over BMW\'s own white speed (about x 282-362, y 330-376)', () => {
    const l = json('hud', 'layouts', 'eva_hud_bmw.json');
    const box = [282, 330, 362, 376];
    const ids = new Set();
    l.widgets.forEach((w) => {
        assert.ok(!ids.has(w.id), `two widgets are called ${w.id}`);
        ids.add(w.id);
        assert.ok(w.x >= WINDOW[0] && w.y >= WINDOW[1] && w.x + w.w <= WINDOW[0] + WINDOW[2] && w.y + w.h <= WINDOW[1] + WINDOW[3], `${w.id} is outside the visible HUD window`);
        if (w.type === 'text') {
            const f = json('hud', 'fonts', `${w.font}.json`);
            assert.ok(w.h >= f.cellHeight - 2 && w.h <= f.cellHeight + 2, `${w.id}: h ${w.h}, the font's cell is ${f.cellHeight}`);
            if (!/\{\{/.test(w.text)) {
                for (const ch of w.text) {
                    assert.ok(f.glyphs[ch], `${w.id}: font ${w.font} has no "${ch}"`);
                }
            }
            assert.ok(!(w.x < box[2] && w.x + w.w > box[0] && w.y < box[3] && w.y + w.h > box[1]), `${w.id} is over BMW's speed`);
        }
    });
});

test('eva app: the HUD settings name layouts that exist, and Sport has the EVA HUD by default', () => {
    const s = (k) => app.settings.find((x) => x.key === k);
    ['windHudLayout', 'windInSport', 'windInComfort', 'windInEco'].forEach((k) => {
        s(k).options.forEach((o) => {
            assert.ok(o[0] === 'off' || fs.existsSync(path.join(APP, 'hud', 'layouts', `${o[0]}.json`)), `${k}: no layout ${o[0]}`);
        });
    });
    assert.strictEqual(s('windInSport').default, 'eva_hud_bmw');
    assert.strictEqual(s('windInComfort').default, 'off');
    assert.strictEqual(s('windInEco').default, 'off');
    assert.strictEqual(s('windHudLayout').default, 'off');
});

test('eva app: a speed correction setting (BMW\'s speedometer reads above the true speed), 1 km/h by default', () => {
    const o = app.settings.find((x) => x.key === 'speedOffset');
    assert.strictEqual(o.default, 1);
    assert.ok(o.steps.includes(0) && o.steps.includes(o.default));
});
