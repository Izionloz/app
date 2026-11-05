// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * designer - the HUD map designer's page: layout, drawing and touch. Pure logic (no kit calls but the canvas
 * handed to draw), so it runs the same in a test.
 *
 * Page (1600 x 520): left, a preview of the chosen display (HUD 800 x 480 or the cluster 1088 x 480) with the map's
 * rectangle: drag inside it to move, drag a corner or an edge handle to resize. Right: Show map on (Cluster, HUD,
 * both), Adjusting (HUD map, Cluster map), sliders (size, brightness, zoom, rotate) that follow the finger, and
 * Centre / Reset. Changes go to the helper as the finger moves.
 */
'use strict';

const { CANVAS } = require('./hudclient');

const PREV = { x: 24, y: 56, w: 704, h: 452 };      /* the preview panel */
const RIGHT_X = 756, RIGHT_W = 820;
const HANDLE_HIT = 38;                              /* touch target radius, px of the page */
const FOCUS_HIT = 28;                               /* the focus mark's */
const FOCUS_COLOUR = '#ff9f1a';
const MAP_ASPECT = 1088 / 480;

const MODES = [['map', 'Cluster'], ['hud', 'HUD'], ['both', 'Cluster + HUD']];
const WHICH = [['hud', 'HUD map'], ['map', 'Cluster map']];

/* sliders: value <-> track fraction; `get` reads the rect, `put` returns the rect patch for a fraction */
function sliders(which) {
    const c = CANVAS[which];
    return [
        { key: 'size', label: 'Size', min: 0.1, max: 1, def: which === 'hud' ? 456 / 800 : 1, unit: '%',
            get: (r) => r.w / c.w, show: (v) => `${Math.round(v * 100)} %`,
            put: (f, r) => {
                const w = Math.max(40, Math.round(f * c.w)), h = Math.max(20, Math.round(w / MAP_ASPECT));
                return { w, h, x: Math.round(r.x + r.w / 2 - w / 2), y: Math.round(r.y + r.h / 2 - h / 2) };
            } },
        { key: 'bright', label: 'Brightness', min: 0.1, max: 1, def: 1, get: (r) => r.opacity, show: (v) => `${Math.round(v * 100)} %`,
            put: (f) => ({ opacity: Math.round(f * 100) / 100 }) },
        { key: 'zoom', label: 'Zoom', min: 0.3, max: 3, def: 1, get: (r) => r.zoom, show: (v) => `${Math.round(v * 100)} %`,
            put: (f) => ({ zoom: Math.round(f * 100) / 100 }) },
        { key: 'rot', label: 'Rotate', min: -180, max: 180, def: 0, get: (r) => r.rot, show: (v) => `${Math.round(v)} deg`,
            put: (f) => ({ rot: Math.round(f) }) }
    ];
}

function previewBox(which) {
    const c = CANVAS[which];
    const maxW = PREV.w - 48, maxH = PREV.h - 96;
    const s = Math.min(maxW / c.w, maxH / c.h);
    const w = c.w * s, h = c.h * s;
    return { s, x: PREV.x + (PREV.w - w) / 2, y: PREV.y + 58 + (maxH - h) / 2, w, h };
}

/* the rectangle's place on the page */
function rectOnPage(which, r) {
    const b = previewBox(which);
    return { x: b.x + r.x * b.s, y: b.y + r.y * b.s, w: r.w * b.s, h: r.h * b.s };
}

/* the focus (where the zoom centres: put it on the car) as a point of the page rectangle */
function focusOnPage(p, r) {
    const fx = typeof r.fx === 'number' ? r.fx : 0.5, fy = typeof r.fy === 'number' ? r.fy : 0.5;
    return { x: p.x + fx * p.w, y: p.y + fy * p.h };
}

/* eight handles of a page rectangle: corners and edge middles */
function handles(p) {
    const x2 = p.x + p.w, y2 = p.y + p.h, mx = p.x + p.w / 2, my = p.y + p.h / 2;
    return [
        { id: 'tl', x: p.x, y: p.y }, { id: 'tr', x: x2, y: p.y }, { id: 'bl', x: p.x, y: y2 }, { id: 'br', x: x2, y: y2 },
        { id: 't', x: mx, y: p.y }, { id: 'b', x: mx, y: y2 }, { id: 'l', x: p.x, y: my }, { id: 'r', x: x2, y: my }
    ];
}

