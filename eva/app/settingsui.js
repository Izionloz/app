// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
/**
 * EVA's page on the center screen, drawn like the HUD map app's: a dark page of three columns (the cluster, the HUD, the
 * rest), each setting a row with its name and a touch control, the chosen layout lit red. Pure drawing on the kit's
 * canvas (cv) and the kit's settings object, so a test can run it with a fake of both.
 *
 * Three views (the header's tabs): 0 the cluster's layouts and 1 the HUD's as galleries of pictures, 2 the options. Page 1600 x 520 (the kit's page: y 44 to 512 is free under the header). A tap, or the iDrive controller turned onto a
 * row and pressed, runs the row's cv.target: a toggle flips, a chip goes to the next value, a stepper's - and + step
 * through the numbers, a layout card chooses that layout. Elsewhere than where the kit runs the screen (no touch renderer)
 * the page only shows the values; the HMI's own Settings list changes them (the Settings button).
 */

const fs = require('fs');
const path = require('path');

// previews of the layouts (hud/previews/<layout>.json: 240x90 RGBA, made by tools/make_previews.py from bench pictures), registered once as the kit's pixel
// images; a layout with none (or no kit, as in a test) gets a plain card
let rec = null, pack = null;
try { rec = require('./kit/record'); } catch (e) { rec = null; }
// on the car the kit packs hud/ into hud.pack, so the pictures are read through the kit's pack reader (it reads the plain folder too)
try { pack = require('./kit/pack').open(path.join(__dirname, 'hud')); } catch (e) { pack = null; }
const previews = {};
let nextImage = 0x45560000;
function readPreview(id) {
    if (pack) {
        const j = pack.json('previews/' + id + '.json');
        if (j && j.rgba) return j;
    }
    return JSON.parse(fs.readFileSync(path.join(__dirname, 'hud', 'previews', id + '.json'), 'utf8'));
}
function preview(id) {
    if (Object.prototype.hasOwnProperty.call(previews, id)) return previews[id];
    previews[id] = null;
    try {
        const j = readPreview(id);
        if (rec && rec.setImage && j.w > 0 && j.h > 0) {
            const n = nextImage++;
            rec.setImage(n, j.w, j.h, Buffer.from(j.rgba, 'base64'));
            previews[id] = { id: n, w: j.w, h: j.h };
        }
    } catch (e) { /* no preview */ }
    return previews[id];
}

// which setting a tap on a layout card writes: the default layout or the one of a drive mode
const state = { target: 'hudLayout', htarget: 'windHudLayout' };
// the two galleries: the cluster's layouts and the HUD's (each picture is a window onto what its display shows)
const GALLERIES = [
    { item: 'hudLayout', stateKey: 'target', box: [240, 90], cols: 5, targets: [['hudLayout', 'DEFAULT', 'D'], ['inComfort', 'COMFORT', 'C'], ['inSport', 'SPORT', 'S'], ['inEco', 'ECO PRO', 'E']] },
    { item: 'windHudLayout', stateKey: 'htarget', box: [240, 138], cols: 5, targets: [['windHudLayout', 'DEFAULT', 'D'], ['windInComfort', 'COMFORT', 'C'], ['windInSport', 'SPORT', 'S'], ['windInEco', 'ECO PRO', 'E']] },
];

const C = {
    bg: '#0b0c0f', row: '#121318', line: '#2a2c33', text: '#f2f2f2', dim: '#9a9ca3', warn: '#ffb020',
    red: '#d7141e', redLit: '#ff2f3a', redFill: '#a10f18', ok: '#3ccf7a', track: '#3a3c44',
};

