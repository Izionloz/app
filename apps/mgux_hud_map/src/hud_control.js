// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * hud_control - the HUD map app's side of two local sockets (Node 8 safe).
 *
 *  - /dev/shm/waze-on-cluster/ctl.sock: the status the installed
 *    waze-on-cluster tool broadcasts ({"ev":"status","state",...}), and, only
 *    when the helper below is not there, {"cmd":"start","target":"map"|"hud"}.
 *  - /dev/shm/mgux-hud/ctl.sock: the mgux-hud-ctl helper, which puts the map on
 *    the cluster, the HUD or both and moves it live
 *    ({"cmd":"get"|"set"|"adjust"|"centre"|"reset"}, answered by
 *    {"ev":"state","mode","hud":{w,h,x,y,pct,dx,dy,...},"map":{...},"connections"}).
 * Changes show at once, no restart. No fork and no other tool is needed.
 */
'use strict';

const EventEmitter = require('events');
const net = require('net');

const WAZE_PATH = '/dev/shm/waze-on-cluster/ctl.sock';
const HELPER_PATH = '/dev/shm/mgux-hud/ctl.sock';
const RETRY_MS = 1000;
const MAX_BUFFER = 65536;
/* movement step in pixels; a size step is twice that */
const STEPS = [['Fine', 4], ['Normal', 20], ['Coarse', 60]];
const MAP_ASPECT = 1088 / 480;
const MODES = ['map', 'hud', 'both'];
const MODE_NAMES = { map: 'Cluster', hud: 'HUD', both: 'Cluster + HUD' };

/* A newline-delimited JSON client that reconnects while wanted. */
class LineClient extends EventEmitter {
    constructor(path, onMessage) {
        super();
        this.path = path;
        this.onMessage = onMessage;
        this.ready = false;
        this._sock = null;
        this._buf = '';
        this._timer = null;
        this._wanted = false;
    }

    open() {
        this._wanted = true;
        this._connect();
    }

    close() {
        this._wanted = false;
        clearTimeout(this._timer);
        this._timer = null;
        const sock = this._sock;
        this._sock = null;
        this.ready = false;
        this._buf = '';
        if (sock) {
            sock.removeAllListeners('data');
            sock.on('error', () => {});
            sock.destroy();
        }
    }

    send(obj) {
        if (!this.ready) {
            return false;
        }
        this._sock.write(`${JSON.stringify(obj)}\n`);
        return true;
    }

    _connect() {
        if (!this._wanted || this._sock) {
            return;
        }
        const sock = net.connect(this.path);
        this._sock = sock;
        sock.setEncoding('utf8');
        sock.on('connect', () => {
            this.ready = true;
            this.emit('change');
        });
        sock.on('data', (chunk) => {
            this._buf += chunk;
            if (this._buf.length > MAX_BUFFER && this._buf.indexOf('\n') < 0) {
                this._buf = '';
            }
            let i;
            while ((i = this._buf.indexOf('\n')) >= 0) {
                const line = this._buf.slice(0, i);
                this._buf = this._buf.slice(i + 1);
                try {
                    this.onMessage(JSON.parse(line));
                } catch (e) {
                    /* not JSON: ignored */
                }
            }
        });
        sock.on('error', () => { /* 'close' follows */ });
        sock.on('close', () => {
            if (this._sock === sock) {
                this._sock = null;
                this.ready = false;
                this._buf = '';
                this.onMessage({ ev: 'closed' });
                this.emit('change');
                if (this._wanted && !this._timer) {
                    this._timer = setTimeout(() => {
                        this._timer = null;
                        this._connect();
                    }, RETRY_MS);
                }
            }
        });
    }
}

class HudControl extends EventEmitter {
    constructor(opts) {
        super();
        const o = opts || {};
        this._log = o.log || { info() {}, warn() {} };
        this.status = null;      /* waze-on-cluster's last status */
        this.hs = null;          /* the helper's last state */
        this._step = 1;
        this._which = 'hud';     /* the display the bars and buttons adjust */
        this.waze = new LineClient(o.wazePath || WAZE_PATH, (m) => this._onWaze(m));
        this.helper = new LineClient(o.helperPath || HELPER_PATH, (m) => this._onHelper(m));
        this.waze.on('change', () => this.emit('change'));
        this.helper.on('change', () => this.emit('change'));
    }

