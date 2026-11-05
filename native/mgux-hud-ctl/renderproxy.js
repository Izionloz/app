// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * renderproxy - sits between waze-on-cluster and cluster-render so the map's
 * display and rectangle can change while the map runs (no restart, so CarPlay's
 * stream is never cut), and so the same map can be on the cluster and the HUD
 * at once.
 *
 * waze-on-cluster is started with render_socket = the proxy's socket. The
 * proxy speaks cluster-render's protocol (PROTOCOL.md: u32 length LE | u8 type |
 * body; J = JSON, F = frame, M = mesh) to both sides and passes every message
 * through unchanged except for the map's video layer:
 *   - waze's `layer` for its video layer is not forwarded as it is: the proxy
 *     creates the layer(s) itself, on the target(s) and in the rectangle(s) the
 *     settings ask for (mode map | hud | both), and drops/re-creates them when
 *     the settings change; a rectangle change is a `set`;
 *   - waze's `set` for that layer keeps its fields except x, y, w, h;
 *   - every frame (F) for that layer is sent to each of its layers, the last
 *     one is kept and replayed into a layer made later;
 *   - `drop` drops all of them; events about the extra layer are not passed on.
 * Node 8 compatible.
 */
'use strict';

const net = require('net');
const fs = require('fs');

const DUP = 1000000;                 /* the second layer's ref = the map's ref + DUP */
const MAX_MSG = 5529664 + 64;
const HIGH_WATER = 2 * MAX_MSG;      /* bytes queued for cluster-render before waze is paused */
const HUD = 'hud', MAP = 'map';
/* HUDCTL_LIVE_SET=1: a moved, resized, zoomed or turned layer gets a `set` with its new place instead of
 * being dropped and made again. Off by default until cluster-render is seen to take x/y/w/h, sx/sy and
 * rotate in a `set` (it takes opacity, which is always sent as a `set`). */
const LIVE_SET = process.env.HUDCTL_LIVE_SET === '1';

/* the layer's brightness: a display's opacity setting, 1 when it has none */
function opacityOf(rect) {
    return rect && typeof rect.opacity === 'number' ? rect.opacity : 1;
}

function zoomOf(rect) {
    return rect && typeof rect.zoom === 'number' ? rect.zoom : 1;
}

function rotOf(rect) {
    return rect && typeof rect.rot === 'number' ? rect.rot : 0;
}

function frame(type, bodyBuf) {
    const head = Buffer.alloc(5);
    head.writeUInt32LE(bodyBuf.length + 1, 0);
    head.writeUInt8(type, 4);
    return Buffer.concat([head, bodyBuf]);
}

function jsonMsg(obj) {
    return frame(0x4A, Buffer.from(JSON.stringify(obj), 'utf8'));
}

/* Splits a byte stream into whole messages {type, body, raw}. A frame of several MB comes in many
 * socket chunks: they are kept in a list and joined once the whole message is there, not re-copied
 * on every chunk. */
class Splitter {
    constructor(onMessage, onBad) {
        this.chunks = [];
        this.len = 0;                      /* bytes held in chunks */
        this.need = 0;                     /* bytes of the message being collected, 0 = header not read yet */
        this.onMessage = onMessage;
        this.onBad = onBad;
    }

    /* the first n bytes held, as one buffer (the chunk list then starts with it) */
    head(n) {
        if (this.chunks[0].length < n) {
            this.chunks = [Buffer.concat(this.chunks, this.len)];
        }
        return this.chunks[0];
    }

    push(chunk) {
        if (!chunk.length) {
            return;
        }
        this.chunks.push(chunk);
        this.len += chunk.length;
        while (this.len >= 5) {
            if (!this.need) {
                const len = this.head(5).readUInt32LE(0);
                if (len < 1 || len > MAX_MSG) {
                    this.chunks = [];
                    this.len = 0;
                    this.onBad(new Error(`bad message length ${len}`));
                    return;
                }
                this.need = 4 + len;
            }
            if (this.len < this.need) {
                return;
            }
            const buf = this.head(this.need);
            const raw = buf.slice(0, this.need);
            const rest = buf.slice(this.need);
            this.chunks.shift();
            if (rest.length) {
                this.chunks.unshift(rest);
            }
            this.len -= this.need;
            this.need = 0;
            this.onMessage({ type: raw.readUInt8(4), body: raw.slice(5), raw });
        }
    }
}