// the longer names of the layouts and options, short enough for a card or a chip
const SHORT = {
    off: 'OFF', eva: 'EVA', eva_comfort_wide: 'EVA COMFORT', eva_v12: 'V12 COMFORT', eva_v12_gpu: 'V12 GPU', eva_neo: 'NEO', eva_vector: 'VECTOR', eva_vector_red: 'VEC RED', eva_vector_violet: 'VEC VIOLET', eva_vector_lime: 'VEC LIME', eva_vector_mono: 'VEC MONO', eva_vector_gold: 'VEC GOLD', eva_v12_sport: 'V12 SPORT', eva_v12_eco: 'V12 ECO',
    eva_hud: 'EVA HUD', eva_hud_bmw: 'EVA HUD BMW', eva_hud_comfort: 'HUD COMFORT', eva_hud_v12: 'HUD V12', eva_hud_v12_sport: 'HUD V12 SPORT', eva_hud_v12_eco: 'HUD V12 ECO',
    metric: 'KM/H  °C  BAR', us: 'MPH  °F  PSI', '12h': '12-HOUR', '24h': '24-HOUR',
    auto: 'AUTO', on: 'ON',
};

const COLS = [{ x: 24, w: 500 }, { x: 550, w: 500 }, { x: 1076, w: 500 }];
const TOP = 56;
const ROW_H = 42;
const GAP = 6;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function shortOf(s, key, value) {
    const it = s.item(key);
    const o = it && it.options ? it.options.find((p) => p[0] === value) : null;
    if (SHORT[value] !== undefined && (!it || it.type === 'choice')) return SHORT[value];
    return String(o ? o[1] : value).toUpperCase();
}

function fit(cv, text, size, maxW, opt) {
    let z = size;
    while (z > 12 && cv.textWidth(text, z, opt) > maxW) z -= 1;
    return z;
}

/** A touch target, only where the kit runs the screen. */
function target(cv, x, y, w, h, run, key) {
    if (cv.own && cv.target) cv.target(x, y, w, h, run, key);
}

function heading(cv, col, y, text) {
    cv.fillRect(col.x, y + 22, col.w, 2, C.red);
    cv.text(text, col.x, y + 18, 20, C.text, { font: 'bold', spacing: 2 });
}

/** One row: the name on the left, then what the control shows. Returns the row's right part's x. */
function rowBox(cv, col, y, label, dimmed) {
    cv.roundRect(col.x, y, col.w, ROW_H, 8, C.row);
    cv.strokeRoundRect(col.x, y, col.w, ROW_H, 8, 1, C.line);
    const size = fit(cv, label, 19, col.w * 0.5, { font: 'bold', spacing: 0.5 });
    cv.text(label, col.x + 14, y + ROW_H / 2 + 7, size, dimmed ? C.dim : C.text, { font: 'bold', spacing: 0.5 });
}

function toggle(cv, s, col, y, key, label, dimmed) {
    const on = !!s.get(key);
    rowBox(cv, col, y, label, dimmed);
    const w = 70, x = col.x + col.w - w - 12, h = 26, yy = y + (ROW_H - h) / 2;
    cv.roundRect(x, yy, w, h, h / 2, on ? C.redFill : C.track);
    cv.roundRect(x + (on ? w - h + 3 : 3), yy + 3, h - 6, h - 6, (h - 6) / 2, on ? C.redLit : '#8a8c93');
    target(cv, col.x, y, col.w, ROW_H, () => { s.set(key, !s.get(key)); }, 'set:' + key);
}

function chip(cv, s, col, y, key, label, dimmed) {
    rowBox(cv, col, y, label, dimmed);
    const v = shortOf(s, key, s.get(key));
    const w = Math.round(col.w * 0.44), x = col.x + col.w - w - 8, h = ROW_H - 10, yy = y + 5;
    cv.roundRect(x, yy, w, h, h / 2, dimmed ? '#1a1b20' : C.redFill);
    cv.strokeRoundRect(x, yy, w, h, h / 2, 1.5, dimmed ? C.line : C.redLit);
    const size = fit(cv, v, 17, w - 24, { font: 'bold', spacing: 1 });
    cv.text(v, x + w / 2, yy + h / 2 + 6, size, dimmed ? C.dim : C.text, { align: 'center', font: 'bold', spacing: 1 });
    target(cv, col.x, y, col.w, ROW_H, () => { s.cycle(key); }, 'cycle:' + key);
}