    open() {
        this.waze.open();
        this.helper.open();
    }

    close() {
        this.waze.close();
        this.helper.close();
        this.status = null;
        this.hs = null;
        this.emit('change');
    }

    _onWaze(m) {
        if (m.ev === 'closed') {
            this.status = null;
        } else if (m.ev === 'status') {
            this.status = m;
        }
        this.emit('change');
    }

    _onHelper(m) {
        if (m.ev === 'closed') {
            this.hs = null;
        } else if (m.ev === 'state') {
            this.hs = m;
        }
        this.emit('change');
    }

    hasHelper() {
        return this.helper.ready && !!this.hs;
    }

    /* ---- where the map is shown ---- */
    mode() {
        if (this.hs && MODES.indexOf(this.hs.mode) >= 0) {
            return this.hs.mode;
        }
        const t = this.status && this.status.target;
        return t === 'hud' || t === 'map' ? t : null;
    }

    canSwitch() {
        return this.hasHelper() || (this.waze.ready && this.mode() !== null);
    }

    /* One press: Cluster, then HUD, then both, then the cluster again. */
    toggle() {
        if (!this.canSwitch()) {
            return false;
        }
        const cur = this.mode();
        const next = MODES[(MODES.indexOf(cur) + 1) % MODES.length];
        this._log.info(`hud: map to ${next}`);
        if (this.hasHelper()) {
            this.helper.send({ cmd: 'set', mode: next });
        } else if (next !== 'both') {
            this.waze.send({ cmd: 'start', target: next });
        }
        this.emit('change');
        return true;
    }

    displayText() {
        const m = this.mode();
        return `Show map on: ${m ? MODE_NAMES[m] : '…'}  (press to change)`;
    }

    /* ---- which display the bars adjust, and the step ---- */
    which() {
        return this._which;
    }

    cycleWhich() {
        this._which = this._which === 'hud' ? 'map' : 'hud';
        this.emit('change');
    }

    whichText() {
        return `Adjusting: ${this._which === 'hud' ? 'the HUD map' : 'the cluster map'}  (press to switch)`;
    }

    canAdjust() {
        return this.hasHelper();
    }

    rect() {
        return this.hasHelper() ? this.hs[this._which] : null;
    }

    stepPx() {
        return STEPS[this._step][1];
    }

    cycleStep() {
        this._step = (this._step + 1) % STEPS.length;
        this.emit('change');
    }

    stepText() {
        const s = STEPS[this._step];
        return `Step: ${s[0]} (${s[1]} px, size ${s[1] * 2} px) - press to change`;
    }

    _adjust(a) {
        if (!this.canAdjust()) {
            return false;
        }
        return this.helper.send(Object.assign({ cmd: 'adjust', which: this._which }, a));
    }

    /* Larger / smaller keep the map's shape; wider, narrower, taller and shorter change one side. */
    resize(dir) {
        const dw = this.stepPx() * 2 * dir;
        return this._adjust({ dw, dh: Math.round(dw / MAP_ASPECT) });
    }

    stretch(axis, dir) {
        const d = this.stepPx() * 2 * dir;
        return this._adjust(axis === 'w' ? { dw: d } : { dh: d });
    }

    move(dir) {
        const p = this.stepPx();
        const d = { left: { dx: -p }, right: { dx: p }, up: { dy: -p }, down: { dy: p } }[dir];
        return d ? this._adjust(d) : false;
    }

    /* Brightness is the map layer's opacity (10-100 %); a step is a fifth of the movement step in per cent. */
    brightness(dir) {
        return this._adjust({ dop: dir * this.stepPx() / 200 });
    }

