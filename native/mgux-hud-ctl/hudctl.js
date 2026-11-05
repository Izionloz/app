// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * hudctl - root helper behind the HUD map app (mgux_hud_map).
 *
 * waze-on-cluster is started (drop-in of waze-on-cluster.service, through
 * $MGUX_HUD_ARGS from /var/opt/mgux-hud/args.env) with its render socket
 * pointed at renderproxy.js, which runs in this process. The proxy puts the
 * map's layer(s) on the instrument cluster ("map"), the HUD ("hud") or both,
 * in the rectangles kept here, and moves them while the map runs: nothing
 * restarts, so CarPlay's cluster stream is never cut.
 *
 * The app talks to /dev/shm/mgux-hud/ctl.sock (group tm_oap_app), newline JSON:
 *   {"cmd":"get"}
 *   {"cmd":"set","mode":"map"|"hud"|"both"}
 *   {"cmd":"adjust","which":"hud"|"map","dw":px,"dh":px,"dx":px,"dy":px,"dop":0.1,"dz":0.1,"drot":5,"el":px,"er":px,"et":px,"eb":px}  (deltas; dop = brightness 0.1-1, dz = zoom 0.3-3,
 *   drot = degrees, el/er/et/eb = how far the left/right/top/bottom edge moves outward)
 *   {"cmd":"rect","which":"hud"|"map","x":..,"y":..,"w":..,"h":..,"opacity":..,"zoom":..,"rot":..}  (absolute, any subset)
 *   {"cmd":"centre","which":...}   {"cmd":"reset","which":...|"all"}
 * and gets {"ev":"state",...} after every command. Settings are kept in
 * /var/opt/mgux-hud/state.json and survive a head-unit restart.
 * Node 8 compatible; the process never exits on an error.
 */
'use strict';

const fs = require('fs');
const net = require('net');
const path = require('path');
const { RenderProxy } = require('./renderproxy.js');

const env = process.env;
const SOCK = env.HUDCTL_SOCK || '/dev/shm/mgux-hud/ctl.sock';
const PROXY_SOCK = env.HUDCTL_PROXY_SOCK || '/dev/shm/mgux-hud/render.sock';
const REAL_RENDER = env.HUDCTL_RENDER || '/dev/shm/cluster-render/render.sock';
const STATE_DIR = env.HUDCTL_STATE_DIR || '/var/opt/mgux-hud';
const STATE_FILE = path.join(STATE_DIR, 'state.json');
const ENV_FILE = path.join(STATE_DIR, 'args.env');

/* the targets' pixels (cluster-render.conf: map 1088x480, hud 800x480) */
const CANVAS = { hud: { w: 800, h: 480 }, map: { w: 1088, h: 480 } };
const MIN_W = 40, MIN_H = 20;
const MAP_ASPECT = 1088 / 480;

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
const num = (v, def) => (Number.isFinite(Number(v)) ? Number(v) : def);

function defaultRect(which) {
    const c = CANVAS[which];
    if (which === 'hud') {
        const w = 456, h = even(w / MAP_ASPECT);
        return { custom: false, w, h, x: even((c.w - w) / 2), y: even((c.h - h) / 2), opacity: 1, zoom: 1, rot: 0 };
    }
    return { custom: false, w: c.w, h: c.h, x: 0, y: 0, opacity: 1, zoom: 1, rot: 0 };
}

/* A rectangle with valid even integers, inside its canvas. */
function normaliseRect(which, r) {
    const c = CANVAS[which];
    const d = defaultRect(which);
    const src = r || {};
    const w = clamp(even(num(src.w, d.w)), MIN_W, c.w);
    const h = clamp(even(num(src.h, d.h)), MIN_H, c.h);
    return {
        custom: src.custom === true,
        opacity: clamp(Math.round(num(src.opacity, 1) * 100) / 100, 0.1, 1),
        zoom: clamp(Math.round(num(src.zoom, 1) * 100) / 100, 0.3, 3),
        rot: clamp(Math.round(num(src.rot, 0)), -180, 180),
        w, h,
        x: clamp(even(num(src.x, (c.w - w) / 2)), 0, c.w - w),
        y: clamp(even(num(src.y, (c.h - h) / 2)), 0, c.h - h)
    };
}

function defaultState() {
    return { mode: 'map', hud: defaultRect('hud'), map: defaultRect('map') };
}

function normalise(s) {
    const src = s || {};
    return {
        mode: src.mode === 'hud' || src.mode === 'both' ? src.mode : 'map',
        hud: normaliseRect('hud', src.hud),
        map: normaliseRect('map', src.map)
    };
}

/* Resize about the centre by (dw, dh), then move the centre by (dx, dy). */
function adjustRect(which, r0, a) {
    const c = CANVAS[which];
    /* edges first: each moves on its own (left and top also move the origin) */
    const el = num(a.el, 0), er = num(a.er, 0), et = num(a.et, 0), eb = num(a.eb, 0);
    const left = clamp(r0.x - el, 0, c.w - MIN_W), top = clamp(r0.y - et, 0, c.h - MIN_H);
    const right = clamp(r0.x + r0.w + er, left + MIN_W, c.w), bottom = clamp(r0.y + r0.h + eb, top + MIN_H, c.h);
    const r = Object.assign({}, r0, { x: left, y: top, w: right - left, h: bottom - top });
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    const w = clamp(r.w + num(a.dw, 0), MIN_W, c.w);
    const h = clamp(r.h + num(a.dh, 0), MIN_H, c.h);
    return normaliseRect(which, { custom: true, opacity: num(r.opacity, 1) + num(a.dop, 0), zoom: num(r.zoom, 1) + num(a.dz, 0), rot: num(r.rot, 0) + num(a.drot, 0), w, h, x: cx - w / 2 + num(a.dx, 0), y: cy - h / 2 + num(a.dy, 0) });
}