function stepper(cv, s, col, y, key, label, unit) {
    rowBox(cv, col, y, label, false);
    const steps = (s.item(key) && s.item(key).steps) || [];
    const i = Math.max(0, steps.indexOf(s.get(key)));
    const bw = 44, h = ROW_H - 10, yy = y + 5;
    const right = col.x + col.w - 8;
    const move = (d) => () => { const j = clamp(steps.indexOf(s.get(key)) + d, 0, steps.length - 1); if (steps.length) s.set(key, steps[j]); };
    const plusX = right - bw, valW = 96, valX = plusX - valW - 6, minusX = valX - bw - 6;
    [['-', minusX, -1, i > 0], ['+', plusX, 1, i < steps.length - 1]].forEach(([g, x, d, live]) => {
        cv.roundRect(x, yy, bw, h, h / 2, live ? C.redFill : '#1a1b20');
        cv.strokeRoundRect(x, yy, bw, h, h / 2, 1.5, live ? C.redLit : C.line);
        cv.text(g, x + bw / 2, yy + h / 2 + 8, 26, live ? C.text : C.dim, { align: 'center', font: 'bold' });
        if (live) target(cv, x - 4, y, bw + 8, ROW_H, move(d), 'step:' + key + d);
    });
    cv.text(String(s.get(key)) + (unit ? ' ' + unit : ''), valX + valW / 2, yy + h / 2 + 7, 20, C.text, { align: 'center', font: 'bold' });
}

/** The layouts of the cluster (kind 0) or the HUD (kind 1) as a gallery: a card with a picture for each, the chosen one lit; the chips above say whose layout a tap sets. */
function gallery(cv, s, kind) {
    const G = GALLERIES[kind], TG = G.targets, cur = () => state[G.stateKey];
    let x = 24;
    TG.forEach(([key, label]) => {
        const on = cur() === key, w = 138, h = 32, y = 50;
        cv.roundRect(x, y, w, h, h / 2, on ? C.redFill : C.row);
        cv.strokeRoundRect(x, y, w, h, h / 2, on ? 2 : 1, on ? C.redLit : C.line);
        cv.text(label, x + w / 2, y + h / 2 + 6, 17, on ? C.text : C.dim, { align: 'center', font: 'bold', spacing: 1 });
        target(cv, x, y, w, h, () => { state[G.stateKey] = key; }, 'target:' + key);
        x += w + 8;
    });
    cv.text('Tap a layout: it is the ' + (TG.find((t) => t[0] === cur()) || TG[0])[1].toLowerCase() + ' one.', x + 12, 72, 16, C.dim, {});
    const bw = 340, bx = 1600 - 24 - bw;
    toggle(cv, s, { x: bx, w: bw }, 46, 'byMode', 'By drive mode', false);
    const it = s.item(G.item);
    const opts = it && it.options ? it.options : [];
    const [tw, th] = G.box;
    const cols = G.cols, gap = 8, cw = (1552 - (cols - 1) * gap) / cols, ch = th + 42, y0 = 94;
    opts.forEach((o, i) => {
        const cx = 24 + (i % cols) * (cw + gap), cy = y0 + Math.floor(i / cols) * (ch + 6), on = s.get(cur()) === o[0];
        cv.roundRect(cx, cy, cw, ch, 10, on ? C.redFill : C.row);
        cv.strokeRoundRect(cx, cy, cw, ch, 10, on ? 3 : 1, on ? C.redLit : C.line);
        const px = cx + (cw - tw) / 2, py = cy + 8, pv = preview(o[0]);
        if (pv && cv.image) cv.image(pv.id, px, py, tw, th);
        else {
            cv.fillRect(px, py, tw, th, '#050608');
            cv.strokeRoundRect(px, py, tw, th, 4, 1, C.line);
            cv.text(o[0] === 'off' ? 'BMW own display' : 'no picture', px + tw / 2, py + th / 2 + 6, 16, C.dim, { align: 'center' });
        }
        // the letters of the settings that use this layout
        let bxl = px + 6;
        TG.forEach(([key, , letter]) => {
            if (s.get(key) !== o[0]) return;
            cv.roundRect(bxl, py + 6, 20, 20, 5, key === cur() ? C.redLit : '#000000');
            cv.text(letter, bxl + 10, py + 21, 14, '#ffffff', { align: 'center', font: 'bold' });
            bxl += 24;
        });
        const name = (SHORT[o[0]] || String(o[1]).toUpperCase());
        cv.text(name, cx + cw / 2, cy + ch - 12, fit(cv, name, 18, cw - 16, { font: 'bold', spacing: 0.5 }), on ? C.text : C.dim, { align: 'center', font: 'bold', spacing: 1 });
        target(cv, cx, cy, cw, ch, () => { s.set(cur(), o[0]); }, 'layout:' + o[0]);
    });
}

