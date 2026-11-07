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
 *   {"cmd":"set","mode":"follow"|"map"|"hud"|"both"}   (follow: waze-on-cluster's own app chooses; else the helper asks
 *   waze-on-cluster 0.9.0 for the cluster's map, the HUD's or both, and again if its app or a restart changes it)
 *   {"cmd":"adjust","which":"hud"|"map","dw":px,"dh":px,"dx":px,"dy":px,"dop":0.1,"dz":0.1,"drot":5,"el":px,"er":px,"et":px,"eb":px}  (deltas; dop = brightness 0.1-1, dz = zoom 0.3-3,
 *   drot = degrees, el/er/et/eb = how far the left/right/top/bottom edge moves outward)
 *   {"cmd":"rect","which":"hud"|"map","x":..,"y":..,"w":..,"h":..,"opacity":..,"zoom":..,"rot":..,"fx":..,"fy":..}  (absolute, any subset;
 *   fx/fy = the focus, 0-1: the point of the picture the zoom keeps in the middle; adjust takes dfx/dfy;
 *   fe = the HUD map's soft edges, 0-0.45 of its shorter side; adjust takes dfe)
 *   {"cmd":"centre","which":...}   {"cmd":"reset","which":...|"all"}
 * and gets {"ev":"state",...} after every command. Settings are kept in
 * /var/opt/mgux-hud/state.json and survive a head-unit restart.
 * Node 8 compatible; the process never exits on an error.
 */
'use strict';

const fs = require('fs');
const net = require('net');
const path = require('path');
const cp = require('child_process');
const { RenderProxy } = require('./renderproxy.js');
const { WazeStatus } = require('./wazestatus.js');
const { WazeControl } = require('./wazecontrol.js');

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
/* its control socket: visited only to send a command (wazecontrol.js), never held */
const WAZE_SOCK = env.HUDCTL_WAZE_SOCK || '/dev/shm/waze-on-cluster/ctl.sock';
/* which of its feeds waze-on-cluster 0.9.0 draws for each mode */
const WAZE_MODE = { map: { cluster: 1, hud: 0 }, hud: { cluster: 0, hud: 1 }, both: { cluster: 1, hud: 1 } };
/* cluster-render's own settings that the units keeps across updates (cluster-render.conf "local_conf") */
const CR_CONF = env.HUDCTL_CR_CONF || '/var/opt/cluster-render/cluster-render.local.conf';
const CR_RESTART = env.HUDCTL_RESTART_CMD || 'systemctl';
const EVA_HOLD_MS = 30000;           /* the EVA cluster app says every 10 s that it shows; without that the HUD comes back */
const SYNC_MS = 4000;                /* waze-on-cluster is looked at this often while its feeds are not as asked */
const RESEND_MS = 3000;              /* the same visit at most this often */
const WIDTH_MS = 600;                /* the HUD size is sent this long after the last change */

/* the targets' pixels (cluster-render.conf: map 1088x480, hud 800x480) */
const CANVAS = { hud: { w: 800, h: 480 }, map: { w: 1088, h: 480 } };
const MIN_W = 40, MIN_H = 20;
const FEATHER_HUD = 0.15, FEATHER_MAX = 0.45;    /* the HUD map's soft edges: default and most */
const MAP_ASPECT = 1088 / 480;
const PANEL_MAP_X = 416, PANEL_MAP_Y = 120;      /* where the map target's 1088x480 sits on the 1920x720 panel (waze-on-cluster: the centred rect) */

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
        return { custom: false, w, h, x: even((c.w - w) / 2), y: even((c.h - h) / 2), opacity: 1, zoom: 1, rot: 0, fx: 0.5, fy: 0.5, fe: FEATHER_HUD, placed: false };
    }
    return { custom: false, w: c.w, h: c.h, x: 0, y: 0, opacity: 1, zoom: 1, rot: 0, fx: 0.5, fy: 0.5, fe: 0, placed: false };
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
        /* the place and size were set here (else, with waze-on-cluster 0.9.0, they are its own app's) */
        placed: src.placed === true,
        opacity: clamp(Math.round(num(src.opacity, 1) * 100) / 100, 0.1, 1),
        zoom: clamp(Math.round(num(src.zoom, 1) * 100) / 100, 0.3, 3),
        rot: wrapDeg(num(src.rot, 0)),
        /* the focus: where in the map's picture the zoom centres (0-1 from the left and the top); CarPlay's
         * cluster map has the car below and right of the middle, so a zoom about the middle pushes it out */
        fx: clamp(Math.round(num(src.fx, 0.5) * 100) / 100, 0, 1),
        fy: clamp(Math.round(num(src.fy, 0.5) * 100) / 100, 0, 1),
        /* soft edges (HUD only): how far in the map fades out at its four sides, as a part of its shorter side */
        fe: which === 'hud' ? clamp(Math.round(num(src.fe, FEATHER_HUD) * 100) / 100, 0, FEATHER_MAX) : 0,
        w, h,
        x: clamp(even(num(src.x, (c.w - w) / 2)), 0, c.w - w),
        y: clamp(even(num(src.y, (c.h - h) / 2)), 0, c.h - h)
    };
}

