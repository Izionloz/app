// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * hudctl - root helper behind the HUD map app (mgux_hud_map).
 *
 * waze-on-cluster draws the CarPlay map into a rectangle of its target
 * ("map_rect = X,Y,W,H" in the target's pixels) and takes the target ("map",
 * "hud") as configuration read at its start. Neither can change while it runs,
 * so this helper keeps the wanted target and rectangle in
 * /var/opt/mgux-hud/state.json, writes them as arguments into
 * /var/opt/mgux-hud/args.env (read by a drop-in of waze-on-cluster.service as
 * $MGUX_HUD_ARGS) and restarts waze-on-cluster.service a moment after the
 * last change. The choice therefore also survives a head-unit restart.
 *
 * The app talks to it on /dev/shm/mgux-hud/ctl.sock (group tm_oap_app),
 * newline-delimited JSON:
 *   {"cmd":"get"}
 *   {"cmd":"set","target":"map"|"hud"}      (these four only change the pending state)
 *   {"cmd":"adjust","dw":px,"dh":px,"dx":px,"dy":px}   (deltas)
 *   {"cmd":"centre"}  {"cmd":"reset"}  (back to the default)
 *   {"cmd":"apply"}   writes the pending state out and restarts waze-on-cluster once
 *   {"cmd":"revert"}  drops the pending state
 * and gets {"ev":"state",...} after every command and when a restart ends.
 *
 * Only the two documented waze-on-cluster arguments are ever generated, from
 * validated integers. A restart after which the service is not active within
 * START_WAIT_MS is undone once (the arguments are cleared). Node 8 compatible;
 * the process never exits on an error.
 */
'use strict';

const fs = require('fs');
const net = require('net');
const path = require('path');
const cp = require('child_process');

const env = process.env;
const SOCK = env.HUDCTL_SOCK || '/dev/shm/mgux-hud/ctl.sock';
const STATE_DIR = env.HUDCTL_STATE_DIR || '/var/opt/mgux-hud';
const STATE_FILE = path.join(STATE_DIR, 'state.json');
const ENV_FILE = path.join(STATE_DIR, 'args.env');
const SYSTEMCTL = env.HUDCTL_SYSTEMCTL || 'systemctl';
const UNIT = 'waze-on-cluster.service';
const APPLY_GAP_MS = 20000;
const START_WAIT_MS = 15000;

/* cluster-render.conf hud_size, the HUD target's pixels; the map is 1088x480 */
const DEFAULTS = { canvasW: 800, canvasH: 480, target: 'map', custom: false, w: 456, h: 202, x: 172, y: 139 };
const MIN_W = 40, MIN_H = 20;

/* mkdir -p for Node 8, whose mkdirSync has no recursive option. */
function mkdirp(dir, mode) {
    try {
        fs.mkdirSync(dir, mode);
    } catch (e) {
        if (e.code === 'EEXIST') {
            return;
        }
        if (e.code !== 'ENOENT') {
            throw e;
        }
        mkdirp(path.dirname(dir), mode);
        fs.mkdirSync(dir, mode);
    }
}

const even = (n) => Math.round(n / 2) * 2;
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

/* A state with every field a valid integer, the rectangle inside the canvas. */
function normalise(s) {
    const d = DEFAULTS;
    const n = (v, def) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : def);
    const out = {
        canvasW: clamp(n(s.canvasW, d.canvasW), 100, 4000),
        canvasH: clamp(n(s.canvasH, d.canvasH), 100, 4000),
        target: s.target === 'hud' ? 'hud' : 'map',
        custom: s.custom === true
    };
    out.w = clamp(even(n(s.w, d.w)), MIN_W, out.canvasW);
    out.h = clamp(even(n(s.h, d.h)), MIN_H, out.canvasH);
    out.x = clamp(even(n(s.x, Math.round((out.canvasW - out.w) / 2))), 0, out.canvasW - out.w);
    out.y = clamp(even(n(s.y, Math.round((out.canvasH - out.h) / 2))), 0, out.canvasH - out.h);
    return out;
}

function defaultState() {
    return normalise({ canvasW: DEFAULTS.canvasW, canvasH: DEFAULTS.canvasH });
}