class Link {
    /* One waze connection and its upstream. `settings()` gives the wanted layout. */
    constructor(client, upstreamPath, getLayout, log) {
        this.client = client;
        this.getLayout = getLayout;
        this.log = log;
        this.up = net.connect(upstreamPath);
        this.upReady = false;
        this.pending = [];                 /* client bytes before the upstream connected */
        this.pendingBytes = 0;
        this.paused = false;               /* waze's socket is paused until the upstream catches up */
        this.base = null;                  /* waze's layer message for its video layer */
        this.cur = null;                   /* that message plus every later `set` of waze's (visible, opacity, ...) */
        this.ref = null;
        this.actual = {};                  /* ref -> { target, rect: key } */
        this.lastFrame = null;
        this.closed = false;
        this.fromClient = new Splitter((m) => this.onClient(m), (e) => this.fail(e));
        this.fromUp = new Splitter((m) => this.onUp(m), (e) => this.fail(e));
        this.up.on('connect', () => {
            this.upReady = true;
            const queued = this.pending;
            this.pending = [];
            this.pendingBytes = 0;
            queued.forEach((b) => this.toUp(b));
            if (this.paused && this.up.bufferSize < HIGH_WATER) {
                this.resume();
            }
        });
        this.up.on('drain', () => this.resume());
        this.up.on('data', (d) => this.fromUp.push(d));
        this.up.on('error', () => this.close());
        this.up.on('close', () => this.close());
        client.on('data', (d) => this.fromClient.push(d));
        client.on('error', () => this.close());
        client.on('close', () => this.close());
    }

    fail(e) {
        this.log(`renderproxy: ${e.message}`);
        this.close();
    }

    close() {
        if (this.closed) {
            return;
        }
        this.closed = true;
        try { this.client.destroy(); } catch (e) { /* gone */ }
        try { this.up.destroy(); } catch (e) { /* gone */ }
        if (this.onClose) {
            this.onClose(this);
        }
    }

    /* Writes to cluster-render. When it falls behind (a slow upstream, or not connected yet), waze's
     * socket is paused until the upstream drains, so frames do not pile up in memory. */
    toUp(buf) {
        if (this.closed) {
            return;
        }
        if (this.upReady) {
            if (!this.up.write(buf) && this.up.bufferSize >= HIGH_WATER) {
                this.pause();
            }
        } else {
            this.pending.push(buf);
            this.pendingBytes += buf.length;
            if (this.pendingBytes >= HIGH_WATER) {
                this.pause();
            }
        }
    }

    pause() {
        if (!this.paused && !this.closed) {
            this.paused = true;
            this.client.pause();
        }
    }

    resume() {
        if (this.paused && !this.closed) {
            this.paused = false;
            this.client.resume();
        }
    }

    toClient(buf) {
        if (!this.closed) {
            this.client.write(buf);
        }
    }

    /* ---- server -> waze ---- */
    onUp(m) {
        if (m.type === 0x4A) {
            let j = null;
            try { j = JSON.parse(m.body.toString('utf8')); } catch (e) { j = null; }
            if (j && typeof j.ref === 'number' && j.ref >= DUP) {
                return;                               /* the extra layer is ours */
            }
        }
        this.toClient(m.raw);
    }