/* right-hand layout */
function layout() {
    const modeW = 262, gap = 17;
    const L = { modes: [], which: [], sliders: [], buttons: [] };
    MODES.forEach((m, i) => L.modes.push({ id: m[0], label: m[1], x: RIGHT_X + i * (modeW + gap), y: 92, w: modeW, h: 46 }));
    WHICH.forEach((m, i) => L.which.push({ id: m[0], label: m[1], x: RIGHT_X + i * (400 + 20), y: 184, w: 400, h: 46 }));
    for (let i = 0; i < 4; i++) {
        L.sliders.push({ x: RIGHT_X + 8, y: 246 + i * 52, w: RIGHT_W - 16, h: 48, trackX: RIGHT_X + 230, trackW: RIGHT_W - 230 - 150 });
    }
    L.buttons.push({ id: 'centre', label: 'Centre', x: RIGHT_X, y: 462, w: 262, h: 46 });
    L.buttons.push({ id: 'reset', label: 'Reset this map', x: RIGHT_X + 279, y: 462, w: 262, h: 46 });
    return L;
}

/* black or white text, whichever reads on the colour */
function onColour(c) {
    const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(String(c));
    if (!m) {
        return '#ffffff';
    }
    const lum = (0.299 * parseInt(m[1], 16) + 0.587 * parseInt(m[2], 16) + 0.114 * parseInt(m[3], 16)) / 255;
    return lum > 0.6 ? '#101216' : '#ffffff';
}

const inRect = (r, x, y) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;

class Designer {
    constructor(client) {
        this.client = client;
        this.which = 'hud';
        this.drag = null;
        this.pressed = null;
        this.L = layout();
    }

    rectNow() {
        return this.client.state()[this.which];
    }

    /* what is under the finger */
    hit(x, y) {
        const st = this.client.state();
        for (const m of this.L.modes) {
            if (inRect(m, x, y)) { return { type: 'mode', id: m.id }; }
        }
        for (const w of this.L.which) {
            if (inRect(w, x, y)) { return { type: 'which', id: w.id }; }
        }
        for (const b of this.L.buttons) {
            if (inRect(b, x, y)) { return { type: 'button', id: b.id }; }
        }
        for (let i = 0; i < this.L.sliders.length; i++) {
            const s = this.L.sliders[i];
            if (x >= s.trackX - 30 && x <= s.trackX + s.trackW + 30 && y >= s.y && y < s.y + s.h) { return { type: 'slider', i }; }
        }
        const p = rectOnPage(this.which, st[this.which]);
        const f = focusOnPage(p, st[this.which]);
        if (Math.hypot(f.x - x, f.y - y) < FOCUS_HIT) { return { type: 'focus' }; }
        let best = null, bd = HANDLE_HIT;
        for (const h of handles(p)) {
            const d = Math.hypot(h.x - x, h.y - y);
            if (d < bd) { bd = d; best = h.id; }
        }
        if (best) { return { type: 'handle', id: best }; }
        if (inRect({ x: p.x - 6, y: p.y - 6, w: p.w + 12, h: p.h + 12 }, x, y)) { return { type: 'body' }; }
        return null;
    }

    touch(phase, x, y) {
        if (phase === 1) {
            const h = this.hit(x, y);
            this.drag = h ? { hit: h, x0: x, y0: y, r0: Object.assign({}, this.rectNow()) } : null;
            this.pressed = h && (h.type === 'mode' || h.type === 'which' || h.type === 'button') ? h : null;
            if (this.drag && this.drag.hit.type === 'slider') {
                this._slider(this.drag.hit.i, x);
            }
        } else if (phase === 2 && this.drag) {
            const t = this.drag.hit.type;
            if (t === 'slider') {
                this._slider(this.drag.hit.i, x);
            } else if (t === 'body' || t === 'handle') {
                this._moveRect(x, y);
            } else if (t === 'focus') {
                this._moveFocus(x, y);
            }
        } else if (phase === 3) {
            const d = this.drag;
            if (d && this.pressed) {
                const h = this.hit(x, y);
                if (h && h.type === this.pressed.type && h.id === this.pressed.id) {
                    this._tap(h);
                }
            }
            this.drag = null;
            this.pressed = null;
        }
    }