function defaultState() {
    return { mode: 'follow', hud: defaultRect('hud'), map: defaultRect('map'), evaRects: {} };
}

function normalise(s) {
    const src = s || {};
    return {
        mode: src.mode === 'map' || src.mode === 'hud' || src.mode === 'both' ? src.mode : 'follow',
        hud: normaliseRect('hud', src.hud),
        map: normaliseRect('map', src.map),
        /* what the owner set in the designer while an EVA layout showed its map: per display and layout ("map:eva_comfort_wide") */
        evaRects: normaliseEvaRects(src.evaRects)
    };
}

function normaliseEvaRects(src) {
    const out = {};
    Object.keys(src && typeof src === 'object' ? src : {}).slice(0, 16).forEach((k) => {
        const m = /^(map|hud):[a-z0-9_]{0,40}$/.exec(k);
        if (m) {
            out[k] = normaliseRect(m[1], src[k]);
        }
    });
    return out;
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
    const moved = ['dw', 'dh', 'dx', 'dy', 'el', 'er', 'et', 'eb'].some((k) => num(a[k], 0) !== 0);
    return normaliseRect(which, { custom: true, placed: r.placed === true || moved, opacity: num(r.opacity, 1) + num(a.dop, 0), zoom: num(r.zoom, 1) + num(a.dz, 0), rot: num(r.rot, 0) + num(a.drot, 0), fx: num(r.fx, 0.5) + num(a.dfx, 0), fy: num(r.fy, 0.5) + num(a.dfy, 0), fe: num(r.fe, FEATHER_HUD) + num(a.dfe, 0), w, h, x: cx - w / 2 + num(a.dx, 0), y: cy - h / 2 + num(a.dy, 0) });
}

