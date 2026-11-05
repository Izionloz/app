// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * viet - Vietnamese text on the kit's canvas. The kit's font atlases hold Latin letters without diacritics only
 * (113 glyphs), so a Vietnamese letter is drawn as its base letter from the font and its marks drawn as strokes:
 * breve, circumflex, horn, the five tones (grave, acute, hook, tilde, dot below) and the bar of đ.
 * The letters are taken apart with tables (not String.normalize, which a Node 8 without ICU may lack).
 * Node 8 compatible; no kit calls but the canvas handed in (text, textWidth, line, polyline, circle).
 */
'use strict';

const VOWELS = 'aăâeêioôơuưy';
const VOWELS_UP = 'AĂÂEÊIOÔƠUƯY';
const PLAIN = 'aaaeeiooouuy';
const MOD = ['', 'breve', 'circ', '', 'circ', '', '', 'circ', 'horn', '', 'horn', ''];
const TONES = ['grave', 'acute', 'hook', 'tilde', 'dot'];
/* each vowel of VOWELS with each tone of TONES, in that order */
const TONED = 'àáảãạằắẳẵặầấẩẫậèéẻẽẹềếểễệìíỉĩịòóỏõọồốổỗộờớởỡợùúủũụừứửữựỳýỷỹỵ';
const TONED_UP = 'ÀÁẢÃẠẰẮẲẴẶẦẤẨẪẬÈÉẺẼẸỀẾỂỄỆÌÍỈĨỊÒÓỎÕỌỒỐỔỖỘỜỚỞỠỢÙÚỦŨỤỪỨỬỮỰỲÝỶỸỴ';

/* one character: its base letter (in the font) and its marks */
function split(ch) {
    if (ch === 'đ') { return { base: 'd', marks: ['bar'], upper: false }; }
    if (ch === 'Đ') { return { base: 'D', marks: ['bar'], upper: true }; }
    let v = -1, tone = -1, upper = false;
    let i = TONED.indexOf(ch);
    if (i < 0) { i = TONED_UP.indexOf(ch); upper = i >= 0; }
    if (i >= 0) {
        v = Math.floor(i / 5);
        tone = i % 5;
    } else {
        v = VOWELS.indexOf(ch);
        if (v < 0) { v = VOWELS_UP.indexOf(ch); upper = v >= 0; }
    }
    if (v < 0) {
        return { base: ch, marks: [], upper: false };
    }
    const marks = [];
    if (MOD[v]) { marks.push(MOD[v]); }
    if (tone >= 0) { marks.push(TONES[tone]); }
    return { base: upper ? PLAIN[v].toUpperCase() : PLAIN[v], marks, upper };
}

/* the string as runs: plain text (one text call) or one marked letter */
function runs(str) {
    const out = [];
    let plain = '';
    for (const ch of String(str)) {
        const p = split(ch);
        if (p.marks.length) {
            if (plain) { out.push({ text: plain, marks: [] }); plain = ''; }
            out.push({ text: p.base, marks: p.marks, upper: p.upper });
        } else {
            plain += p.base;
        }
    }
    if (plain) { out.push({ text: plain, marks: [] }); }
    return out;
}

function width(cv, str, size, opts) {
    const o = { literal: true, font: (opts && opts.font) || 'label' };
    return runs(str).reduce((w, r) => w + cv.textWidth(r.text, size, o), 0);
}

/* the marks of one letter drawn at pen x (its width w) on baseline y */
function marks(cv, r, x, w, y, s, c) {
    const lw = Math.max(1.6, s * 0.075);
    const cx = x + w / 2;
    const top = y - (r.upper ? 0.76 : 0.57) * s;
    let level = top - 0.03 * s;
    let tx = cx;
    r.marks.forEach((m) => {
        if (m === 'circ') {
            cv.polyline([[cx - 0.13 * s, level], [cx, level - 0.13 * s], [cx + 0.13 * s, level]], lw, c);
            level -= 0.17 * s;
            tx = cx + 0.17 * s;
        } else if (m === 'breve') {
            cv.polyline([[cx - 0.12 * s, level - 0.12 * s], [cx - 0.06 * s, level - 0.02 * s], [cx + 0.06 * s, level - 0.02 * s],
                [cx + 0.12 * s, level - 0.12 * s]], lw, c);
            level -= 0.16 * s;
        } else if (m === 'horn') {
            const hx = x + w * 0.8;
            cv.polyline([[hx, top + 0.1 * s], [hx + 0.1 * s, top + 0.04 * s], [hx + 0.1 * s, top - 0.07 * s]], lw, c);
        } else if (m === 'bar') {
            if (r.upper) {
                cv.line(x - 0.02 * s, y - 0.36 * s, x + w * 0.5, y - 0.36 * s, lw, c);
            } else {
                cv.line(x + w * 0.46, y - 0.64 * s, x + w * 1.04, y - 0.64 * s, lw, c);
            }
        } else if (m === 'acute') {
            cv.line(tx - 0.05 * s, level, tx + 0.08 * s, level - 0.16 * s, lw, c);
        } else if (m === 'grave') {
            cv.line(tx + 0.05 * s, level, tx - 0.08 * s, level - 0.16 * s, lw, c);
        } else if (m === 'hook') {
            cv.polyline([[tx - 0.06 * s, level - 0.13 * s], [tx, level - 0.18 * s], [tx + 0.07 * s, level - 0.13 * s],
                [tx, level - 0.07 * s], [tx, level - 0.01 * s]], lw * 0.85, c);
        } else if (m === 'tilde') {
            cv.polyline([[tx - 0.13 * s, level - 0.03 * s], [tx - 0.06 * s, level - 0.13 * s], [tx + 0.05 * s, level - 0.04 * s],
                [tx + 0.13 * s, level - 0.14 * s]], lw, c);
        } else if (m === 'dot') {
            cv.circle(cx, y + 0.16 * s, Math.max(1.6, 0.065 * s), c);
        }
    });
}

/* text(cv, str, x, y, size, colour, {font, align}) like the canvas's own, with Vietnamese marks; returns the width */
function text(cv, str, x, y, size, c, opts) {
    const o = { literal: true, font: (opts && opts.font) || 'label' };
    const rs = runs(str);
    const ws = rs.map((r) => cv.textWidth(r.text, size, o));
    const total = ws.reduce((a, b) => a + b, 0);
    const align = opts && opts.align;
    let pen = align === 'center' ? x - total / 2 : align === 'right' ? x - total : x;
    rs.forEach((r, i) => {
        cv.text(r.text, pen, y, size, c, o);
        if (r.marks.length) {
            marks(cv, r, pen, ws[i], y, size, c);
        }
        pen += ws[i];
    });
    return total;
}

module.exports = { text, width, split, runs };
