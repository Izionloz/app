// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * hudctl - root helper behind the HUD map app (hud_designer).
 *
 * waze-on-cluster 0.9.0 and later draws the map on the cluster and on the HUD, each as a feed of its own connection and
 * layer (the HUD's with a black background, scaled to its size); its own app chooses which, and the HUD map's size
 * and place. waze-on-cluster is started (drop-in of waze-on-cluster.service, through $MGUX_HUD_ARGS from
 * /var/opt/mgux-hud/args.env) with its render socket pointed at renderproxy.js, which runs in this process: the proxy
 * adds to each feed's layer what waze-on-cluster has not (brightness, zoom with a focus, rotation; on the cluster also
 * the map's place and size) and takes nothing from it. Nothing is sent to waze-on-cluster: its status is read from the
 * file it writes (wazestatus.js).
 *
 * The app talks to /dev/shm/mgux-hud/ctl.sock (group tm_oap_app), newline JSON:
 *   {"cmd":"get"}
 *   {"cmd":"adjust","which":"hud"|"map","dop":0.1,"dz":0.1,"drot":5,"dfx":0.05,"dfy":0.05, ...}  (deltas; dop = brightness
 *   0.1-1, dz = zoom 0.3-3, drot = degrees, dfx/dfy = the zoom focus; for the cluster map also dw, dh, dx, dy, el, er, et, eb:
 *   how far the left/right/top/bottom edge moves outward)
 *   {"cmd":"rect","which":"hud"|"map","opacity":..,"zoom":..,"rot":..,"fx":..,"fy":..}  (absolute, any subset; for the
 *   cluster map also x, y, w, h. fx/fy = the focus, 0-1: the point of the picture the zoom keeps in the middle.
 *   The HUD map's place and size are waze-on-cluster's: they are ignored for "hud".)
 *   {"cmd":"centre","which":"map"}   {"cmd":"reset","which":...|"all"}
 * and gets {"ev":"state",...} after every command. Settings are kept in
 * /var/opt/mgux-hud/state.json and survive a head-unit restart.
 * Node 8 compatible; the process never exits on an error.
 */
'use strict';

const fs = require('fs');
const net = require('net');
const path = require('path');
const { RenderProxy } = require('./renderproxy.js');
const { WazeStatus } = require('./wazestatus.js');

const env = process.env;
const SOCK = env.HUDCTL_SOCK || '/dev/shm/mgux-hud/ctl.sock';
const PROXY_SOCK = env.HUDCTL_PROXY_SOCK || '/dev/shm/mgux-hud/render.sock';
const REAL_RENDER = env.HUDCTL_RENDER || '/dev/shm/cluster-render/render.sock';
const STATE_DIR = env.HUDCTL_STATE_DIR || '/var/opt/mgux-hud';
const STATE_FILE = path.join(STATE_DIR, 'state.json');
const BACKUP_FILE = path.join(STATE_DIR, 'state.json.bak');
const ENV_FILE = path.join(STATE_DIR, 'args.env');
/* waze-on-cluster's status, written every second (read only: its control socket is its own app's) */
const WAZE_STATUS = env.HUDCTL_WAZE_STATUS || '/run/waze-on-cluster/status.json';

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
/* an angle in -180..180: turning past one end comes round from the other (190 -> -170) */
const wrapDeg = (d) => {
    const r = ((Math.round(d) % 360) + 360) % 360;
    return r > 180 ? r - 360 : r;
};
/* a burst of changes (a slider drag) is written to flash once, this long after the last one: short, as the
 * head unit may lose power soon after the car is switched off */
const SAVE_MS = 300;

function defaultRect(which) {
    const c = CANVAS[which];
    if (which === 'hud') {
        const w = 456, h = even(w / MAP_ASPECT);
        return { custom: false, w, h, x: even((c.w - w) / 2), y: even((c.h - h) / 2), opacity: 1, zoom: 1, rot: 0, fx: 0.5, fy: 0.5 };
    }
    return { custom: false, w: c.w, h: c.h, x: 0, y: 0, opacity: 1, zoom: 1, rot: 0, fx: 0.5, fy: 0.5 };
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
        rot: wrapDeg(num(src.rot, 0)),
        /* the focus: where in the map's picture the zoom centres (0-1 from the left and the top); CarPlay's
         * cluster map has the car below and right of the middle, so a zoom about the middle pushes it out */
        fx: clamp(Math.round(num(src.fx, 0.5) * 100) / 100, 0, 1),
        fy: clamp(Math.round(num(src.fy, 0.5) * 100) / 100, 0, 1),
        w, h,
        x: clamp(even(num(src.x, (c.w - w) / 2)), 0, c.w - w),
        y: clamp(even(num(src.y, (c.h - h) / 2)), 0, c.h - h)
    };
}