function centredRect(which, r) {
    const c = CANVAS[which];
    return normaliseRect(which, { custom: true, placed: true, opacity: r.opacity, zoom: r.zoom, rot: r.rot, fx: r.fx, fy: r.fy, fe: r.fe, w: r.w, h: r.h, x: (c.w - r.w) / 2, y: (c.h - r.h) / 2 });
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
    return normalise({ mode: old.target === 'hud' ? 'hud' : 'map',
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
    return { custom: r.custom, placed: r.placed, w: r.w, h: r.h, x: r.x, y: r.y, canvasW: c.w, canvasH: c.h,
        opacity: r.opacity, bright: Math.round(r.opacity * 100), zoom: r.zoom, zoomPct: Math.round(r.zoom * 100), rot: r.rot,
        fx: r.fx, fy: r.fy, focusX: Math.round(r.fx * 100), focusY: Math.round(r.fy * 100),
        fe: r.fe, featherPct: Math.round(r.fe * 100),
        pct: Math.round(100 * r.w / c.w),
        dx: Math.round(r.x + r.w / 2 - c.w / 2), dy: Math.round(r.y + r.h / 2 - c.h / 2),
        defaultW: full };
}


/* `key = value` set in a cluster-render conf's text: the line replaced, else added; same text when it is already so */
function setConfKey(text, key, value) {
    const re = new RegExp(`^[ \\t]*${key}[ \\t]*=.*$`, 'm');
    const line = `${key} = ${value}`;
    if (re.test(text)) {
        return text.replace(re, line);
    }
    return `${text}${text && !text.endsWith('\n') ? '\n' : ''}${line}\n`;
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
        this.wasNative = false;
        this.waze = new WazeStatus({ file: WAZE_STATUS, onChange: () => this.wazeChanged() });
        this.control = new WazeControl({ path: WAZE_SOCK, log: (m) => console.log(m) });
        this.visited = 0;              /* when waze-on-cluster was last asked for its feeds */
        this.widthTimer = null;
        this.sentWidth = null;
        this.proxy = new RenderProxy({
            sock: PROXY_SOCK, upstream: REAL_RENDER, log: (m) => console.log(m),
            getLayout: () => this.layout()
        });
    }

    /* what the proxy builds layers from; the cluster keeps waze's own place until it is customised */
    layout() {
        const s = this.state;
        /* the rectangle an EVA layout asked for, forced to zoom 1 and no turn; or what the owner set for it in the designer (kept whole) */
        const place = (which, over, own) => normaliseRect(which, own ? Object.assign({}, over, { custom: true, placed: true })
            : Object.assign({}, s[which], { custom: true, placed: true, zoom: 1, rot: 0, fx: 0.5, fy: 0.5 }, over));
        const overMap = this.evaRect('panel'), overHud = this.evaRect('hud');
        const map = overMap ? place('map', overMap, this.evaOwn('map')) : (s.map.custom ? s.map : null);
        const hud = overHud ? place('hud', overHud, this.evaOwn('hud')) : s.hud;
        const pm = this.evaPanelMap();
        return { mode: s.mode, hud, map, native: this.waze.native(), hide: this.hideNow(), panelMap: pm };
    }

    /* While an EVA display that asked for it shows (EVA Comfort's map window, the EVA HUD Comfort's middle), the map of that display
     * goes into the rectangle it sent (x, y, w, h in the map target's own 1088x480 pixels for the cluster, the HUD's 800x480 for the HUD),
     * and back to its own place when it stops or goes silent. What the owner sets for it in the designer meanwhile (a move, a size, the zoom,
     * the focus, the brightness) is kept for that layout (state.evaRects) and used in place of the layout's own rectangle. */
    evaHold(which) {
        const h = (this.evaHolds || {})[which === 'map' ? 'panel' : 'hud'];
        return h && h.until > Date.now() && h.mapRect ? h : null;
    }

    evaKey(which) {
        const h = this.evaHold(which);
        return h ? `${which}:${h.layout || ''}` : null;
    }

    evaOwn(which) {
        const k = this.evaKey(which);
        return k && this.state.evaRects[k] ? this.state.evaRects[k] : null;
    }

    evaRect(who) {
        const which = who === 'panel' ? 'map' : 'hud';
        const h = this.evaHold(which);
        return h ? (this.evaOwn(which) || h.mapRect) : null;
    }

    /* the rectangle the designer works on while EVA's holds the display: the owner's, else the layout's */
    evaBase(which) {
        const h = this.evaHold(which);
        if (!h) {
            return null;
        }
        return this.evaOwn(which) || normaliseRect(which, Object.assign({}, this.state[which], { custom: true, placed: true, zoom: 1, rot: 0, fx: 0.5, fy: 0.5 }, h.mapRect));
    }

    /* the designer changed the map of a display an EVA layout holds: kept for that layout, not for the display */
    setEvaRect(which, rect) {
        const k = this.evaKey(which);
        this.state.evaRects[k] = rect;
        this.note = `EVA ${which === 'map' ? 'Comfort' : 'HUD Comfort'}: the change is for its map window (kept for this layout); Centre / Reset puts it back`;
        this.changed();
    }

    resetEvaRect(which) {
        delete this.state.evaRects[this.evaKey(which)];
        this.note = 'EVA: the map window is back as the layout has it';
        this.changed();
    }

    /* EVA Comfort draws the cluster map in the panel's own scene instead of the map slot's (which the BMW cluster shows only in its map
     * view): the rectangle it asked for (the map target's pixels) moved to where the map target sits on the panel (x 416, y 120). */
    evaPanelMap() {
        const h = (this.evaHolds || {}).panel;
        if (!h || h.until <= Date.now() || !h.mapRect || h.panelMap !== true) {
            return null;
        }
        const r = this.evaRect('panel'), own = this.evaOwn('map');
        const out = { x: even(PANEL_MAP_X + r.x), y: even(PANEL_MAP_Y + r.y), w: even(r.w), h: even(r.h) };
        return own ? Object.assign(out, { opacity: own.opacity, zoom: own.zoom, rot: own.rot, fx: own.fx, fy: own.fy }) : out;
    }

    /* ---- waze-on-cluster 0.9.0 and later draws the HUD's map itself, and its own app chooses the cluster, the HUD
     * or both and the HUD map's size and place: while that place is not changed here (the HUD rect is not custom) the
     * HUD map is where waze-on-cluster put it ---- */
    wazeHudPlace() {
        return this.waze.native() ? this.proxy.hudPlace() : null;
    }

    /* the HUD rectangle as shown: waze-on-cluster's place until it is changed here */
    hudRect() {
        const r = this.state.hud, p = this.wazeHudPlace();
        return !r.placed && p ? Object.assign({}, r, p) : r;
    }

    /* a change made here starts from the place waze-on-cluster has it at */
    adoptWazePlace(which) {
        if (which === 'hud' && !this.state.hud.placed && this.wazeHudPlace()) {
            this.state.hud = normaliseRect('hud', Object.assign({}, this.hudRect(), { custom: this.state.hud.custom, placed: false }));
        }
    }

    /* The HUD map's width in percent of the HUD's (20-100): the frame waze-on-cluster scales for the HUD is as wide as the
     * map is shown, or as tall (its shape is the picture's), so a size set here is not stretched up. */
    hudWidthPct() {
        const r = this.state.hud;
        return clamp(Math.round(Math.max(r.w, r.h * MAP_ASPECT) / CANVAS.hud.w * 100), 20, 100);
    }

    /* waze-on-cluster 0.9.0: the feeds the mode asks for, unless "follow" (its own app chooses). A short visit to its
     * control socket; if its app holds the socket (busy) this is asked again at the next look. */
    syncWaze() {
        const want = WAZE_MODE[this.state.mode];
        if (!want || !this.waze.native()) {
            return;
        }
        const st = this.waze.status, cmds = [];
        if (Number(st.cluster) !== want.cluster) {
            cmds.push({ cmd: 'cluster', on: String(want.cluster) });
        }
        if (Number(st.hud) !== want.hud) {
            cmds.push({ cmd: 'hud', on: String(want.hud) });
        }
        if (want.hud && this.state.hud.placed && !this.widthTimer && this.sentWidth !== this.hudWidthPct()) {
            this.widthTimer = setTimeout(() => {
                this.widthTimer = null;
                const pct = this.hudWidthPct();
                if (this.sentWidth !== pct) {
                    this.control.send([{ cmd: 'hud', hud_width_pct: String(pct) }], (r) => { if (r === 'sent') { this.sentWidth = pct; } });
                }
            }, WIDTH_MS);
        }
        if (cmds.length && Date.now() - this.visited >= RESEND_MS) {
            this.visited = Date.now();
            this.control.send(cmds, (r) => {
                if (r === 'sent') {
                    this.sentWidth = null;          /* a feed made new starts at waze-on-cluster's size */
                }
            });
        }
    }

    wazeChanged() {
        this.syncWaze();
        const native = this.waze.native();
        if (native !== this.wasNative) {
            this.wasNative = native;
            try { this.proxy.update(); } catch (e) { this.note = `proxy: ${e.message}`; }
        }
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
        return { ev: 'state', mode: s.mode, hud: rectView('hud', this.evaBase('hud') || this.hudRect()), map: rectView('map', this.evaBase('map') || s.map),
            connections: this.proxy.stats().connections, note: this.note || this.saveError,
            loaded: this.loaded, savedAt: this.savedAt || null, waze: this.waze.summary(),
            eva: { hide: this.hideNow(), map: !!this.evaHold('map'), hud: !!this.evaHold('hud') } };
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
            if (msg.mode === 'follow' || msg.mode === 'hud' || msg.mode === 'map' || msg.mode === 'both') {
                this.state = normalise(Object.assign({}, this.state, { mode: msg.mode }));
                this.changed();
            }
            return;
        case 'adjust':
            if (this.evaHold(which)) {
                this.setEvaRect(which, adjustRect(which, this.evaBase(which), msg));
                return;
            }
            this.adoptWazePlace(which);
            this.state[which] = adjustRect(which, this.state[which], msg);
            this.changed();
            return;
        case 'rect': {
            if (this.evaHold(which)) {
                const cur = this.evaBase(which), next = Object.assign({}, cur, { custom: true, placed: true });
                ['x', 'y', 'w', 'h', 'opacity', 'zoom', 'rot', 'fx', 'fy', 'fe'].forEach((k) => {
                    if (msg[k] !== undefined) {
                        next[k] = num(msg[k], cur[k]);
                    }
                });
                this.setEvaRect(which, normaliseRect(which, next));
                return;
            }
            /* absolute values from the graphical designer: any of x, y, w, h, opacity, zoom, rot */
            if (['x', 'y', 'w', 'h'].some((k) => msg[k] !== undefined)) {
                this.adoptWazePlace(which);
            }
            const cur = this.state[which];
            const next = Object.assign({}, cur, { custom: true, placed: cur.placed || ['x', 'y', 'w', 'h'].some((k) => msg[k] !== undefined) });
            ['x', 'y', 'w', 'h', 'opacity', 'zoom', 'rot', 'fx', 'fy', 'fe'].forEach((k) => {
                if (msg[k] !== undefined) {
                    next[k] = num(msg[k], cur[k]);
                }
            });
            this.state[which] = normaliseRect(which, next);
            this.changed();
            return;
        }
        case 'centre':
            if (this.evaHold(which)) {
                this.resetEvaRect(which);
                return;
            }
            this.adoptWazePlace(which);
            this.state[which] = centredRect(which, this.state[which]);
            this.changed();
            return;
        case 'reset':
            if ((msg.which === 'hud' || msg.which === 'map') && this.evaHold(msg.which)) {
                this.resetEvaRect(msg.which);
                return;
            }
            if (msg.which === 'hud' || msg.which === 'map') {
                this.state[msg.which] = defaultRect(msg.which);
            } else {
                this.state = Object.assign(defaultState(), { mode: this.state.mode });
            }
            this.changed();
            return;
        case 'evaOn':
            /* an EVA display of the app shows (or stops): who "panel" (the cluster) or "hud" (the windshield). While it shows,
             * the layers of the target named in hide are hidden: the HUD's when the panel shares its scene (and for EVA on the
             * HUD itself), or the cluster map's when the panel has a scene of its own (it uses the map's slot). */
            if (typeof msg.on === 'boolean') {
                const who = msg.who === 'hud' ? 'hud' : 'panel';
                const before = JSON.stringify([this.hideNow(), this.evaRect('panel'), this.evaRect('hud'), this.evaPanelMap()]);
                this.evaHolds = this.evaHolds || {};
                if (msg.on) {
                    const r = msg.mapRect;
                    const ok = r && [r.x, r.y, r.w, r.h].every((v) => Number.isFinite(Number(v))) && r.w >= MIN_W && r.h >= MIN_H;
                    this.evaHolds[who] = { until: Date.now() + EVA_HOLD_MS, hide: msg.hide === 'map' ? 'map' : msg.hide === 'none' ? 'none' : 'hud',
                        mapRect: ok ? { x: Number(r.x), y: Number(r.y), w: Number(r.w), h: Number(r.h) } : null, panelMap: msg.panelMap === true,
                        layout: /^[a-z0-9_]{1,40}$/.test(String(msg.layout)) ? String(msg.layout) : '' };
                } else {
                    delete this.evaHolds[who];
                }
                clearTimeout(this.evaT);
                this.evaT = Object.keys(this.evaHolds).length
                    ? setTimeout(() => { this.evaT = null; try { this.proxy.update(); } catch (e) { /* closing */ } }, EVA_HOLD_MS + 100) : null;
                if (JSON.stringify([this.hideNow(), this.evaRect('panel'), this.evaRect('hud'), this.evaPanelMap()]) !== before) {
                    try { this.proxy.update(); } catch (e) { this.note = `proxy: ${e.message}`; }
                }
            }
            return;
        case 'panelScene':
            if (typeof msg.on === 'boolean') {
                this.panelScene(msg.on);
            }
            return;
        case 'panelTakeOver':
            if (typeof msg.on === 'boolean') {
                this.panelTakeOver(msg.on);
            }
            return;
        default:
            this.note = 'unknown command';
        }
    }

    /* The EVA cluster app asks cluster-render to take the cluster's slot from BMW's own cluster (an M-style coded one
     * claims it again and again in Sport): panel_take_over_stock in cluster-render's local conf. Only when the file
     * is not already so, and then cluster-render is restarted once (it reads its conf at start). */
    panelTakeOver(on) {
        this.crConf('panel_take_over_stock', on ? '1' : '0', !on, 'panel take-over');
    }

    /* The targets whose layers are hidden now for an EVA display (a list), or null: each hold lasts EVA_HOLD_MS from the last word. */
    hideNow() {
        const now = Date.now(), out = [];
        Object.keys(this.evaHolds || {}).forEach((who) => {
            const h = this.evaHolds[who];
            if (h.until > now && h.hide !== 'none' && out.indexOf(h.hide) < 0) {
                out.push(h.hide);
            }
        });
        return out.length ? out.sort() : null;
    }

    /* The EVA cluster app asks for a scene of its own for the panel in cluster-render's local conf: 0x010004f1 (the guide
     * hold's, which is only up while the cluster's map shows, and EVA hides that), so that it shares nothing with the HUD
     * (0x01000400, the default for both) or with the cluster's map (0x010004f0, which a panel using it kept from coming
     * back: the fetch of a scene another target has just used failed on a car, as PenguinDukeYDAuto saw with the HUD).
     * Off puts the default back. */
    panelScene(on) {
        this.crConf('panel_scene_id', on ? '0x010004f1' : '0x01000400', !on, 'panel scene');
    }

    /* A key in cluster-render's local conf, changed only when it is not already so (and, with onlyIfSet, only when it is
     * set at all); then cluster-render is restarted once, as it reads its conf at start. */
    crConf(key, value, onlyIfSet, what) {
        try {
            let text = '';
            try { text = fs.readFileSync(CR_CONF, 'utf8'); } catch (e) { /* none yet */ }
            const has = new RegExp(`^[ \\t]*${key}[ \\t]*=`, 'm').test(text);
            const next = onlyIfSet && !has ? text : setConfKey(text, key, value);
            if (next === text) {
                this.note = `${what} already ${value}`;
                return;
            }
            mkdirp(path.dirname(CR_CONF), 0o755);
            writeAtomic(CR_CONF, next);
            console.log(`hudctl: ${key} = ${value} in ${CR_CONF}; restarting cluster-render`);
            cp.execFile(CR_RESTART, ['restart', 'cluster-render.service'], (err) => {
                if (err) { console.error(`hudctl: restart cluster-render: ${err.message}`); }
            });
            this.note = `${what} ${value}, cluster-render restarted`;
        } catch (e) {
            this.note = `${what}: ${e.message}`;
            console.error(`hudctl: ${this.note}`);
        }
    }

    changed() {
        this.saveSoon();
        this.syncWaze();
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
        this.syncTimer = setInterval(() => this.syncWaze(), SYNC_MS);
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

module.exports = { wrapDeg, loadState, parseState, normalise, normaliseRect, adjustRect, centredRect, defaultRect, defaultState, Daemon, CANVAS, setConfKey };