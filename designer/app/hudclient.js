// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * hudclient - the designer's link to the mgux-hud-ctl helper (/dev/shm/mgux-hud/ctl.sock, newline JSON).
 * It keeps the helper's last state, sends absolute `rect` changes at most every SEND_MS (a finger drag makes
 * many), and falls back to a local demo state when the helper is not there, so the page still draws.
 * Node 8 compatible.
 */
'use strict';

const net = require('net');

const HELPER_PATH = '/dev/shm/mgux-hud/ctl.sock';
const RETRY_MS = 1000;
const SEND_MS = 60;
const CANVAS = { hud: { w: 800, h: 480 }, map: { w: 1088, h: 480 } };
const MIN_W = 40, MIN_H = 20;
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

function demoRect(which) {
    const c = CANVAS[which];
    return which === 'hud' ? { custom: false, x: 172, y: 140, w: 456, h: 202, opacity: 1, zoom: 1, rot: 0 }
        : { custom: false, x: 0, y: 0, w: c.w, h: c.h, opacity: 1, zoom: 1, rot: 0 };
}

class HudClient {
    constructor(opts) {
        const o = opts || {};
        this.path = o.path || HELPER_PATH;
        this.log = o.log || { info() {}, warn() {} };
        this.hs = null;
        this.sock = null;
        this.ready = false;
        this.buf = '';
        this.timer = null;
        this.wanted = false;
        this.pend = { hud: null, map: null };
        this.sendTimer = null;
        this.demo = { mode: 'hud', hud: demoRect('hud'), map: demoRect('map') };
        if (typeof process !== 'undefined' && process.env && process.env.HUDD_DEMO) {
            try { const o = JSON.parse(process.env.HUDD_DEMO); this.demo = Object.assign(this.demo, o); } catch (e) { /* a preview aid only */ }
        }
        this.onChange = null;
    }

    open() {
        this.wanted = true;
        this._connect();
    }

    close() {
        this.wanted = false;
        clearTimeout(this.timer);
        clearTimeout(this.sendTimer);
        this.sendTimer = null;
        this.pend = { hud: null, map: null };
        const s = this.sock;
        this.sock = null;
        this.ready = false;
        if (s) {
            s.removeAllListeners('data');
            s.on('error', () => {});
            s.destroy();
        }
    }

    connected() {
        return this.ready && !!this.hs;
    }

    /* the state to draw: the helper's, else the local demo */
    state() {
        const s = this.connected() ? this.hs : this.demo;
        return { mode: s.mode, hud: Object.assign({ canvasW: 800, canvasH: 480 }, s.hud), map: Object.assign({ canvasW: 1088, canvasH: 480 }, s.map) };
    }

    _connect() {
        if (!this.wanted || this.sock) {
            return;
        }
        const s = net.connect(this.path);
        this.sock = s;
        s.setEncoding('utf8');
        s.on('connect', () => { this.ready = true; this._changed(); });
        s.on('data', (d) => {
            this.buf += d;
            if (this.buf.length > 65536 && this.buf.indexOf('\n') < 0) {
                this.buf = '';
            }
            let i;
            while ((i = this.buf.indexOf('\n')) >= 0) {
                const line = this.buf.slice(0, i);
                this.buf = this.buf.slice(i + 1);
                try {
                    const m = JSON.parse(line);
                    if (m.ev === 'state') {
                        this.hs = m;
                        this._changed();
                    }
                } catch (e) { /* ignored */ }
            }
        });
        s.on('error', () => {});
        s.on('close', () => {
            if (this.sock === s) {
                this.sock = null;
                this.ready = false;
                this.hs = null;
                this._changed();
                if (this.wanted && !this.timer) {
                    this.timer = setTimeout(() => { this.timer = null; this._connect(); }, RETRY_MS);
                }
            }
        });
    }

    _changed() {
        if (this.onChange) {
            this.onChange();
        }
    }

    _send(obj) {
        if (this.ready) {
            this.sock.write(`${JSON.stringify(obj)}\n`);
        }
    }

    setMode(mode) {
        if (this.connected()) {
            this._send({ cmd: 'set', mode });
        } else {
            this.demo.mode = mode;
        }
    }

    /* absolute values for one display; bursts are merged and sent every SEND_MS */
    rect(which, patch) {
        const cur = this.state()[which];
        // the screen follows the finger at once, ahead of the helper's answer
        const local = Object.assign({}, cur, patch, { custom: true });
        const c = CANVAS[which];
        local.w = clamp(local.w, MIN_W, c.w);
        local.h = clamp(local.h, MIN_H, c.h);
        local.x = clamp(local.x, 0, c.w - local.w);
        local.y = clamp(local.y, 0, c.h - local.h);
        const target = this.connected() ? this.hs : this.demo;
        target[which] = Object.assign({}, target[which], local);
        if (!this.connected()) {
            /* demo only: nothing is queued, or a later connection would send these old changes */
            return;
        }
        this.pend[which] = Object.assign(this.pend[which] || {}, patch);
        if (!this.sendTimer) {
            this.sendTimer = setTimeout(() => {
                this.sendTimer = null;
                ['hud', 'map'].forEach((w) => {
                    if (this.pend[w]) {
                        this._send(Object.assign({ cmd: 'rect', which: w }, this.pend[w]));
                        this.pend[w] = null;
                    }
                });
            }, SEND_MS);
        }
    }

    centre(which) {
        if (this.connected()) {
            this._send({ cmd: 'centre', which });
        } else {
            const r = this.demo[which], c = CANVAS[which];
            r.x = Math.round((c.w - r.w) / 2);
            r.y = Math.round((c.h - r.h) / 2);
        }
    }

    reset(which) {
        if (this.connected()) {
            this._send({ cmd: 'reset', which });
        } else {
            this.demo[which] = demoRect(which);
        }
    }
}

module.exports = { HudClient, CANVAS, MIN_W, MIN_H };