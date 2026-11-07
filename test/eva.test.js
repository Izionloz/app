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
        'de.bmw.infotainment.KombiIF', 'de.bmw.infotainment.drivingexcitement.FES', 'de.bmw.infotainment.misc.MDrive', 'de.bmw.infotainment.vehicle.CDS',
        'de.bmw.infotainment.vehicle.TPMS', 'de.bmw.infotainment.vehicle.Vehicle2', 'de.bmw.infrastructure.EnvironmentalInformation',
        'de.bmw.infrastructure.VehicleInformation']);
    assert.deepStrictEqual(Object.keys(app.signals['de.bmw.infotainment.vehicle.TPMS']).filter((k) => k[0] !== '_'), ['statusTyrePressure', 'statusTyreTemperature']);
    assert.deepStrictEqual(Object.keys(app.signals['de.bmw.infotainment.drivingexcitement.FES']), ['statusFESVehicleDynamicSwitchHMI', 'statusSwitchDriveDynamicSport2']);
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

test('eva comfort layout: widgets inside the cluster, clear of BMW\'s boxes, fonts baked, the map window is a hole inside its frame', () => {
    const l = json('hud', 'layouts', 'eva_comfort.json');
    const ids = new Set();
    // in Comfort Plus BMW draws its gear indicator at the bottom (photo, Nov 7 2026: x ~1380-1445, y ~670-710), not at the Sport spot
    const boxes = [[1360, 664, 1450, 712], [587, 663, 626, 700]];
    l.widgets.forEach((w) => {
        assert.ok(!ids.has(w.id), `two widgets are called ${w.id}`);
        ids.add(w.id);
        assert.ok(w.x >= 0 && w.y >= 0 && w.x + w.w <= 1920 && w.y + w.h <= 720, `${w.id} runs off the cluster`);
        if (w.type === 'text') {
            boxes.forEach((b) => assert.ok(!(w.x < b[2] && w.x + w.w > b[0] && w.y < b[3] && w.y + w.h > b[1]), `${w.id} overlaps BMW's box ${b}`));
            const f = json('hud', 'fonts', `${w.font}.json`);
            assert.ok(w.h >= f.cellHeight - 2 && w.h <= f.cellHeight + 2, `${w.id}: h ${w.h}, the font's cell is ${f.cellHeight}`);
            if (!/\{\{/.test(w.text)) for (const ch of w.text) assert.ok(f.glyphs[ch], `${w.id}: font ${w.font} has no "${ch}"`);
        }
    });
    l.widgets.filter((w) => w.type === 'picture').forEach((w) => {
        const pic = json('hud', 'pictures', `${w.name}.json`);
        assert.deepStrictEqual([pic.w, pic.h], [w.w, w.h], `${w.id}: the baked picture is not its widget's size`);
        assert.strictEqual(Buffer.from(pic.rgba, 'base64').length, pic.w * pic.h * 4);
    });
    const dash = l.widgets.filter((w) => w.type === 'evadash2');
    assert.strictEqual(dash.length, 2);
    assert.ok(!l.widgets.some((w) => w.type === 'evadash'), 'EVA Comfort uses the evadash2 shader only; evadash is the one that ran on the car');
    dash.forEach((d) => { assert.ok(d.frames.length <= 8); assert.ok(d.rails.length <= 2); });
    const a = dash[0], map = a.frames[3];
    assert.ok(a.hole[0] >= map.x && a.hole[1] >= map.y && a.hole[0] + a.hole[2] <= map.x + map.w && a.hole[1] + a.hole[3] <= map.y + map.h);
    // the hole is where main.js puts the cluster's map (COMFORT_MAP, in the map target's pixels: the target sits at x 416, y 120), in the map's shape
    const main = fs.readFileSync(path.join(APP, 'main.js'), 'utf8');
    const m = /COMFORT_MAP = \{ x: (\d+) - 416, y: (\d+) - 120, w: (\d+), h: (\d+) \}/.exec(main);
    assert.ok(m, 'COMFORT_MAP is not in main.js');
    assert.deepStrictEqual(a.hole, [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])]);
    assert.ok(Math.abs(a.hole[2] / a.hole[3] - 1088 / 480) < 0.03, 'the map window is not the map\'s shape');
    assert.ok(a.hole[0] >= 416 && a.hole[1] >= 120 && a.hole[0] + a.hole[2] <= 416 + 1088 && a.hole[1] + a.hole[3] <= 120 + 480, 'the map window is outside the map target');
    assert.strictEqual(dash[1].bg, false);
    ['hudLayout', 'inComfort', 'inSport', 'inEco'].forEach((k) => {
        assert.ok(app.settings.find((x) => x.key === k).options.some((o) => o[0] === 'eva_comfort'), `${k} lacks EVA Comfort`);
    });
});

