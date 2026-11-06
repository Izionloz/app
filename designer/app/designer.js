// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * designer - the HUD map's page: layout, drawing and touch. Pure logic (no kit calls but the canvas handed to draw), so
 * it runs the same in a test.
 *
 * Page (1600 x 520), laid out like the car's own Head-Up Display settings:
 *  - left, a list that scrolls: Show map on (with waze-on-cluster 0.9.0 also "Theo app waze-on-cluster", which leaves
 *    the choice to its own app), Adjusting, then a row per setting with its name and value above a − ▬▬▬ + bar (tap
 *    − or +, or drag along the bar): width and height each on their own, brightness, soft edges (HUD), place, zoom,
 *    rotation, the zoom focus; then Centre and Reset. The row last touched is lit red.
 *  - right, a preview of the chosen display with the map's rectangle: drag the map to move it, drag the orange +
 *    (the zoom focus: the zoom keeps that point in the middle) onto the car. The HUD map's place is waze-on-cluster's
 *    until it is changed here; Reset gives it back.
 * The iDrive controller works the list too (knob()): turn to move, press to change a setting or run a row.
 * Every change goes to the mgux-hud-ctl helper at once; the helper saves it (it says so under the preview).
 */
'use strict';

const { CANVAS } = require('./hudclient');
const V = require('./viet');

const LIST = { x: 24, y: 60, w: 760, h: 452 };     /* the list's window */
const PREV = { x: 808, y: 60, w: 768, h: 452 };     /* the preview panel */
const SCROLL_START = 14;
const FOCUS_HIT = 40;                               /* touch radius of the orange + */                            /* a finger moving this far up or down scrolls the list */

const C = {
    bg: '#0b0c0f', row: '#121318', line: '#2a2c33', text: '#f2f2f2', dim: '#9a9ca3', warn: '#ffb020',
    red: '#d7141e', redLit: '#ff2f3a', redFill: '#a10f18', track: '#3a3c44', thumb: '#ffffff', focus: '#ff9f1a',
    map: '#0d2a33', off: '#1a1a1a', accent: '#4fb3d9'
};

/* where the map shows: with waze-on-cluster 0.9.0 its own app can choose ("follow"); an older one has only these */
const MODES = [['map', 'Đồng hồ'], ['hud', 'HUD'], ['both', 'Cả hai']];
const MODES_NATIVE = [['follow', 'Theo app waze-on-cluster']].concat(MODES);
const modesFor = (native) => (native ? MODES_NATIVE : MODES);
const WHICH = [['hud', 'Bản đồ HUD'], ['map', 'Bản đồ đồng hồ']];

const pct = (v) => `${Math.round(v * 100)} %`;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const round2 = (v) => Math.round(v * 100) / 100;