/**
 * Draws the page. s: the kit's settings (get, set, cycle, item), status: { cluster, hud } texts, t: the theme (unused for now).
 */
function draw(cv, s, status, view) {
    cv.clear(C.bg);
    const own = !!cv.own;
    if (view === 0 || view === 1) {
        gallery(cv, s, view);
        if (!own) cv.text('Change these in Settings (the button below).', 24, 506, 16, C.dim, {});
        return;
    }

    // column 1: the cluster
    let y = TOP;
    heading(cv, COLS[0], y, 'CLUSTER');
    y += 34;
    const by = !!s.get('byMode');
    toggle(cv, s, COLS[0], y, 'byMode', 'By drive mode', false); y += ROW_H + GAP;
    chip(cv, s, COLS[0], y, 'inComfort', 'In Comfort', !by); y += ROW_H + GAP;
    chip(cv, s, COLS[0], y, 'inSport', 'In Sport', !by); y += ROW_H + GAP;
    chip(cv, s, COLS[0], y, 'inEco', 'In Eco Pro', !by); y += ROW_H + GAP;
    toggle(cv, s, COLS[0], y, 'mapOnPanel', 'CarPlay map in EVA layer', false);

    // column 2: the HUD
    y = TOP;
    heading(cv, COLS[1], y, 'HUD  (WINDSHIELD)');
    y += 34;
    chip(cv, s, COLS[1], y, 'windHudLayout', 'HUD layout', false); y += ROW_H + GAP;
    chip(cv, s, COLS[1], y, 'windInComfort', 'HUD in Comfort', !by); y += ROW_H + GAP;
    chip(cv, s, COLS[1], y, 'windInSport', 'HUD in Sport', !by); y += ROW_H + GAP;
    chip(cv, s, COLS[1], y, 'windInEco', 'HUD in Eco Pro', !by); y += ROW_H + GAP;
    toggle(cv, s, COLS[1], y, 'separate', 'EVA + HUD map together', false); y += ROW_H + 18;
    heading(cv, COLS[1], y, 'STATUS');
    y += 34;
    [['Cluster', status && status.cluster], ['HUD', status && status.hud]].forEach(([n, v]) => {
        cv.text(n.toUpperCase(), COLS[1].x, y + 16, 16, C.dim, { font: 'bold', spacing: 1.5 });
        const txt = String(v || '-');
        cv.text(txt, COLS[1].x + 90, y + 16, fit(cv, txt, 18, COLS[1].w - 90, {}), C.text);
        y += 28;
    });

    // column 3: the rest
    y = TOP;
    heading(cv, COLS[2], y, 'GENERAL');
    y += 34;
    chip(cv, s, COLS[2], y, 'units', 'Units', false); y += ROW_H + GAP;
    chip(cv, s, COLS[2], y, 'clock', 'Clock', false); y += ROW_H + GAP;
    stepper(cv, s, COLS[2], y, 'redline', 'Redline', 'rpm'); y += ROW_H + GAP;
    stepper(cv, s, COLS[2], y, 'shiftBefore', 'Shift before redline', 'rpm'); y += ROW_H + GAP;
    stepper(cv, s, COLS[2], y, 'speedOffset', 'Speed correction', ''); y += ROW_H + GAP;
    toggle(cv, s, COLS[2], y, 'coldGuard', 'Cold-engine guard', false); y += ROW_H + GAP;
    chip(cv, s, COLS[2], y, 'demo', 'Demo data', false); y += ROW_H + GAP;
    toggle(cv, s, COLS[2], y, 'warp', 'Light effects (V12)', false);

    if (!own) {
        cv.text('Change these in Settings (the button below).', 24, 506, 16, C.dim, {});
    }
}

module.exports = { draw, C, SHORT, state };