function defaultState() {
    return { hud: defaultRect('hud'), map: defaultRect('map') };
}

function normalise(s) {
    const src = s || {};
    return {
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
    return normaliseRect(which, { custom: true, opacity: num(r.opacity, 1) + num(a.dop, 0), zoom: num(r.zoom, 1) + num(a.dz, 0), rot: num(r.rot, 0) + num(a.drot, 0), fx: num(r.fx, 0.5) + num(a.dfx, 0), fy: num(r.fy, 0.5) + num(a.dfy, 0), w, h, x: cx - w / 2 + num(a.dx, 0), y: cy - h / 2 + num(a.dy, 0) });
}

/* the fields of an adjust that are not about place or size (the HUD map's are waze-on-cluster's) */
function onlyLook(msg) {
    const out = {};
    Object.keys(msg).forEach((k) => {
        if (['dw', 'dh', 'dx', 'dy', 'el', 'er', 'et', 'eb'].indexOf(k) < 0) {
            out[k] = msg[k];
        }
    });
    return out;
}

function centredRect(which, r) {
    const c = CANVAS[which];
    return normaliseRect(which, { custom: true, opacity: r.opacity, zoom: r.zoom, rot: r.rot, fx: r.fx, fy: r.fy, w: r.w, h: r.h, x: (c.w - r.w) / 2, y: (c.h - r.h) / 2 });
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
    /* the rename is only on flash once the folder is: without this a power cut soon after a change could
     * bring the old settings back at the next start */
    const dfd = fs.openSync(path.dirname(file), 'r');
    try {
        fs.fsyncSync(dfd);
    } finally {
        fs.closeSync(dfd);
    }
}

/* 1.x kept {state: {target, custom, w, h, x, y, ...}, applied}: the HUD part carries over. */
function parseState(text) {
    const j = JSON.parse(text);
    if (j && j.hud && j.map) {
        return normalise(j);
    }
    const old = (j && j.state) || j || {};
    return normalise({
        hud: { custom: old.custom === true, w: old.w, h: old.h, x: old.x, y: old.y } });
}

/* The saved settings, else the backup copy, else the defaults; `from` says which (shown by the apps). */
function loadState() {
    const tried = [];
    for (const [file, from] of [[STATE_FILE, 'saved'], [BACKUP_FILE, 'backup']]) {
        try {
            const state = parseState(fs.readFileSync(file, 'utf8'));
            return { state, from, at: fs.statSync(file).mtime.toISOString() };
        } catch (e) {
            tried.push(`${path.basename(file)}: ${e.code || e.message}`);
        }
    }
    return { state: defaultState(), from: 'defaults', at: null, why: tried.join(', ') };
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
        fx: r.fx, fy: r.fy, focusX: Math.round(r.fx * 100), focusY: Math.round(r.fy * 100),
        pct: Math.round(100 * r.w / c.w),
        dx: Math.round(r.x + r.w / 2 - c.w / 2), dy: Math.round(r.y + r.h / 2 - c.h / 2),
        defaultW: full };
}

class Daemon {
    constructor() {
        const loaded = loadState();
        this.state = loaded.state;
        this.loaded = { from: loaded.from, at: loaded.at };
        console.log(`hudctl: settings from ${loaded.from}${loaded.at ? ` (${loaded.at})` : ''}${loaded.why ? `: ${loaded.why}` : ''}`);
        this.clients = new Set();
        this.note = '';
        this.saveError = '';
        this.saveTimer = null;
        this.waze = new WazeStatus({ file: WAZE_STATUS, onChange: () => this.wazeChanged() });
        this.proxy = new RenderProxy({
            sock: PROXY_SOCK, upstream: REAL_RENDER, log: (m) => console.log(m),
            getLayout: () => this.layout()
        });
    }

    /* what the proxy builds layers from; the cluster keeps waze's own place until it is customised */
    layout() {
        const s = this.state;
        return { hud: s.hud, map: s.map.custom ? s.map : null };
    }

    /* The HUD map as shown: where waze-on-cluster has its layer (its app chooses the size and the place), the look
     * (brightness, zoom, rotation) from here. */
    hudShown() {
        const p = this.proxy.hudPlace();
        return p ? Object.assign({}, this.state.hud, p) : this.state.hud;
    }