    /* ---- waze -> server ---- */
    onClient(m) {
        if (m.type === 0x46 && this.ref !== null && m.body.length >= 4 && m.body.readUInt32LE(0) === this.ref) {
            this.lastFrame = m.raw;
            Object.keys(this.actual).forEach((r) => this.sendFrame(Number(r), m.raw));
            return;
        }
        if (m.type !== 0x4A) {
            this.toUp(m.raw);
            return;
        }
        let j = null;
        try { j = JSON.parse(m.body.toString('utf8')); } catch (e) { j = null; }
        if (!j) {
            this.toUp(m.raw);
            return;
        }
        if (j.op === 'layer' && j.kind === 'video') {
            this.base = j;
            this.cur = Object.assign({}, j);
            this.ref = j.ref;
            this.actual = {};
            this.lastFrame = null;
            this.reconcile();
            return;
        }
        if (this.ref !== null && j.ref === this.ref) {
            if (j.op === 'drop') {
                Object.keys(this.actual).forEach((r) => this.toUp(jsonMsg({ op: 'drop', ref: Number(r) })));
                this.actual = {};
                this.base = null;
                this.cur = null;
                this.ref = null;
                this.lastFrame = null;
                return;
            }
            if (j.op === 'set') {
                Object.keys(j).forEach((k) => {
                    if (k !== 'op' && k !== 'ref' && k !== 'x' && k !== 'y' && k !== 'w' && k !== 'h') {
                        this.cur[k] = j[k];
                    }
                });
                const rest = Object.assign({}, j);
                ['x', 'y', 'w', 'h'].forEach((k) => { delete rest[k]; });
                if (Object.keys(rest).length > 2) {   /* op and ref only: nothing left */
                    Object.keys(this.actual).forEach((r) => {
                        const m2 = Object.assign({}, rest, { ref: Number(r) });
                        if (typeof m2.opacity === 'number') {
                            m2.opacity = Math.round(m2.opacity * this.actual[r].opacity * 1000) / 1000;
                        }
                        this.toUp(jsonMsg(m2));
                    });
                }
                return;
            }
        }
        this.toUp(m.raw);
    }

    sendFrame(ref, raw) {
        if (ref === this.ref) {
            this.toUp(raw);
            return;
        }
        /* the same frame for another layer: a new header with that layer's ref, then the same pixels
         * (no copy of the whole frame) */
        const head = Buffer.from(raw.slice(0, 9));
        head.writeUInt32LE(ref, 5);
        this.toUp(head);
        this.toUp(raw.slice(9));
    }

    /* ---- what the layers should be ---- */
    desired() {
        const L = this.getLayout();
        const out = [];
        if (L.mode === HUD) {
            out.push({ ref: this.ref, target: HUD, rect: L.hud, opacity: opacityOf(L.hud), zoom: zoomOf(L.hud), rot: rotOf(L.hud) });
        } else if (L.mode === 'both') {
            out.push({ ref: this.ref, target: MAP, rect: L.map, opacity: opacityOf(L.map), zoom: zoomOf(L.map), rot: rotOf(L.map) });
            out.push({ ref: this.ref + DUP, target: HUD, rect: L.hud, opacity: opacityOf(L.hud), zoom: zoomOf(L.hud), rot: rotOf(L.hud) });
        } else {
            out.push({ ref: this.ref, target: MAP, rect: L.map, opacity: opacityOf(L.map), zoom: zoomOf(L.map), rot: rotOf(L.map) });
        }
        return out;
    }

    layerMessage(d) {
        const msg = Object.assign({}, this.cur, { ref: d.ref, target: d.target });
        /* waze's own place is kept for the target it asked for, until a rectangle is set */
        if (d.rect || d.target !== this.base.target) {
            ['x', 'y', 'w', 'h'].forEach((k) => { delete msg[k]; });
        }
        if (d.rect) {
            msg.x = d.rect.x; msg.y = d.rect.y; msg.w = d.rect.w; msg.h = d.rect.h;
        }
        if (d.zoom !== 1) {
            msg.sx = d.zoom;
            msg.sy = d.zoom;
        }
        if (d.rot !== 0) {
            msg.rotate = d.rot;
        }
        if (d.opacity !== 1) {
            msg.opacity = this.layerOpacity(d);
        }
        return msg;
    }

