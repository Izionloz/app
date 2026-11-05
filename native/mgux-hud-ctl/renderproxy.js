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
const HUD = 'hud', MAP = 'map';

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

/* Splits a byte stream into whole messages {type, body, raw}. */
class Splitter {
    constructor(onMessage, onBad) {
        this.buf = Buffer.alloc(0);
        this.onMessage = onMessage;
        this.onBad = onBad;
    }

    push(chunk) {
        this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
        while (this.buf.length >= 5) {
            const len = this.buf.readUInt32LE(0);
            if (len < 1 || len > MAX_MSG) {
                this.onBad(new Error(`bad message length ${len}`));
                this.buf = Buffer.alloc(0);
                return;
            }
            if (this.buf.length < 4 + len) {
                return;
            }
            const raw = this.buf.slice(0, 4 + len);
            this.buf = this.buf.slice(4 + len);
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
            this.pending.forEach((b) => this.up.write(b));
            this.pending = [];
        });
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

    toUp(buf) {
        if (this.closed) {
            return;
        }
        if (this.upReady) {
            this.up.write(buf);
        } else {
            this.pending.push(buf);
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
        const copy = Buffer.from(raw);
        copy.writeUInt32LE(ref, 5);
        this.toUp(copy);
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
            msg.opacity = Math.round((typeof this.cur.opacity === 'number' ? this.cur.opacity : 1) * d.opacity * 1000) / 1000;
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
            const key = `${d.rect ? `${d.rect.x},${d.rect.y},${d.rect.w},${d.rect.h}` : ''}@${d.opacity}z${d.zoom}r${d.rot}`;
            const cur = this.actual[d.ref];
            if (cur && cur.target !== d.target) {
                this.toUp(jsonMsg({ op: 'drop', ref: d.ref }));
                delete this.actual[d.ref];
            }
            if (!this.actual[d.ref]) {
                this.toUp(jsonMsg(this.layerMessage(d)));
                this.actual[d.ref] = { target: d.target, rect: key, opacity: d.opacity };
                if (this.lastFrame) {
                    this.sendFrame(d.ref, this.lastFrame);
                }
            } else if (this.actual[d.ref].rect !== key) {
                /* cluster-render takes a video layer's place from its `layer` message: a changed
                 * rectangle is a drop and a new layer with the last frame replayed, which shows at once */
                this.toUp(jsonMsg({ op: 'drop', ref: d.ref }));
                this.toUp(jsonMsg(this.layerMessage(d)));
                this.actual[d.ref] = { target: d.target, rect: key, opacity: d.opacity };
                if (this.lastFrame) {
                    this.sendFrame(d.ref, this.lastFrame);
                }
            }
        });
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