function centredRect(which, r) {
    const c = CANVAS[which];
    return normaliseRect(which, { custom: true, opacity: r.opacity, zoom: r.zoom, rot: r.rot, w: r.w, h: r.h, x: (c.w - r.w) / 2, y: (c.h - r.h) / 2 });
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

/* 1.x kept {state: {target, custom, w, h, x, y, ...}, applied}: the HUD part carries over. */
function loadState() {
    try {
        const j = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
        if (j && j.hud && j.map) {
            return normalise(j);
        }
        const old = (j && j.state) || j || {};
        return normalise({ mode: old.target === 'hud' ? 'hud' : 'map',
            hud: { custom: old.custom === true, w: old.w, h: old.h, x: old.x, y: old.y } });
    } catch (e) {
        return defaultState();
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

function rectView(which, r) {
    const c = CANVAS[which];
    const full = which === 'hud' ? 456 : c.w;
    return { custom: r.custom, w: r.w, h: r.h, x: r.x, y: r.y, canvasW: c.w, canvasH: c.h,
        opacity: r.opacity, bright: Math.round(r.opacity * 100), zoom: r.zoom, zoomPct: Math.round(r.zoom * 100), rot: r.rot,
        pct: Math.round(100 * r.w / c.w),
        dx: Math.round(r.x + r.w / 2 - c.w / 2), dy: Math.round(r.y + r.h / 2 - c.h / 2),
        defaultW: full };
}

class Daemon {
    constructor() {
        this.state = loadState();
        this.clients = new Set();
        this.note = '';
        this.proxy = new RenderProxy({
            sock: PROXY_SOCK, upstream: REAL_RENDER, log: (m) => console.log(m),
            getLayout: () => this.layout()
        });
    }

    /* what the proxy builds layers from; the cluster keeps waze's own place until it is customised */
    layout() {
        const s = this.state;
        return { mode: s.mode, hud: s.hud, map: s.map.custom ? s.map : null };
    }

    save() {
        try {
            mkdirp(STATE_DIR, 0o755);
            writeAtomic(STATE_FILE, `${JSON.stringify(this.state, null, 2)}\n`);
        } catch (e) {
            this.note = `cannot save: ${e.message}`;
        }
    }

    writeArgs() {
        writeAtomic(ENV_FILE, `MGUX_HUD_ARGS=-s render_socket=${PROXY_SOCK}\n`);
    }

    view() {
        const s = this.state;
        return { ev: 'state', mode: s.mode, hud: rectView('hud', s.hud), map: rectView('map', s.map),
            connections: this.proxy.stats().connections, note: this.note };
    }

    broadcast() {
        const line = `${JSON.stringify(this.view())}\n`;
        this.clients.forEach((c) => { try { c.write(line); } catch (e) { /* closed */ } });
    }

    handle(msg) {
        this.note = '';
        const which = msg.which === 'map' ? 'map' : 'hud';
        switch (msg.cmd) {
        case 'get':
            return;
        case 'set':
            if (msg.mode === 'hud' || msg.mode === 'map' || msg.mode === 'both') {
                this.state = normalise(Object.assign({}, this.state, { mode: msg.mode }));
                this.changed();
            }
            return;
        case 'adjust':
            this.state[which] = adjustRect(which, this.state[which], msg);
            this.changed();
            return;
        case 'rect': {
            /* absolute values from the graphical designer: any of x, y, w, h, opacity, zoom, rot */
            const cur = this.state[which];
            const next = Object.assign({}, cur, { custom: true });
            ['x', 'y', 'w', 'h', 'opacity', 'zoom', 'rot'].forEach((k) => {
                if (msg[k] !== undefined) {
                    next[k] = num(msg[k], cur[k]);
                }
            });
            this.state[which] = normaliseRect(which, next);
            this.changed();
            return;
        }
        case 'centre':
            this.state[which] = centredRect(which, this.state[which]);
            this.changed();
            return;
        case 'reset':
            if (msg.which === 'hud' || msg.which === 'map') {
                this.state[msg.which] = defaultRect(msg.which);
            } else {
                this.state = Object.assign(defaultState(), { mode: this.state.mode });
            }
            this.changed();
            return;
        default:
            this.note = 'unknown command';
        }
    }

    changed() {
        this.save();
        try { this.proxy.update(); } catch (e) { this.note = `proxy: ${e.message}`; }
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
                    this.broadcast();
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
        try { mkdirp(STATE_DIR, 0o755); this.save(); this.writeArgs(); } catch (e) { console.error(`hudctl: ${e.message}`); }
        mkdirp(path.dirname(PROXY_SOCK), 0o755);
        this.proxy.start(gidOf('tm_oap_app'));
        this.listen();
    }
}

if (require.main === module) {
    process.on('uncaughtException', (e) => console.error(`hudctl: ${e && e.stack}`));
    process.on('unhandledRejection', (e) => console.error(`hudctl: ${e}`));
    new Daemon().start();
}

module.exports = { normalise, normaliseRect, adjustRect, centredRect, defaultRect, defaultState, Daemon, CANVAS };