    _tap(h) {
        if (h.type === 'mode') {
            this.client.setMode(h.id);
        } else if (h.type === 'which') {
            this.which = h.id;
        } else if (h.id === 'centre') {
            this.client.centre(this.which);
        } else if (h.id === 'reset') {
            this.client.reset(this.which);
        }
    }

    _slider(i, x) {
        const s = this.L.sliders[i], def = sliders(this.which)[i];
        const f = Math.max(0, Math.min(1, (x - s.trackX) / s.trackW));
        const v = def.min + f * (def.max - def.min);
        // a small pull to the default, so it is easy to hit
        const value = Math.abs(v - def.def) < (def.max - def.min) * 0.015 ? def.def : v;
        this.client.rect(this.which, def.put(value, this.client.state()[this.which]));
    }
    /* the focus follows the finger, held inside the map's rectangle */
    _moveFocus(x, y) {
        const p = rectOnPage(this.which, this.rectNow());
        const fx = Math.max(0, Math.min(1, (x - p.x) / p.w)), fy = Math.max(0, Math.min(1, (y - p.y) / p.h));
        this.client.rect(this.which, { fx: Math.round(fx * 100) / 100, fy: Math.round(fy * 100) / 100 });
    }

    _moveRect(x, y) {
        const d = this.drag, b = previewBox(this.which), r0 = d.r0;
        const dx = (x - d.x0) / b.s, dy = (y - d.y0) / b.s;
        const c = CANVAS[this.which];
        const id = d.hit.type === 'body' ? 'move' : d.hit.id;
        if (id === 'move') {
            /* a move keeps the size: only the place is held inside the display */
            this.client.rect(this.which, { x: Math.round(Math.max(0, Math.min(r0.x + dx, c.w - r0.w))), y: Math.round(Math.max(0, Math.min(r0.y + dy, c.h - r0.h))) });
            return;
        }
        let left = r0.x, top = r0.y, right = r0.x + r0.w, bottom = r0.y + r0.h;
        {
            if (id.indexOf('l') >= 0) { left += dx; }
            if (id.indexOf('r') >= 0) { right += dx; }
            if (id === 't' || id === 'tl' || id === 'tr') { top += dy; }
            if (id === 'b' || id === 'bl' || id === 'br') { bottom += dy; }
        }
        left = Math.max(0, Math.min(left, c.w - 40)); top = Math.max(0, Math.min(top, c.h - 20));
        right = Math.max(left + 40, Math.min(right, c.w)); bottom = Math.max(top + 20, Math.min(bottom, c.h));
        this.client.rect(this.which, { x: Math.round(left), y: Math.round(top), w: Math.round(right - left), h: Math.round(bottom - top) });
    }

    /* ---------------- drawing ---------------- */
    draw(cv, t, G) {
        const st = this.client.state();
        const live = this.client.connected();
        G.panel(cv, t, PREV.x, PREV.y, PREV.w, PREV.h, this.which === 'hud' ? 'HUD  800 x 480' : 'Cluster  1088 x 480');
        this._drawPreview(cv, t, st);
        // right side
        cv.text('SHOW MAP ON', RIGHT_X, 80, 22, t.dim, { literal: true, font: 'bold', spacing: 2 });
        this.L.modes.forEach((m) => this._pill(cv, t, m, st.mode === m.id, this.pressed && this.pressed.type === 'mode' && this.pressed.id === m.id));
        cv.text('ADJUSTING', RIGHT_X, 174, 22, t.dim, { literal: true, font: 'bold', spacing: 2 });
        this.L.which.forEach((m) => this._pill(cv, t, m, this.which === m.id, this.pressed && this.pressed.type === 'which' && this.pressed.id === m.id));
        const r = st[this.which];
        sliders(this.which).forEach((def, i) => this._slider_draw(cv, t, this.L.sliders[i], def, def.get(r)));
        this.L.buttons.forEach((b) => this._button(cv, t, b, this.pressed && this.pressed.type === 'button' && this.pressed.id === b.id));
        const msg = live ? `${r.w} x ${r.h}  at ${Math.round(r.x)}, ${Math.round(r.y)}` : 'DEMO - helper offline';
        cv.text(msg, RIGHT_X + 566, 492, 24, live ? t.dim : t.warn, { literal: true });
    }