/* the settings rows of one display: value <-> rect; lim(r) gives [min, max]; `sym` fills the bar from the middle */
function sliders(which) {
    const c = CANVAS[which];
    /* soft edges: the HUD only (on the cluster the fade would be a black frame) */
    const soft = which === 'hud' ? [{ key: 'fe', label: 'Làm mờ viền', lim: () => [0, 0.45], def: 0.15, step: 0.03, show: pct,
        get: (r) => (typeof r.fe === 'number' ? r.fe : 0.15), put: (v) => ({ fe: round2(v) }) }] : [];
    return [
        { key: 'width', label: 'Chiều rộng', lim: () => [40, c.w], def: which === 'hud' ? 456 : c.w, step: 4,
            show: (v) => `${Math.round(v)} px`, get: (r) => r.w,
            put: (v, r) => {
                const w = Math.round(v);
                return { w, x: Math.round(clamp(r.x + r.w / 2 - w / 2, 0, c.w - w)) };
            } },
        { key: 'tall', label: 'Chiều cao', lim: () => [20, c.h], def: which === 'hud' ? 202 : c.h, step: 4,
            show: (v) => `${Math.round(v)} px`, get: (r) => r.h,
            put: (v, r) => {
                const h = Math.round(v);
                return { h, y: Math.round(clamp(r.y + r.h / 2 - h / 2, 0, c.h - h)) };
            } },
        { key: 'bright', label: 'Độ sáng', lim: () => [0.1, 1], def: 1, step: 0.05, show: pct,
            get: (r) => r.opacity, put: (v) => ({ opacity: round2(v) }) },
        ...soft,
        { key: 'height', label: 'Độ cao', sym: true, step: 4, show: (v) => `${Math.round(v)} px`,
            lim: (r) => [-(c.h - r.h) / 2, (c.h - r.h) / 2], def: 0,
            get: (r) => c.h / 2 - (r.y + r.h / 2), put: (v, r) => ({ y: Math.round(c.h / 2 - v - r.h / 2) }) },
        { key: 'side', label: 'Vị trí ngang', sym: true, step: 4, show: (v) => `${Math.round(v)} px`,
            lim: (r) => [-(c.w - r.w) / 2, (c.w - r.w) / 2], def: 0,
            get: (r) => r.x + r.w / 2 - c.w / 2, put: (v, r) => ({ x: Math.round(c.w / 2 + v - r.w / 2) }) },
        { key: 'zoom', label: 'Thu phóng', lim: () => [0.3, 3], def: 1, step: 0.05, show: pct,
            get: (r) => r.zoom, put: (v) => ({ zoom: round2(v) }) },
        { key: 'rot', label: 'Xoay', sym: true, lim: () => [-180, 180], def: 0, step: 1, show: (v) => `${Math.round(v)} độ`,
            get: (r) => r.rot, put: (v) => ({ rot: Math.round(v) }) },
        { key: 'fx', label: 'Tâm thu phóng (ngang)', lim: () => [0, 1], def: 0.5, step: 0.02, show: pct,
            get: (r) => (typeof r.fx === 'number' ? r.fx : 0.5), put: (v) => ({ fx: round2(v) }) },
        { key: 'fy', label: 'Tâm thu phóng (dọc)', lim: () => [0, 1], def: 0.5, step: 0.02, show: pct,
            get: (r) => (typeof r.fy === 'number' ? r.fy : 0.5), put: (v) => ({ fy: round2(v) }) }
    ];
}

/* the list's rows, top to bottom, with their heights */
function rows(which) {
    const out = [{ kind: 'choice', id: 'mode', label: 'Hiện bản đồ trên', h: 76 }, { kind: 'choice', id: 'which', label: 'Đang chỉnh', h: 76 }];
    sliders(which).forEach((s) => out.push({ kind: 'slider', id: s.key, def: s, label: s.label, h: 104 }));
    out.push({ kind: 'action', id: 'centre', label: 'Căn giữa', h: 70 });
    out.push({ kind: 'action', id: 'reset', label: 'Đặt lại bản đồ này', h: 70 });
    let y = 0;
    out.forEach((r) => { r.top = y; y += r.h; });
    return out;
}

/* a slider row's bar: − and + targets and the track, page px */
function bar(x, y, w) {
    const cy = y + 76;
    return { cy, minus: { x, y: y + 48, w: 86, h: 56 }, plus: { x: x + w - 86, y: y + 48, w: 86, h: 56 },
        trackX: x + 92, trackW: w - 184 };
}

