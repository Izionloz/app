// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * hud_control - the HUD map app's side of two local sockets (Node 8 safe).
 *
 *  - /dev/shm/waze-on-cluster/ctl.sock, the installed waze-on-cluster tool:
 *    the status it broadcasts ({"ev":"status","state","target","page",...})
 *    and {"cmd":"start","target":"map"|"hud"} (used only when the helper
 *    below is not there).
 *  - /dev/shm/mgux-hud/ctl.sock, the mgux-hud-ctl helper: it keeps the map's
 *    display and rectangle and applies them by restarting waze-on-cluster
 *    ({"cmd":"get"|"set"|"adjust"|"centre"|"reset"}, answered by
 *    {"ev":"state","target","w","h","x","y","pct","dx","dy","restarting",...}).
 * No fork and no other tool is needed.
 */
'use strict';

const EventEmitter = require('events');
const net = require('net');

const WAZE_PATH = '/dev/shm/waze-on-cluster/ctl.sock';
const HELPER_PATH = '/dev/shm/mgux-hud/ctl.sock';
const RETRY_MS = 1000;
const MAX_BUFFER = 65536;
/* movement step in HUD pixels; a size step is twice that */
const STEPS = [['Fine', 4], ['Normal', 20], ['Coarse', 60]];
const MAP_ASPECT = 1088 / 480;

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
        this._asked = null;
        this._step = 1;
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
        this._asked = null;
        this.emit('change');
    }

    _onWaze(m) {
        if (m.ev === 'closed') {
            this.status = null;
        } else if (m.ev === 'status') {
            this.status = m;
            if (this._asked && m.target === this._asked) {
                this._asked = null;
            }
        }
        this.emit('change');
    }

    _onHelper(m) {
        if (m.ev === 'closed') {
            this.hs = null;
        } else if (m.ev === 'state') {
            this.hs = m;
            this._asked = null;
        }
        this.emit('change');
    }

    /* ---- what is shown where ---- */
    hasHelper() {
        return this.helper.ready && !!this.hs;
    }

    target() {
        if (this._asked) {
            return this._asked;
        }
        const t = (this.hs && this.hs.target) || (this.status && this.status.target);
        return t === 'hud' || t === 'map' ? t : null;
    }

    onHud() {
        return this.target() === 'hud';
    }

    canSwitch() {
        return this.hasHelper() || (this.waze.ready && this.target() !== null);
    }

    /* One press moves the map to the other display. */
    toggle() {
        if (!this.canSwitch()) {
            return false;
        }
        const next = this.onHud() ? 'map' : 'hud';
        this._asked = next;
        this._log.info(`hud: map to ${next}`);
        if (this.hasHelper()) {
            this.helper.send({ cmd: 'set', target: next });
        } else {
            this.waze.send({ cmd: 'start', target: next });
        }
        this.emit('change');
        return true;
    }

    /* ---- size and place of the HUD map (helper) ---- */
    canAdjust() {
        return this.hasHelper();
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
        this.helper.send(Object.assign({ cmd: 'adjust' }, a));
        return true;
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

    /* Changes made with the bars wait until Apply: it restarts waze-on-cluster once. */
    pending() {
        return !!(this.hs && this.hs.pending);
    }

    canApply() {
        return this.hasHelper() && this.pending() && !this.hs.restarting;
    }

    apply() {
        return this.canApply() && this.helper.send({ cmd: 'apply' });
    }

    revert() {
        return this.hasHelper() && this.pending() && this.helper.send({ cmd: 'revert' });
    }

    applyText() {
        if (!this.hasHelper()) {
            return 'Apply';
        }
        if (this.hs.restarting) {
            return 'Applying - the map restarts, please wait';
        }
        return this.pending() ? 'APPLY the changes now (restarts the map for a moment)' : 'Apply (no changes pending)';
    }

    centre() {
        return this.canAdjust() && this.helper.send({ cmd: 'centre' });
    }

    reset() {
        return this.canAdjust() && this.helper.send({ cmd: 'reset' });
    }

    /* ---- texts ---- */
    displayText() {
        const t = this.target();
        const open = this.hasHelper() && this.hs.appliedTarget !== this.hs.target ? ' - not applied yet' : '';
        return `Show map on: ${t === 'hud' ? 'HUD' : t === 'map' ? 'Cluster' : '…'}  (press to switch)${open}`;
    }

    sizeText() {
        const h = this.hs;
        return h ? `Bigger  (now ${h.w} x ${h.h} px, ${h.pct} % of the HUD width)` : 'Bigger';
    }

    positionText() {
        const h = this.hs;
        return h ? `Centre  (now ${h.dx} px right, ${h.dy} px down from the middle)` : 'Centre';
    }

    /* ---- text sliders: the thumb O moves along the track, | is the default/centre ---- */
    _bar(label, frac, left, right, value) {
        const N = 21;
        const i = Math.max(0, Math.min(N - 1, Math.round(((frac + 1) / 2) * (N - 1))));
        let track = '';
        for (let n = 0; n < N; n++) {
            track += n === i ? 'O' : n === (N - 1) / 2 ? '|' : '-';
        }
        return `${label}: ${left} [${track}] ${right}   ${value}`;
    }

    sizeBar() {
        const h = this.hs;
        if (!h) {
            return 'Size: (waiting for mgux-hud-ctl)';
        }
        /* 30 %..85 % of the HUD width, the default (57 %) in the middle */
        const frac = Math.max(-1, Math.min(1, (h.pct - 57.5) / 27.5));
        return this._bar('Size', frac, 'small', 'big', `${h.w} x ${h.h} px (${h.pct} %)`);
    }

    horizontalBar() {
        const h = this.hs;
        if (!h) {
            return 'Horizontal: -';
        }
        const room = (h.canvasW - h.w) / 2;
        return this._bar('Horizontal', room > 0 ? Math.max(-1, Math.min(1, h.dx / room)) : 0, 'left', 'right', `${h.dx} px`);
    }

    verticalBar() {
        const h = this.hs;
        if (!h) {
            return 'Vertical: -';
        }
        const room = (h.canvasH - h.h) / 2;
        return this._bar('Vertical', room > 0 ? Math.max(-1, Math.min(1, h.dy / room)) : 0, 'up', 'down', `${h.dy} px`);
    }

    statusText() {
        if (!this.waze.ready && !this.helper.ready) {
            return 'Waze map service not running (waze-on-cluster)';
        }
        if (this.hs && this.hs.restarting) {
            return 'Applying - the map restarts for a few seconds';
        }
        const parts = [];
        const s = this.status;
        const where = this.target() === 'hud' ? 'HUD' : 'cluster';
        if (!s) {
            parts.push('Connecting…');
        } else if (s.state === 'showing') {
            parts.push(`Showing on the ${where}: ${s.page || 'map'}`);
        } else if (s.state === 'starting') {
            parts.push(`Starting map on the ${where}…`);
        } else if (s.state === 'frozen') {
            parts.push('Map frozen - reconnect CarPlay');
        } else if (s.state === 'error') {
            parts.push(`Map error: ${s.reason || 'unknown'}`);
        } else {
            parts.push(`Waiting for CarPlay's map (${where})`);
        }
        if (this.hasHelper() && this.hs.pending && !this.hs.restarting) {
            parts.push('changes pending - press Apply');
        }
        if (!this.hasHelper()) {
            parts.push('size and position need mgux-hud-ctl');
        } else if (this.hs.note) {
            parts.push(this.hs.note);
        }
        return parts.join(' - ');
    }
}

module.exports = { HudControl, LineClient, STEPS, WAZE_PATH, HELPER_PATH };