    /* One edge on its own: edge is left, right, top or bottom; dir +1 moves it outward, -1 inward. */
    edge(edge, dir) {
        const k = { left: 'el', right: 'er', top: 'et', bottom: 'eb' }[edge];
        return k ? this._adjust({ [k]: dir * this.stepPx() }) : false;
    }

    /* Zoom magnifies the map's picture about its centre (30-300 %); rotate turns it (degrees). */
    zoom(dir) {
        return this._adjust({ dz: dir * this.stepPx() / 200 });
    }

    rotate(dir) {
        return this._adjust({ drot: dir * Math.max(1, Math.round(this.stepPx() / 4)) });
    }

    centre() {
        return this.canAdjust() && this.helper.send({ cmd: 'centre', which: this._which });
    }

    reset() {
        return this.canAdjust() && this.helper.send({ cmd: 'reset', which: this._which });
    }

    /* ---- text sliders: the thumb O moves along the track, | is the default ---- */
    _bar(label, value, min, max, def, left, right, text) {
        const N = 21;
        const pos = (v) => Math.max(0, Math.min(N - 1, Math.round(((v - min) / (max - min || 1)) * (N - 1))));
        const i = pos(value), d = pos(def);
        let track = '';
        for (let n = 0; n < N; n++) {
            track += n === i ? 'O' : n === d ? '|' : '-';
        }
        return `${label}: ${left} [${track}] ${right}   ${text}`;
    }

    sizeBar() {
        const r = this.rect();
        if (!r) {
            return 'Size: (waiting for mgux-hud-ctl)';
        }
        const hud = this._which === 'hud';
        return this._bar('Size', r.pct, 30, hud ? 85 : 100, hud ? 57 : 100, 'small', 'big', `${r.w} x ${r.h} px (${r.pct} %)`);
    }

    horizontalBar() {
        const r = this.rect();
        if (!r) {
            return 'Horizontal: -';
        }
        const room = (r.canvasW - r.w) / 2;
        return this._bar('Horizontal', r.dx, -room, room, 0, 'left', 'right', `${r.dx} px`);
    }

    verticalBar() {
        const r = this.rect();
        if (!r) {
            return 'Vertical: -';
        }
        const room = (r.canvasH - r.h) / 2;
        return this._bar('Vertical', r.dy, -room, room, 0, 'up', 'down', `${r.dy} px`);
    }

    brightBar() {
        const r = this.rect();
        if (!r) {
            return 'Brightness: -';
        }
        return this._bar('Brightness', r.bright, 10, 100, 100, 'dark', 'bright', `${r.bright} %`);
    }

    zoomBar() {
        const r = this.rect();
        if (!r) {
            return 'Zoom: -';
        }
        return this._bar('Zoom', r.zoomPct, 30, 300, 100, 'out', 'in', `${r.zoomPct} %`);
    }

    rotateBar() {
        const r = this.rect();
        if (!r) {
            return 'Rotate: -';
        }
        return this._bar('Rotate', r.rot, -180, 180, 0, 'left', 'right', `${r.rot} deg`);
    }

    statusText() {
        if (!this.waze.ready && !this.helper.ready) {
            return 'Waze map service not running (waze-on-cluster)';
        }
        const parts = [];
        const s = this.status;
        if (!s) {
            parts.push('Connecting…');
        } else if (s.state === 'showing') {
            parts.push(`Showing: ${s.page || 'map'}`);
        } else if (s.state === 'starting') {
            parts.push('Starting the map…');
        } else if (s.state === 'frozen') {
            parts.push('Map frozen - reconnect CarPlay');
        } else if (s.state === 'error') {
            parts.push(`Map error: ${s.reason || 'unknown'}`);
        } else {
            parts.push("Waiting for CarPlay's map");
        }
        if (!this.hasHelper()) {
            parts.push('size and position need mgux-hud-ctl');
        } else if (this.hs.connections === 0) {
            parts.push('not linked yet - restart the head unit once');
        } else if (this.hs.note) {
            parts.push(this.hs.note);
        }
        return parts.join(' - ');
    }
}

module.exports = { HudControl, LineClient, STEPS, MODES, WAZE_PATH, HELPER_PATH };