    wazeChanged() {
        this.broadcast();
    }

    /* saves SAVE_MS after the last change, so a drag does not write (and fsync) on every step */
    saveSoon() {
        clearTimeout(this.saveTimer);
        this.saveTimer = setTimeout(() => {
            this.saveTimer = null;
            this.save();
        }, SAVE_MS);
    }

    save() {
        clearTimeout(this.saveTimer);
        this.saveTimer = null;
        try {
            mkdirp(STATE_DIR, 0o755);
            const text = `${JSON.stringify(this.state, null, 2)}\n`;
            writeAtomic(STATE_FILE, text);
            writeAtomic(BACKUP_FILE, text);
            this.savedAt = new Date().toISOString();
            if (this.saveError) {
                this.saveError = '';
                this.broadcast();
            }
        } catch (e) {
            /* kept until a save works: the save runs after the command's own answer */
            const was = this.saveError;
            this.saveError = `cannot save: ${e.message}`;
            if (was !== this.saveError) {
                this.broadcast();
            }
        }
    }

    writeArgs() {
        writeAtomic(ENV_FILE, `MGUX_HUD_ARGS=-s render_socket=${PROXY_SOCK}\n`);
    }

    view() {
        const s = this.state;
        return { ev: 'state', hud: rectView('hud', this.hudShown()), map: rectView('map', s.map),
            connections: this.proxy.stats().connections, note: this.note || this.saveError,
            loaded: this.loaded, savedAt: this.savedAt || null, waze: this.waze.summary() };
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
        case 'adjust':
            this.state[which] = adjustRect(which, this.state[which], which === 'hud' ? onlyLook(msg) : msg);
            this.changed();
            return;
        case 'rect': {
            /* absolute values from the graphical designer: any of opacity, zoom, rot, fx, fy and, for the cluster map,
             * x, y, w, h (the HUD map's place and size are waze-on-cluster's) */
            const cur = this.state[which];
            const next = Object.assign({}, cur, { custom: true });
            (which === 'hud' ? ['opacity', 'zoom', 'rot', 'fx', 'fy'] : ['x', 'y', 'w', 'h', 'opacity', 'zoom', 'rot', 'fx', 'fy']).forEach((k) => {
                if (msg[k] !== undefined) {
                    next[k] = num(msg[k], cur[k]);
                }
            });
            this.state[which] = normaliseRect(which, next);
            this.changed();
            return;
        }
        case 'centre':
            if (which === 'map') {
                this.state[which] = centredRect(which, this.state[which]);
                this.changed();
            }
            return;
        case 'reset':
            if (msg.which === 'hud' || msg.which === 'map') {
                this.state[msg.which] = defaultRect(msg.which);
            } else {
                this.state = defaultState();
            }
            this.changed();
            return;
        default:
            this.note = 'unknown command';
        }
    }

    changed() {
        this.saveSoon();
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

    noSavedFiles() {
        return !fs.existsSync(STATE_FILE) && !fs.existsSync(BACKUP_FILE);
    }

    start() {
        try {
            mkdirp(STATE_DIR, 0o755);
            /* the settings file is written now only when that loses nothing: when there was none, or to put the
             * backup back. A file that could not be read is kept as it is until the next change. */
            if (this.loaded.from === 'backup' || (this.loaded.from === 'defaults' && this.noSavedFiles())) {
                this.save();
            }
            this.writeArgs();
        } catch (e) { console.error(`hudctl: ${e.message}`); }
        mkdirp(path.dirname(PROXY_SOCK), 0o755);
        this.proxy.start(gidOf('tm_oap_app'));
        this.waze.open();
        this.listen();
    }
}

if (require.main === module) {
    process.on('uncaughtException', (e) => console.error(`hudctl: ${e && e.stack}`));
    process.on('unhandledRejection', (e) => console.error(`hudctl: ${e}`));
    const daemon = new Daemon();
    /* a pending save is written before systemd stops the helper */
    ['SIGTERM', 'SIGINT'].forEach((sig) => process.on(sig, () => {
        if (daemon.saveTimer) {
            daemon.save();
        }
        process.exit(0);
    }));
    daemon.start();
}

module.exports = { wrapDeg, loadState, parseState, normalise, normaliseRect, adjustRect, centredRect, defaultRect, defaultState, Daemon, CANVAS };