    _pill(cv, t, b, on, down) {
        cv.roundRect(b.x, b.y, b.w, b.h, 12, on ? t.accent : down ? '#2c2e36' : t.panelTop || '#17181c');
        cv.strokeRoundRect(b.x, b.y, b.w, b.h, 12, 2, on ? t.accent : t.panelEdge || '#2a2b31');
        const w = cv.textWidth(b.label, 28, { literal: true, font: 'bold' });
        cv.text(b.label, b.x + (b.w - w) / 2, b.y + 33, 28, on ? onColour(t.accent) : t.text, { literal: true, font: 'bold' });
    }

    _button(cv, t, b, down) {
        cv.roundRect(b.x, b.y, b.w, b.h, 12, down ? '#2c2e36' : t.panelTop || '#17181c');
        cv.strokeRoundRect(b.x, b.y, b.w, b.h, 12, 2, t.panelEdge || '#2a2b31');
        const w = cv.textWidth(b.label, 26, { literal: true, font: 'bold' });
        cv.text(b.label, b.x + (b.w - w) / 2, b.y + 32, 26, t.text, { literal: true, font: 'bold' });
    }

    _slider_draw(cv, t, s, def, v) {
        const f = Math.max(0, Math.min(1, (v - def.min) / (def.max - def.min)));
        const cy = s.y + s.h / 2;
        cv.text(def.label, s.x, cy + 9, 28, t.text, { literal: true, font: 'bold' });
        cv.roundRect(s.trackX, cy - 5, s.trackW, 10, 5, t.track || '#222329');
        cv.roundRect(s.trackX, cy - 5, Math.max(10, s.trackW * f), 10, 5, t.accent);
        const df = (def.def - def.min) / (def.max - def.min);
        cv.fillRect(s.trackX + s.trackW * df - 1.5, cy - 14, 3, 28, t.dim);
        cv.circle(s.trackX + s.trackW * f, cy, 20, '#ffffff');
        cv.circle(s.trackX + s.trackW * f, cy, 14, t.accent);
        const txt = def.show(v);
        const w = cv.textWidth(txt, 28, { literal: true, font: 'bold' });
        cv.text(txt, s.trackX + s.trackW + 150 - 20 - w, cy + 9, 28, t.text, { literal: true, font: 'bold' });
    }