/* Applies an adjustment to a state: sizes and offsets from the centre. */
function adjust(state, a) {
    const s = Object.assign({}, state);
    const cx = s.x + s.w / 2, cy = s.y + s.h / 2;
    const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
    const w = clamp(s.w + num(a.dw), MIN_W, s.canvasW);
    const h = clamp(s.h + num(a.dh), MIN_H, s.canvasH);
    /* a resize grows around the centre; a move shifts the centre */
    s.x = cx - w / 2 + num(a.dx);
    s.y = cy - h / 2 + num(a.dy);
    s.w = w;
    s.h = h;
    s.custom = true;
    return normalise(s);
}

function centred(state) {
    return normalise(Object.assign({}, state, { x: Math.round((state.canvasW - state.w) / 2), y: Math.round((state.canvasH - state.h) / 2) }));
}

/* The only arguments ever given to waze-on-cluster. */
function argsFor(state) {
    const parts = [];
    if (state.target === 'hud') {
        parts.push('-s target=hud');
        if (state.custom) {
            parts.push(`-s map_rect=${state.x},${state.y},${state.w},${state.h}`);
        }
    }
    return parts.join(' ');
}

function writeAtomic(file, data) {
    const tmp = `${file}.tmp`;
    const fd = fs.openSync(tmp, 'w', 0o644);
    try {
        fs.writeSync(fd, data);
        fs.fsyncSync(fd);
    } finally {
        fs.closeSync(fd);
    }
    fs.renameSync(tmp, file);
}

function loadSaved() {
    try {
        const j = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
        if (j && j.state) {
            const state = normalise(j.state);
            return { state, applied: j.applied ? normalise(j.applied) : state };
        }
        const bare = normalise(j);
        return { state: bare, applied: bare };
    } catch (e) {
        const d = defaultState();
        return { state: d, applied: d };
    }
}

function gidOf(group) {
    try {
        const line = fs.readFileSync('/etc/group', 'utf8').split('\n').find((l) => l.split(':')[0] === group);
        return line ? Number(line.split(':')[2]) : null;
    } catch (e) {
        return null;
    }
}

/* systemctl, never throwing: a failure to even start it is an error result. */
function systemctl(args, timeout, cb) {
    try {
        cp.execFile(SYSTEMCTL, args, { timeout }, cb);
    } catch (e) {
        setImmediate(() => cb(e, ''));
    }
}