test('eva hud comfort layout: inside the visible HUD window, clear of BMW\'s speed, the HUD map rectangle clear, transparent frame layer, fonts baked, offered in the HUD settings', () => {
    const l = json('hud', 'layouts', 'eva_hud_comfort.json');
    const win = [120, 100, 120 + 485, 100 + 278], bmw = [282, 330, 362, 376];
    l.widgets.forEach((w) => {
        assert.ok(w.x >= win[0] && w.y >= win[1] && w.x + w.w <= win[2] && w.y + w.h <= win[3], `${w.id} is outside the visible window`);
        if (w.type === 'text') {
            assert.ok(!(w.x < bmw[2] && w.x + w.w > bmw[0] && w.y < bmw[3] && w.y + w.h > bmw[1]), `${w.id} is over BMW's speed`);
            const f = json('hud', 'fonts', `${w.font}.json`);
            assert.ok(w.h >= f.cellHeight - 2 && w.h <= f.cellHeight + 2, `${w.id}: h ${w.h}, the font's cell is ${f.cellHeight}`);
            if (!/\{\{/.test(w.text)) for (const ch of w.text) assert.ok(f.glyphs[ch], `${w.id}: font ${w.font} has no "${ch}"`);
        }
    });
    // the HUD map goes into HUD_COMFORT_MAP: nothing over it
    const mm = /HUD_COMFORT_MAP = \{ x: (\d+), y: (\d+), w: (\d+), h: (\d+) \}/.exec(fs.readFileSync(path.join(APP, 'main.js'), 'utf8'));
    assert.ok(mm, 'HUD_COMFORT_MAP is not in main.js');
    const mr = [Number(mm[1]), Number(mm[2]), Number(mm[3]), Number(mm[4])];
    assert.ok(Math.abs(mr[2] / mr[3] - 1088 / 480) < 0.05, 'the HUD map rectangle is not the map\'s shape');
    assert.ok(mr[0] >= 120 && mr[1] >= 100 && mr[0] + mr[2] <= 605 && mr[1] + mr[3] <= 378, 'the HUD map is outside the visible window');
    l.widgets.filter((w) => w.type === 'text').forEach((w) => assert.ok(!(w.x < mr[0] + mr[2] && w.x + w.w > mr[0] && w.y < mr[1] + mr[3] && w.y + w.h > mr[1]), `${w.id} is over the HUD map`));
    const d = l.widgets.filter((w) => w.type === 'evadash2');
    assert.strictEqual(d.length, 1);
    assert.strictEqual(d[0].bg, false);
    assert.ok(d[0].frames.length <= 8);
    ['windHudLayout', 'windInSport', 'windInComfort', 'windInEco'].forEach((k) => {
        assert.ok(app.settings.find((x) => x.key === k).options.some((o) => o[0] === 'eva_hud_comfort'), `${k} lacks EVA HUD Comfort`);
    });
});

test('eva comfort wide layout: the hole is inside the map target and covered by main.js\'s rectangle (the map\'s shape), the rest is as in eva_comfort', () => {
    const l = json('hud', 'layouts', 'eva_comfort_wide.json');
    const boxes = [[1360, 664, 1450, 712], [587, 663, 626, 700]];
    const ids = new Set();
    l.widgets.forEach((w) => {
        assert.ok(!ids.has(w.id), `two widgets are called ${w.id}`);
        ids.add(w.id);
        assert.ok(w.x >= 0 && w.y >= 0 && w.x + w.w <= 1920 && w.y + w.h <= 720, `${w.id} runs off the cluster`);
        if (w.type === 'text') {
            boxes.forEach((b) => assert.ok(!(w.x < b[2] && w.x + w.w > b[0] && w.y < b[3] && w.y + w.h > b[1]), `${w.id} overlaps BMW's box ${b}`));
            const f = json('hud', 'fonts', `${w.font}.json`);
            assert.ok(w.h >= f.cellHeight - 2 && w.h <= f.cellHeight + 2, `${w.id}: h ${w.h}, the font's cell is ${f.cellHeight}`);
            if (!/\{\{/.test(w.text)) for (const ch of w.text) assert.ok(f.glyphs[ch], `${w.id}: font ${w.font} has no "${ch}"`);
        }
    });
    const dash = l.widgets.filter((w) => w.type === 'evadash2');
    assert.strictEqual(dash.length, 2);
    dash.forEach((d) => assert.ok(d.frames.length <= 8));
    const a = dash[0], map = a.frames[3], h = a.hole;
    assert.ok(h[0] >= map.x && h[1] >= map.y && h[0] + h[2] <= map.x + map.w && h[1] + h[3] <= map.y + map.h);
    const m = /COMFORT_WIDE_MAP = \{ x: (\d+) - 416, y: (\d+), w: (\d+), h: (\d+) \}/.exec(fs.readFileSync(path.join(APP, 'main.js'), 'utf8'));
    assert.ok(m, 'COMFORT_WIDE_MAP is not in main.js');
    const r = { x: Number(m[1]), y: 120 + Number(m[2]), w: Number(m[3]), h: Number(m[4]) };      // in cluster pixels
    assert.ok(Math.abs(r.w / r.h - 1088 / 480) < 0.03, 'the map rectangle is not the map\'s shape');
    assert.ok(r.x >= 416 && r.y >= 120 && r.x + r.w <= 416 + 1088 && r.y + r.h <= 120 + 480, 'the map rectangle is outside the map target');
    assert.ok(h[0] >= r.x && h[1] >= r.y && h[0] + h[2] <= r.x + r.w && h[1] + h[3] <= r.y + r.h, 'the map does not cover the window');
    ['hudLayout', 'inComfort', 'inSport', 'inEco'].forEach((k) => {
        assert.ok(app.settings.find((x) => x.key === k).options.some((o) => o[0] === 'eva_comfort_wide'), `${k} lacks the big map`);
    });
});

test('eva page: every setting of the app has a row on the center screen and a tap changes it', () => {
    const page = require(path.join(APP, 'settingsui.js'));
    const vals = {};
    app.settings.forEach((s) => { vals[s.key] = s.default; });
    const item = (k) => app.settings.find((x) => x.key === k);
    const s = {
        get: (k) => vals[k], set: (k, v) => { vals[k] = v; }, item,
        cycle: (k) => { const o = item(k).options.map((p) => p[0]); vals[k] = o[(o.indexOf(vals[k]) + 1) % o.length]; },
    };
    const targets = [];
    const cv = new Proxy({ own: true, target: (x, y, w, h, run, key) => targets.push({ x, y, w, h, run, key }), textWidth: () => 50 }, {
        get: (o, k) => (k in o ? o[k] : () => cv),
    });
    page.draw(cv, s, { cluster: 'a', hud: 'b' });
    app.settings.forEach((st) => {
        assert.ok(targets.some((t) => t.key.includes(st.key) || (st.key === 'hudLayout' && t.key.startsWith('layout:'))), `${st.key} has no row`);
    });
    targets.forEach((t) => assert.ok(t.x >= 0 && t.y >= 44 && t.x + t.w <= 1600 && t.y + t.h <= 512, `${t.key} is off the page`));
    targets.find((t) => t.key === 'layout:eva_comfort').run();
    assert.strictEqual(vals.hudLayout, 'eva_comfort');
    targets.find((t) => t.key === 'set:byMode').run();
    assert.strictEqual(vals.byMode, false);
    targets.find((t) => t.key === 'step:redline1').run();
    assert.strictEqual(vals.redline, 7000);
    targets.find((t) => t.key === 'cycle:units').run();
    assert.strictEqual(vals.units, 'us');
});