    /* Brings the real layers to the wanted ones: a changed target is a drop and a new layer
     * (with the last frame replayed), a changed rectangle too. */
    reconcile() {
        if (this.ref === null || !this.base || this.closed) {
            return;
        }
        const want = this.desired();
        const wantRefs = {};
        want.forEach((d) => { wantRefs[d.ref] = true; });
        Object.keys(this.actual).forEach((r) => {
            if (!wantRefs[r]) {
                this.toUp(jsonMsg({ op: 'drop', ref: Number(r) }));
                delete this.actual[r];
            }
        });
        want.forEach((d) => {
            const place = `${d.rect ? `${d.rect.x},${d.rect.y},${d.rect.w},${d.rect.h}` : ''}z${d.zoom}r${d.rot}`;
            const cur = this.actual[d.ref];
            if (cur && cur.target !== d.target) {
                this.toUp(jsonMsg({ op: 'drop', ref: d.ref }));
                delete this.actual[d.ref];
            }
            const was = this.actual[d.ref];
            if (was && was.place === place) {
                if (was.opacity !== d.opacity) {
                    /* only the brightness changed: a `set`, so the map does not blink while the bar moves */
                    this.toUp(jsonMsg({ op: 'set', ref: d.ref, opacity: this.layerOpacity(d) }));
                    was.opacity = d.opacity;
                }
                return;
            }
            if (was && LIVE_SET && was.rect && d.rect) {
                this.toUp(jsonMsg({ op: 'set', ref: d.ref, x: d.rect.x, y: d.rect.y, w: d.rect.w, h: d.rect.h,
                    sx: d.zoom, sy: d.zoom, rotate: d.rot, opacity: this.layerOpacity(d) }));
                this.actual[d.ref] = { target: d.target, place, rect: true, opacity: d.opacity };
                return;
            }
            if (was) {
                /* cluster-render takes a video layer's place from its `layer` message: a changed
                 * rectangle is a drop and a new layer with the last frame replayed, which shows at once */
                this.toUp(jsonMsg({ op: 'drop', ref: d.ref }));
            }
            this.toUp(jsonMsg(this.layerMessage(d)));
            this.actual[d.ref] = { target: d.target, place, rect: !!d.rect, opacity: d.opacity };
            if (this.lastFrame) {
                this.sendFrame(d.ref, this.lastFrame);
            }
        });
    }

    /* the layer's opacity: waze's own (from its `set`s) times the display's brightness setting */
    layerOpacity(d) {
        return Math.round((typeof this.cur.opacity === 'number' ? this.cur.opacity : 1) * d.opacity * 1000) / 1000;
    }

    fullW(target) { return target === HUD ? 800 : 1088; }
    fullH() { return 480; }
}

class RenderProxy {
    constructor(opts) {
        this.sock = opts.sock;
        this.upstream = opts.upstream;
        this.getLayout = opts.getLayout;
        this.log = opts.log || (() => {});
        this.links = new Set();
        this.server = null;
    }

    start(gid) {
        try { fs.unlinkSync(this.sock); } catch (e) { /* none */ }
        this.server = net.createServer((client) => {
            const link = new Link(client, this.upstream, this.getLayout, this.log);
            link.onClose = (l) => this.links.delete(l);
            this.links.add(link);
        });
        this.server.on('error', (e) => this.log(`renderproxy: ${e.message}`));
        this.server.listen(this.sock, () => {
            try {
                if (gid !== null && gid !== undefined) { fs.chownSync(this.sock, 0, gid); }
                fs.chmodSync(this.sock, 0o660);
            } catch (e) { this.log(`renderproxy: socket permissions: ${e.message}`); }
            this.log(`renderproxy: listening on ${this.sock}, upstream ${this.upstream}`);
        });
    }

    /* The layout changed: every connection moves its layers now. */
    update() {
        if (this.timer) {
            return;
        }
        this.timer = setTimeout(() => {
            this.timer = null;
            this.apply();
        }, 80);
    }

    apply() {
        this.links.forEach((l) => { try { l.reconcile(); } catch (e) { this.log(`renderproxy: ${e.message}`); } });
    }

    stats() {
        return { connections: this.links.size };
    }
}

module.exports = { RenderProxy, Splitter, frame, jsonMsg, DUP };