﻿class Daemon {
    constructor() {
        const saved = loadSaved();
        this.state = saved.state;            /* what the user is setting */
        this.applied = saved.applied;        /* what waze-on-cluster was last started with */
        this.clients = new Set();
        this.restarting = false;
        this.lastApply = 0;
        this.note = '';
    }

    pending() {
        return argsFor(this.state) !== argsFor(this.applied);
    }

    saveState() {
        mkdirp(STATE_DIR, 0o755);
        writeAtomic(STATE_FILE, `${JSON.stringify({ state: this.state, applied: this.applied }, null, 2)}\n`);
    }

    /* args.env always holds what was applied, so a boot starts waze-on-cluster with it. */
    writeArgs() {
        writeAtomic(ENV_FILE, `MGUX_HUD_ARGS=${argsFor(this.applied)}\n`);
    }

    view() {
        const s = this.state;
        return { ev: 'state', target: s.target, custom: s.custom, w: s.w, h: s.h, x: s.x, y: s.y,
            canvasW: s.canvasW, canvasH: s.canvasH,
            pct: Math.round(100 * s.w / s.canvasW),
            dx: Math.round(s.x + s.w / 2 - s.canvasW / 2), dy: Math.round(s.y + s.h / 2 - s.canvasH / 2),
            pending: this.pending(), appliedTarget: this.applied.target,
            restarting: this.restarting, note: this.note };
    }

    broadcast() {
        const line = `${JSON.stringify(this.view())}\n`;
        this.clients.forEach((c) => { try { c.write(line); } catch (e) { /* closed */ } });
    }

    handle(msg) {
        this.note = '';
        switch (msg.cmd) {
        case 'get':
            return;
        case 'set':
            if (msg.target === 'hud' || msg.target === 'map') {
                this.state = normalise(Object.assign({}, this.state, { target: msg.target }));
                this.changed();
            }
            return;
        case 'adjust':
            this.state = adjust(this.state, msg);
            this.changed();
            return;
        case 'centre':
            this.state = centred(this.state);
            this.state.custom = true;
            this.changed();
            return;
        case 'reset':
            this.state = normalise(Object.assign({}, defaultState(), { target: this.state.target }));
            this.changed();
            return;
        case 'revert':
            this.state = normalise(this.applied);
            this.changed();
            return;
        case 'apply':
            this.apply();
            return;
        default:
            this.note = 'unknown command';
        }
    }

    changed() {
        try {
            this.saveState();
        } catch (e) {
            this.note = `cannot save: ${e.message}`;
        }
    }

    /* One restart of waze-on-cluster with the pending state. It cuts CarPlay's
     * cluster stream, so the app asks for it once, and not again within APPLY_GAP_MS. */
    apply() {
        if (this.restarting) {
            this.note = 'already applying';
            return;
        }
        if (!this.pending()) {
            this.note = 'nothing to apply';
            return;
        }
        const wait = this.lastApply + APPLY_GAP_MS - Date.now();
        if (wait > 0) {
            this.note = `wait ${Math.ceil(wait / 1000)} s before applying again`;
            return;
        }
        const previous = this.applied;
        this.applied = normalise(this.state);
        try {
            this.saveState();
            this.writeArgs();
        } catch (e) {
            this.applied = previous;
            this.note = `cannot save: ${e.message}`;
            return;
        }
        this.lastApply = Date.now();
        this.restarting = true;
        this.broadcast();
        systemctl(['restart', UNIT], 30000, (err) => {
            if (err) {
                this.fail(previous, `restart failed: ${err.message}`);
                return;
            }
            this.waitActive(0, previous);
        });
    }

    /* Polls until the service is active, or START_WAIT_MS has passed (then back to the previous arguments). */
    waitActive(elapsed, previous) {
        systemctl(['is-active', UNIT], 5000, (err, out) => {
            if (!err && String(out).trim() === 'active') {
                this.restarting = false;
                this.note = 'applied - if the map does not return in about 20 s, reconnect CarPlay';
                this.broadcast();
            } else if (elapsed < START_WAIT_MS) {
                setTimeout(() => this.waitActive(elapsed + 1000, previous), 1000);
            } else {
                this.fail(previous, 'the new setting did not start; the previous one was restored');
            }
        });
    }

    /* The new arguments did not start waze-on-cluster: the previous ones again, once. */
    fail(previous, note) {
        this.applied = previous;
        this.state = normalise(previous);
        try {
            this.saveState();
            this.writeArgs();
        } catch (e) { /* the note below still tells */ }
        systemctl(['restart', UNIT], 30000, () => {
            this.restarting = false;
            this.note = note;
            this.broadcast();
        });
    }

    listen() {
        mkdirp(path.dirname(SOCK), 0o755);
        try { fs.unlinkSync(SOCK); } catch (e) { /* none */ }
        const server = net.createServer((c) => {
            this.clients.add(c);
            c.setEncoding('utf8');
            let buf = '';
            c.on('data', (d) => {
                buf += d;
                if (buf.length > 4096 && buf.indexOf('\n') < 0) { buf = ''; }
                let i;
                while ((i = buf.indexOf('\n')) >= 0) {
                    const line = buf.slice(0, i);
                    buf = buf.slice(i + 1);
                    try { this.handle(JSON.parse(line)); } catch (e) { this.note = 'bad command'; }
                    c.write(`${JSON.stringify(this.view())}\n`);
                }
            });
            c.on('close', () => this.clients.delete(c));
            c.on('error', () => this.clients.delete(c));
            c.write(`${JSON.stringify(this.view())}\n`);
        });
        server.on('error', (e) => { console.error(`hudctl: ${e.message}`); setTimeout(() => this.listen(), 3000); });
        server.listen(SOCK, () => {
            const gid = gidOf('tm_oap_app');
            try {
                if (gid !== null) { fs.chownSync(SOCK, 0, gid); }
                fs.chmodSync(SOCK, 0o660);
            } catch (e) { console.error(`hudctl: socket permissions: ${e.message}`); }
            console.log(`hudctl: listening on ${SOCK}`);
        });
    }

    start() {
        try { this.saveState(); this.writeArgs(); } catch (e) { console.error(`hudctl: ${e.message}`); }
        this.listen();
    }
}
if (require.main === module) {
    process.on('uncaughtException', (e) => console.error(`hudctl: ${e && e.stack}`));
    process.on('unhandledRejection', (e) => console.error(`hudctl: ${e}`));
    new Daemon().start();
}

module.exports = { normalise, adjust, centred, argsFor, defaultState, Daemon, DEFAULTS, loadSaved };