    _drawPreview(cv, t, st) {
        const b = previewBox(this.which), r = st[this.which];
        // the display
        cv.roundRect(b.x, b.y, b.w, b.h, 10, '#000000');
        cv.strokeRoundRect(b.x, b.y, b.w, b.h, 10, 2, t.panelEdge || '#2a2b31');
        // faint grid
        for (let i = 1; i < 8; i++) {
            cv.line(b.x + (b.w * i) / 8, b.y, b.x + (b.w * i) / 8, b.y + b.h, 1, '#14161a');
        }
        for (let i = 1; i < 5; i++) {
            cv.line(b.x, b.y + (b.h * i) / 5, b.x + b.w, b.y + (b.h * i) / 5, 1, '#14161a');
        }
        const p = rectOnPage(this.which, r);
        const shown = st.mode === 'both' || st.mode === this.which;
        // the map: a drawn sample, zoomed and turned like the real one, clipped to its rectangle
        cv.roundRect(p.x, p.y, p.w, p.h, 6, shown ? '#0d2a33' : '#1a1a1a');
        cv.alpha(shown ? Math.max(0.25, r.opacity) : 0.35);
        this._roads(cv, p, r);
        cv.alpha(1);
        cv.strokeRoundRect(p.x, p.y, p.w, p.h, 6, 3, shown ? t.accent : t.dim);
        if (!shown) {
            cv.text('not shown on this display', p.x + 12, p.y + 30, 22, t.dim, { literal: true });
        }
        // handles
        handles(p).forEach((h) => {
            cv.circle(h.x, h.y, 13, '#ffffff');
            cv.circle(h.x, h.y, 9, t.accent);
        });
        // the focus: a ring with a cross, put on the car so the zoom keeps it in the middle
        const f = focusOnPage(p, r);
        cv.circle(f.x, f.y, 15, FOCUS_COLOUR);
        cv.circle(f.x, f.y, 11, shown ? '#0d2a33' : '#1a1a1a');
        cv.line(f.x - 20, f.y, f.x + 20, f.y, 3, FOCUS_COLOUR);
        cv.line(f.x, f.y - 20, f.x, f.y + 20, 3, FOCUS_COLOUR);
        cv.text('Drag the map to move it, a dot to resize, the orange + onto the car.', PREV.x + 24, PREV.y + PREV.h - 14, 22, t.dim, { literal: true });
    }

    _roads(cv, p, r) {
        const cx = p.x + p.w / 2, cy = p.y + p.h / 2;
        const z = r.zoom, ang = (r.rot * Math.PI) / 180, ca = Math.cos(ang), sa = Math.sin(ang);
        const k = Math.min(p.w, p.h) / 2;
        const pt = (ux, uy) => [cx + (ux * ca - uy * sa) * k * z * 1.4, cy + (ux * sa + uy * ca) * k * z * 1.4];
        const road = (pts, w, c) => {
            for (let i = 0; i + 1 < pts.length; i++) {
                const seg = clipSegment(pt(pts[i][0], pts[i][1]), pt(pts[i + 1][0], pts[i + 1][1]), p);
                if (seg) {
                    cv.line(seg[0], seg[1], seg[2], seg[3], w, c);
                }
            }
        };
        road([[-2, -0.55], [-0.6, -0.3], [0.3, -0.35], [2, 0.1]], 7, '#2f6f82');
        road([[-1.6, 0.7], [-0.4, 0.25], [0.5, 0.2], [1.8, 0.8]], 6, '#2f6f82');
        road([[-0.5, -2], [-0.3, -0.5], [-0.35, 0.4], [-0.1, 2]], 5, '#245a6a');
        road([[0.9, -2], [0.6, -0.4], [0.5, 0.5], [0.8, 2]], 5, '#245a6a');
        road([[-2, 0], [2, 0]], 2, '#3a8aa0');
        road([[0, -2], [0, 2]], 2, '#3a8aa0');
        // our position: a bright arrow that stays upright on the map
        cv.quad([[cx, cy - 16], [cx + 11, cy + 12], [cx, cy + 6], [cx - 11, cy + 12]], '#ffffff');
    }
}

/* Liang-Barsky: the part of segment a-b inside rectangle p, as [x1, y1, x2, y2], or null */
function clipSegment(a, b, p) {
    let t0 = 0, t1 = 1;
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const tests = [[-dx, a[0] - p.x], [dx, p.x + p.w - a[0]], [-dy, a[1] - p.y], [dy, p.y + p.h - a[1]]];
    for (let i = 0; i < 4; i++) {
        const q = tests[i][0], v = tests[i][1];
        if (q === 0) {
            if (v < 0) {
                return null;
            }
        } else {
            const t = v / q;
            if (q < 0) {
                if (t > t1) { return null; }
                if (t > t0) { t0 = t; }
            } else {
                if (t < t0) { return null; }
                if (t < t1) { t1 = t; }
            }
        }
    }
    return [a[0] + t0 * dx, a[1] + t0 * dy, a[0] + t1 * dx, a[1] + t1 * dy];
}

module.exports = { Designer, sliders, previewBox, rectOnPage, focusOnPage, handles, layout, MODES, WHICH, PREV };