function previewBox(which) {
    const c = CANVAS[which];
    const maxW = PREV.w - 40, maxH = PREV.h - 156;
    const s = Math.min(maxW / c.w, maxH / c.h);
    const w = c.w * s, h = c.h * s;
    return { s, x: PREV.x + (PREV.w - w) / 2, y: PREV.y + 52, w, h };
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

/* waze-on-cluster's state of one feed (state for the cluster's, hud_state for the HUD's) in words */
function feedText(st) {
    switch (st) {
    case 'showing': return 'đang hiện';
    case 'starting': return 'đang khởi động';
    case 'frozen': return 'bị đứng, hãy kết nối lại CarPlay';
    case 'error': return 'lỗi';
    case 'disabled': return 'bị cluster-render chặn (root: cluster-render guard-reset)';
    case 'off': return 'tắt';
    default: return 'chờ CarPlay dẫn đường';
    }
}

/* the map's state in one line (what the button app showed) from the helper's report of waze-on-cluster */
function statusLine(info) {
    const w = info.waze;
    let text, warn = false;
    if (!info.live) {
        text = 'Bản đồ: chưa có dịch vụ nền';
        warn = true;
    } else if (!w || !w.connected) {
        text = 'Bản đồ: chưa thấy waze-on-cluster';
        warn = true;
    } else if (!w.native) {
        text = `Bản đồ: ${feedText(w.state)}. waze-on-cluster cũ, cập nhật lên 0.9.0 để HUD có nền đen`;
        warn = w.state === 'frozen' || w.state === 'error';
    } else {
        /* both feeds are always named: a HUD that is off says so (it is turned on with "Hiện bản đồ trên") */
        const parts = [w.cluster ? `đồng hồ ${feedText(w.state)}` : 'đồng hồ tắt',
            w.hud ? `HUD ${feedText(w.hudState)}` : 'HUD tắt (chọn ở Hiện bản đồ trên)'];
        text = `Bản đồ: ${parts.join(', ')}`;
        warn = w.state === 'frozen' || w.state === 'error' || w.hudState === 'frozen' || w.hudState === 'error' || w.hudState === 'disabled';
    }
    if (info.live && info.connections === 0) {
        text += ', chưa liên kết: khởi động lại head unit một lần';
        warn = true;
    }
    return { text, warn };
}

const inRect = (r, x, y) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;

class Designer {
    constructor(client) {
        this.client = client;
        this.which = 'hud';
        this.drag = null;
        this.selected = 2;          /* the row lit red */
        this.editing = false;       /* the iDrive knob changes the lit row's value (else it moves the light) */
        this.scroll = 0;
    }

    rectNow() {
        return this.client.state()[this.which];
    }

    /* waze-on-cluster draws the HUD itself (0.9.0 and later) */
    native() {
        const i = this.client.info ? this.client.info() : null;
        return !!(i && i.live && i.waze && i.waze.native);
    }

    rows() {
        return rows(this.which);
    }

    maxScroll() {
        const rs = this.rows(), last = rs[rs.length - 1];
        return Math.max(0, last.top + last.h - LIST.h);
    }

    /* a row's top on the page */
    rowY(r) {
        return LIST.y + r.top - this.scroll;
    }

    /* what is under the finger */
    hit(x, y) {
        if (inRect(LIST, x, y)) {
            const rs = this.rows();
            for (let i = 0; i < rs.length; i++) {
                const r = rs[i], ry = this.rowY(r);
                if (y >= ry && y < ry + r.h) {
                    if (r.kind === 'slider') {
                        const b = bar(LIST.x, ry, LIST.w);
                        if (inRect(b.minus, x, y)) { return { type: 'row', i, part: 'minus' }; }
                        if (inRect(b.plus, x, y)) { return { type: 'row', i, part: 'plus' }; }
                        if (y >= ry + 48 && x >= b.trackX - 16 && x <= b.trackX + b.trackW + 16) { return { type: 'row', i, part: 'track' }; }
                    }
                    return { type: 'row', i, part: 'row' };
                }
            }
            return { type: 'list' };
        }
        /* the preview: the orange + places the zoom focus, the rest of the map moves it (its size is set in the list) */
        const st = this.client.state();
        const p = rectOnPage(this.which, st[this.which]);
        const f = focusOnPage(p, st[this.which]);
        if (Math.hypot(f.x - x, f.y - y) < FOCUS_HIT) { return { type: 'focus' }; }
        if (inRect({ x: p.x - 10, y: p.y - 10, w: p.w + 20, h: p.h + 20 }, x, y)) { return { type: 'body' }; }
        return null;
    }

    touch(phase, x, y) {
        if (phase === 1) {
            const h = this.hit(x, y);
            this.drag = h ? { hit: h, x0: x, y0: y, s0: this.scroll, r0: Object.assign({}, this.rectNow()), scrolling: false } : null;
            this.editing = false;
            if (h && h.type === 'row') {
                this.selected = h.i;
                if (h.part === 'track') {
                    this._slider(h.i, x);
                }
            }
        } else if (phase === 2 && this.drag) {
            const d = this.drag, t = d.hit.type;
            if (t === 'row' && d.hit.part === 'track') {
                this._slider(d.hit.i, x);
            } else if (t === 'row' || t === 'list') {
                if (d.scrolling || Math.abs(y - d.y0) > SCROLL_START) {
                    d.scrolling = true;
                    this.scroll = clamp(d.s0 - (y - d.y0), 0, this.maxScroll());
                }
            } else if (t === 'body') {
                this._moveRect(x, y);
            } else if (t === 'focus') {
                this._moveFocus(x, y);
            }
        } else if (phase === 3) {
            const d = this.drag;
            if (d && d.hit.type === 'row' && !d.scrolling) {
                const h = this.hit(x, y);
                if (h && h.type === 'row' && h.i === d.hit.i && h.part === d.hit.part) {
                    this._tap(h);
                }
            }
            this.drag = null;
        }
    }

    /* ---------------- the iDrive controller ----------------
     * Like the car's own settings pages: turning moves the red row; a press on a setting starts changing it (the
     * row gets a white frame) and turning then steps its value, a press or a push left ends that; a press on a
     * choice or a command runs it. Pushed left with nothing being changed is left to the kit (it leaves the app). */
    knob(e) {
        const rs = this.rows();
        const row = rs[this.selected];
        if (e.tilt) {
            if (this.editing && (e.tilt === 'W' || e.tilt === 'N' || e.tilt === 'S')) {
                this.editing = false;
                if (e.tilt === 'W') { return true; }
            }
            if (e.tilt === 'N' || e.tilt === 'S') {
                this.select(this.selected + (e.tilt === 'N' ? -1 : 1));
                return true;
            }
            if (e.tilt === 'E' && row.kind === 'slider') {
                this.editing = true;
                return true;
            }
            return false;
        }
        if (e.turn) {
            if (this.editing && row.kind === 'slider') {
                const n = Math.min(10, Math.abs(e.turn));
                for (let i = 0; i < n; i++) { this.step(row.def, e.turn > 0 ? 1 : -1); }
            } else {
                this.editing = false;
                this.select(this.selected + e.turn);
            }
            return true;
        }
        if (e.press) {
            if (row.kind === 'slider') {
                this.editing = !this.editing;
            } else {
                this._tap({ i: this.selected, part: 'row' });
            }
            return true;
        }
        return false;
    }

    /* light row i, scrolling the list so it shows */
    select(i) {
        const rs = this.rows();
        this.selected = clamp(i, 0, rs.length - 1);
        const r = rs[this.selected];
        if (r.top < this.scroll) {
            this.scroll = r.top;
        } else if (r.top + r.h > this.scroll + LIST.h) {
            this.scroll = r.top + r.h - LIST.h;
        }
        this.scroll = clamp(this.scroll, 0, this.maxScroll());
    }

    _tap(h) {
        const r = this.rows()[h.i];
        if (r.kind === 'choice' && r.id === 'mode') {
            const modes = modesFor(this.native());
            const cur = this.client.state().mode;
            const i = modes.findIndex((m) => m[0] === cur);
            this.client.setMode(modes[(i + 1) % modes.length][0]);
        } else if (r.kind === 'choice' && r.id === 'which') {
            this.which = this.which === 'hud' ? 'map' : 'hud';
        } else if (r.kind === 'action') {
            if (r.id === 'centre') { this.client.centre(this.which); } else { this.client.reset(this.which); }
        } else if (r.kind === 'slider' && (h.part === 'minus' || h.part === 'plus')) {
            this.step(r.def, h.part === 'plus' ? 1 : -1);
        }
    }

    /* − or + on a setting: one step */
    step(def, dir) {
        const cur = this.rectNow();
        const lim = def.lim(cur);
        this.client.rect(this.which, def.put(clamp(def.get(cur) + dir * def.step, lim[0], lim[1]), cur));
    }

    _slider(i, x) {
        const r = this.rows()[i];
        if (r.kind !== 'slider') {
            return;
        }
        const def = r.def, cur = this.rectNow(), lim = def.lim(cur);
        const b = bar(LIST.x, this.rowY(r), LIST.w);
        const f = clamp((x - b.trackX) / b.trackW, 0, 1);
        const v = lim[0] + f * (lim[1] - lim[0]);
        // a small pull to the default, so it is easy to hit
        const value = Math.abs(v - def.def) < (lim[1] - lim[0]) * 0.015 ? def.def : v;
        this.client.rect(this.which, def.put(value, cur));
    }

    /* the focus follows the finger, held inside the map's rectangle */
    _moveFocus(x, y) {
        const p = rectOnPage(this.which, this.rectNow());
        const fx = clamp((x - p.x) / p.w, 0, 1), fy = clamp((y - p.y) / p.h, 0, 1);
        this.client.rect(this.which, { fx: round2(fx), fy: round2(fy) });
    }

    /* the map follows the finger, its size kept and its place held inside the display */
    _moveRect(x, y) {
        const d = this.drag, b = previewBox(this.which), r0 = d.r0, c = CANVAS[this.which];
        const dx = (x - d.x0) / b.s, dy = (y - d.y0) / b.s;
        this.client.rect(this.which, { x: Math.round(clamp(r0.x + dx, 0, c.w - r0.w)), y: Math.round(clamp(r0.y + dy, 0, c.h - r0.h)) });
    }

    /* ---------------- drawing ---------------- */
    draw(cv) {
        const st = this.client.state();
        cv.fillRect(0, LIST.y - 4, 1600, 520 - LIST.y + 4, C.bg);
        this._drawList(cv, st);
        this._drawPreview(cv, st);
    }

    _drawList(cv, st) {
        const rs = this.rows(), r = st[this.which];
        this.selected = Math.min(this.selected, rs.length - 1);
        this.scroll = clamp(this.scroll, 0, this.maxScroll());
        cv.clip(LIST.x, LIST.y, LIST.w, LIST.h);
        rs.forEach((row, i) => {
            const y = this.rowY(row);
            if (y + row.h < LIST.y || y > LIST.y + LIST.h) {
                return;
            }
            const lit = i === this.selected;
            if (lit) {
                cv.fillRect(LIST.x, y, LIST.w, row.h, C.redFill);
                cv.fillRect(LIST.x, y, LIST.w, 3, C.redLit);
                cv.fillRect(LIST.x, y + row.h - 3, LIST.w, 3, C.redLit);
                if (this.editing) {
                    /* being changed with the knob: a white frame */
                    cv.strokeRoundRect(LIST.x + 3, y + 3, LIST.w - 6, row.h - 6, 4, 3, '#ffffff');
                }
            } else {
                cv.fillRect(LIST.x, y + row.h - 1, LIST.w, 1, C.line);
            }
            if (row.kind === 'slider') {
                this._drawSlider(cv, row, y, r, lit);
            } else {
                V.text(cv, row.label, LIST.x + 28, y + row.h / 2 + 11, 31, C.text);
                let value = '';
                if (row.id === 'mode') { value = (MODES_NATIVE.find((m) => m[0] === st.mode) || ['', '-'])[1]; }
                if (row.id === 'which') { value = (WHICH.find((m) => m[0] === this.which) || ['', ''])[1]; }
                const rx = LIST.x + LIST.w - 30;
                if (value) {
                    V.text(cv, value, rx - 26, y + row.h / 2 + 10, 28, lit ? C.text : C.dim, { align: 'right' });
                }
                const cy = y + row.h / 2;
                cv.polyline([[rx - 8, cy - 11], [rx + 3, cy], [rx - 8, cy + 11]], 3, lit ? C.text : C.dim);
            }
        });
        cv.noclip();
        // scroll bar, as the car's own lists have
        const max = this.maxScroll();
        if (max > 0) {
            const bh = LIST.h * LIST.h / (LIST.h + max), by = LIST.y + (LIST.h - bh) * (this.scroll / max);
            cv.fillRect(LIST.x + LIST.w + 6, LIST.y, 2, LIST.h, C.line);
            cv.fillRect(LIST.x + LIST.w + 4, by, 6, bh, C.text);
        }
    }

    _drawSlider(cv, row, y, r, lit) {
        const def = row.def, v = def.get(r), lim = def.lim(r);
        V.text(cv, row.label, LIST.x + 28, y + 40, 31, C.text);
        V.text(cv, def.show(v), LIST.x + LIST.w - 30, y + 38, 26, lit ? C.text : C.dim, { align: 'right' });
        const b = bar(LIST.x, y, LIST.w);
        // − and +
        const mx = LIST.x + 44, px = LIST.x + LIST.w - 44;
        cv.line(mx - 11, b.cy, mx + 11, b.cy, 3, C.text);
        cv.line(px - 11, b.cy, px + 11, b.cy, 3, C.text);
        cv.line(px, b.cy - 11, px, b.cy + 11, 3, C.text);
        // the track: a thin line, the value as red segments (from the middle for a setting about 0), a white thumb
        const span = lim[1] - lim[0] || 1;
        const f = clamp((v - lim[0]) / span, 0, 1);
        cv.fillRect(b.trackX, b.cy - 1, b.trackW, 2, C.track);
        const from = def.sym ? 0.5 : 0;
        const a = b.trackX + b.trackW * Math.min(from, f), e = b.trackX + b.trackW * Math.max(from, f);
        for (let sx = a; sx < e - 1; sx += 20) {
            cv.fillRect(sx, b.cy - 5, Math.min(16, e - sx), 10, C.red);
        }
        const df = clamp((def.def - lim[0]) / span, 0, 1);
        cv.fillRect(b.trackX + b.trackW * df - 1, b.cy - 12, 2, 24, C.dim);
        const tx = b.trackX + b.trackW * f;
        cv.quad([[tx - 9, b.cy + 7], [tx - 3, b.cy - 7], [tx + 13, b.cy - 7], [tx + 7, b.cy + 7]], C.thumb);
    }

    _drawPreview(cv, st) {
        const b = previewBox(this.which), r = st[this.which];
        const c = CANVAS[this.which];
        V.text(cv, `${this.which === 'hud' ? 'HUD' : 'Đồng hồ'}  ${c.w} x ${c.h}`, PREV.x + 20, PREV.y + 32, 26, C.text, { font: 'bold' });
        const follows = this.native() && this.which === 'hud' && !r.placed;     /* the place is waze-on-cluster's */
        V.text(cv, `${Math.round(r.w)} x ${Math.round(r.h)} tại ${Math.round(r.x)}, ${Math.round(r.y)}${follows ? ' (theo waze)' : ''}`,
            PREV.x + PREV.w - 20, PREV.y + 32, 22, C.dim, { align: 'right' });
        // the display
        cv.roundRect(b.x, b.y, b.w, b.h, 10, '#000000');
        cv.strokeRoundRect(b.x, b.y, b.w, b.h, 10, 2, C.line);
        for (let i = 1; i < 8; i++) {
            cv.line(b.x + (b.w * i) / 8, b.y, b.x + (b.w * i) / 8, b.y + b.h, 1, '#14161a');
        }
        for (let i = 1; i < 5; i++) {
            cv.line(b.x, b.y + (b.h * i) / 5, b.x + b.w, b.y + (b.h * i) / 5, 1, '#14161a');
        }
        const p = rectOnPage(this.which, r);
        const w = (this.client.info ? this.client.info() : {}).waze;
        /* is the map on this display: waze-on-cluster's report (0.9.0), else what the mode asks */
        const shown = this.native() ? !!(this.which === 'hud' ? w.hud : w.cluster) : (st.mode === 'both' || st.mode === this.which);
        cv.roundRect(p.x, p.y, p.w, p.h, 6, shown ? C.map : C.off);
        cv.clip(p.x, p.y, p.w, p.h);
        this._roads(cv, p, r, shown);
        cv.noclip();
        if (this.which === 'hud' && shown) {
            this._softEdges(cv, p, r);
        }
        cv.strokeRoundRect(p.x, p.y, p.w, p.h, 6, 3, shown ? C.accent : C.dim);
        if (!shown) {
            V.text(cv, 'không hiện trên màn này', p.x + 12, p.y + 30, 20, C.dim);
        }
        // the focus: a ring with a cross, put on the car so the zoom keeps it in the middle
        const f = focusOnPage(p, r);
        cv.circle(f.x, f.y, 15, C.focus);
        cv.circle(f.x, f.y, 11, shown ? C.map : C.off);
        cv.line(f.x - 20, f.y, f.x + 20, f.y, 3, C.focus);
        cv.line(f.x, f.y - 20, f.x, f.y + 20, 3, C.focus);
        // help, the map's state (as the older button app showed it) and whether the settings are kept
        const ly = b.y + b.h + 28;
        V.text(cv, 'Kéo bản đồ để di chuyển, kéo dấu + cam vào vị trí xe.', PREV.x + 20, ly, 20, C.dim);
        const info = this.client.info ? this.client.info() : { live: false };
        const line = statusLine(info);
        V.text(cv, line.text, PREV.x + 20, ly + 28, 20, line.warn ? C.warn : C.dim);
        let saved = 'Chưa kết nối dịch vụ nền: chế độ thử', col = C.warn;
        if (info.live) {
            const from = info.loaded && info.loaded.from;
            saved = from === 'saved' ? 'Tự động lưu. Đã khôi phục cài đặt đã lưu.'
                : from === 'backup' ? 'Tự động lưu. Đã khôi phục từ bản sao lưu.'
                    : 'Tự động lưu. Lúc khởi động không có cài đặt đã lưu.';
            col = from === 'saved' || from === 'backup' ? C.dim : C.warn;
            if (info.note) { saved = info.note; col = C.warn; }
        }
        V.text(cv, saved, PREV.x + 20, ly + 56, 20, col);
    }

    /* the soft edges as the HUD shows them: black bands, darker towards the sides (black is no light there) */
    _softEdges(cv, p, r) {
        const fe = typeof r.fe === 'number' ? r.fe : 0.15;
        const side = Math.min(p.w, p.h) * fe;
        const N = 10;
        if (side < 1) {
            return;
        }
        for (let i = 0; i < N; i++) {
            const t = (i + 0.5) / N;                       /* 0 at the side, 1 inside */
            const a = Math.round(255 * (1 - t * t * (3 - 2 * t)));
            const inset = side * i / N, w = Math.max(1, side / N);
            const col = `#000000${(a < 16 ? '0' : '') + a.toString(16)}`;
            cv.fillRect(p.x + inset, p.y + inset, p.w - 2 * inset, w, col);
            cv.fillRect(p.x + inset, p.y + p.h - inset - w, p.w - 2 * inset, w, col);
            cv.fillRect(p.x + inset, p.y + inset + w, w, p.h - 2 * inset - 2 * w, col);
            cv.fillRect(p.x + p.w - inset - w, p.y + inset + w, w, p.h - 2 * inset - 2 * w, col);
        }
    }

    _roads(cv, p, r, shown) {
        const z = r.zoom, ang = (r.rot * Math.PI) / 180, ca = Math.cos(ang), sa = Math.sin(ang);
        const f = focusOnPage(p, r);
        /* a sample map, zoomed about the focus like the real one */
        const k = Math.min(p.w, p.h) / 2;
        const ox = p.x + p.w / 2, oy = p.y + p.h / 2;
        const pt = (ux, uy) => {
            const bx = ox + ux * k * 1.4, by = oy + uy * k * 1.4;
            const dx = (bx - f.x) * z, dy = (by - f.y) * z;
            return [f.x + dx * ca - dy * sa, f.y + dx * sa + dy * ca];
        };
        const col = shown ? ['#2f6f82', '#245a6a', '#3a8aa0'] : ['#3a3a3a', '#333333', '#444444'];
        const road = (pts, w, c) => cv.polyline(pts.map((q) => pt(q[0], q[1])), w, c);
        road([[-2, -0.55], [-0.6, -0.3], [0.3, -0.35], [2, 0.1]], 7, col[0]);
        road([[-1.6, 0.7], [-0.4, 0.25], [0.5, 0.2], [1.8, 0.8]], 6, col[0]);
        road([[-0.5, -2], [-0.3, -0.5], [-0.35, 0.4], [-0.1, 2]], 5, col[1]);
        road([[0.9, -2], [0.6, -0.4], [0.5, 0.5], [0.8, 2]], 5, col[1]);
        road([[-2, 0], [2, 0]], 2, col[2]);
        road([[0, -2], [0, 2]], 2, col[2]);
    }
}

module.exports = { Designer, sliders, rows, bar, statusLine, previewBox, rectOnPage, focusOnPage, MODES, MODES_NATIVE, WHICH, PREV, LIST };
