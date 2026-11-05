// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { RenderProxy, Splitter, frame, jsonMsg, DUP, pivot } = require('../native/mgux-hud-ctl/renderproxy.js');

function frameMsg(ref, size, fill) {
    const body = Buffer.alloc(4 + size, fill);
    body.writeUInt32LE(ref, 0);
    return frame(0x46, body);
}

function collect() {
    const got = [];
    const errors = [];
    const s = new Splitter((m) => got.push(m), (e) => errors.push(e));
    return { s, got, errors };
}

test('Splitter: whole messages from any chunking', () => {
    const msgs = [jsonMsg({ op: 'a' }), frameMsg(7, 300000, 1), jsonMsg({ op: 'b' }), frameMsg(8, 10, 2)];
    const all = Buffer.concat(msgs);
    for (const size of [1, 3, 5, 7, 4096, 65536, all.length]) {
        const { s, got, errors } = collect();
        for (let o = 0; o < all.length; o += size) {
            s.push(all.slice(o, o + size));
        }
        assert.strictEqual(errors.length, 0);
        assert.strictEqual(got.length, msgs.length, `chunk size ${size}`);
        got.forEach((m, i) => assert.ok(m.raw.equals(msgs[i]), `message ${i}, chunk size ${size}`));
        assert.deepStrictEqual(JSON.parse(got[0].body.toString()), { op: 'a' });
        assert.strictEqual(got[1].type, 0x46);
        assert.strictEqual(got[1].body.readUInt32LE(0), 7);
    }
});

test('Splitter: a bad length is reported and the buffer dropped', () => {
    const { s, got, errors } = collect();
    const bad = Buffer.alloc(8);
    bad.writeUInt32LE(0, 0);
    s.push(bad);
    assert.strictEqual(errors.length, 1);
    assert.strictEqual(got.length, 0);
    s.push(jsonMsg({ op: 'ok' }));
    assert.strictEqual(got.length, 1);
});

test('Splitter: a 5.5 MB frame in 64 KB chunks is not re-copied per chunk', () => {
    const msg = frameMsg(1, 5529600, 0);
    const { s, got } = collect();
    const t = Date.now();
    for (let k = 0; k < 10; k++) {
        for (let o = 0; o < msg.length; o += 65536) {
            s.push(msg.slice(o, o + 65536));
        }
    }
    assert.strictEqual(got.length, 10);
    /* the old splitter took about 70 ms a frame here; joined once it is a few ms */
    assert.ok(Date.now() - t < 400, `took ${Date.now() - t} ms`);
});

/* a fake cluster-render and a fake waze-on-cluster around a real proxy */
function rig(layout) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hudproxy-'));
    const upSock = path.join(dir, 'up.sock');
    const proxySock = path.join(dir, 'proxy.sock');
    const upMsgs = [];
    let onUp = () => {};
    const upServer = net.createServer((c) => {
        const sp = new Splitter((m) => { upMsgs.push(m); onUp(); }, () => {});
        c.on('data', (d) => sp.push(d));
    });
    const proxy = new RenderProxy({ sock: proxySock, upstream: upSock, getLayout: () => layout });
    return new Promise((resolve) => upServer.listen(upSock, () => {
        proxy.start(null);
        proxy.server.on('listening', () => {
            const waze = net.connect(proxySock);
            waze.on('connect', () => resolve({
                waze, proxy, upMsgs,
                waitUp(n) {
                    return new Promise((res) => {
                        onUp = () => { if (upMsgs.length >= n) { res(); } };
                        onUp();
                    });
                },
                close() {
                    waze.destroy();
                    proxy.server.close();
                    upServer.close();
                    fs.rmSync(dir, { recursive: true, force: true });
                }
            }));
        });
    }));
}

test('proxy: mode both makes a cluster and a HUD layer and sends each frame to both', async () => {
    const hud = { x: 100, y: 50, w: 400, h: 176, opacity: 0.5, zoom: 1, rot: 10 };
    const r = await rig({ mode: 'both', hud, map: null });
    try {
        r.waze.write(jsonMsg({ op: 'layer', kind: 'video', ref: 3, target: 'map', x: 0, y: 0, w: 1088, h: 480 }));
        r.waze.write(frameMsg(3, 1000, 9));
        await r.waitUp(4);
        const layers = r.upMsgs.filter((m) => m.type === 0x4A).map((m) => JSON.parse(m.body.toString()));
        assert.strictEqual(layers.length, 2);
        assert.deepStrictEqual(layers.map((l) => [l.ref, l.target]), [[3, 'map'], [3 + DUP, 'hud']]);
        assert.strictEqual(layers[0].w, 1088);
        assert.deepStrictEqual([layers[1].x, layers[1].y, layers[1].w, layers[1].h], [100, 50, 400, 176]);
        assert.strictEqual(layers[1].opacity, 0.5);
        assert.strictEqual(layers[1].rotate, 10);
        const frames = r.upMsgs.filter((m) => m.type === 0x46);
        assert.deepStrictEqual(frames.map((f) => f.body.readUInt32LE(0)).sort(), [3, 3 + DUP].sort());
        frames.forEach((f) => {
            assert.strictEqual(f.body.length, 1004);
            assert.ok(f.body.slice(4).every((b) => b === 9));
        });
    } finally {
        r.close();
    }
});

test('proxy: waze is paused while cluster-render is behind, and resumed when it drains', async () => {
    const r = await rig({ mode: 'map', hud: null, map: null });
    try {
        r.waze.write(jsonMsg({ op: 'layer', kind: 'video', ref: 1, target: 'map' }));
        await r.waitUp(1);
        const link = Array.from(r.proxy.links)[0];
        assert.strictEqual(link.paused, false);
        link.up.write = () => false;          /* a stalled upstream */
        Object.defineProperty(link.up, 'bufferSize', { value: 1e9, configurable: true });
        link.toUp(Buffer.alloc(10));
        assert.strictEqual(link.paused, true);
        link.up.emit('drain');
        assert.strictEqual(link.paused, false);
    } finally {
        r.close();
    }
});

function jsonOf(msgs, from) {
    return msgs.slice(from).filter((m) => m.type === 0x4A).map((m) => JSON.parse(m.body.toString()));
}

test('proxy: a brightness change and a move are a set (no blink); HUDCTL_LIVE_SET=0 re-makes the layer', async () => {
    const layout = { mode: 'hud', hud: { x: 100, y: 50, w: 400, h: 176, opacity: 1, zoom: 1, rot: 0 }, map: null };
    const r = await rig(layout);
    try {
        r.waze.write(jsonMsg({ op: 'layer', kind: 'video', ref: 5, target: 'map', opacity: 0.8 }));
        r.waze.write(frameMsg(5, 100, 1));
        await r.waitUp(2);
        const link = Array.from(r.proxy.links)[0];

        let n = r.upMsgs.length;
        layout.hud = Object.assign({}, layout.hud, { opacity: 0.5 });
        link.reconcile();
        await r.waitUp(n + 1);
        assert.deepStrictEqual(jsonOf(r.upMsgs, n), [{ op: 'set', ref: 5, sx: 1, sy: 1, rotate: 0, px: 200, py: 88, opacity: 0.4 }]);

        /* a move: one set with the new place, no drop (no blink) */
        n = r.upMsgs.length;
        link.reconcile();                      /* nothing changed: nothing sent */
        layout.hud = Object.assign({}, layout.hud, { x: 120 });
        link.reconcile();
        await r.waitUp(n + 1);
        let sent = jsonOf(r.upMsgs, n);
        assert.deepStrictEqual(sent.map((j) => j.op), ['set']);
        assert.deepStrictEqual([sent[0].x, sent[0].y, sent[0].w, sent[0].h, sent[0].opacity], [120, 50, 400, 176, 0.4]);

        /* HUDCTL_LIVE_SET=0: a drop and a new layer with the last frame replayed */
        process.env.HUDCTL_LIVE_SET = '0';
        n = r.upMsgs.length;
        layout.hud = Object.assign({}, layout.hud, { x: 140 });
        link.reconcile();
        await r.waitUp(n + 3);
        sent = jsonOf(r.upMsgs, n);
        assert.deepStrictEqual(sent.map((j) => j.op), ['drop', 'layer']);
        assert.strictEqual(sent[1].x, 140);
        assert.strictEqual(r.upMsgs[r.upMsgs.length - 1].type, 0x46, 'the last frame is replayed');
    } finally {
        delete process.env.HUDCTL_LIVE_SET;
        r.close();
    }
});

test('pivot: the focus shows in the middle when it can, and the zoomed picture still fills the rect', () => {
    assert.strictEqual(pivot(1, 0.8), 0.5);
    assert.strictEqual(pivot(2, 0.5), 0.5);
    /* focus 0.67 at zoom 2.05: p = (2.05 * 0.67 - 0.5) / 1.05 */
    const p = pivot(2.05, 0.67);
    assert.ok(Math.abs(p + 2.05 * (0.67 - p) - 0.5) < 1e-9, 'the focus lands in the middle');
    assert.strictEqual(pivot(1.2, 0.95), 1, 'held to the rect');
    assert.strictEqual(pivot(1.2, 0.05), 0);
});

test('proxy: zoom, turn and focus are a set with the pivot, not a new layer', async () => {
    const layout = { mode: 'hud', hud: { x: 0, y: 0, w: 400, h: 200, opacity: 1, zoom: 1, rot: 0, fx: 0.5, fy: 0.5 }, map: null };
    const r = await rig(layout);
    try {
        r.waze.write(jsonMsg({ op: 'layer', kind: 'video', ref: 2, target: 'map' }));
        await r.waitUp(1);
        const first = jsonOf(r.upMsgs, 0)[0];
        assert.deepStrictEqual([first.px, first.py, first.sx], [200, 100, 1]);
        const link = Array.from(r.proxy.links)[0];
        const n = r.upMsgs.length;
        layout.hud = Object.assign({}, layout.hud, { zoom: 2, fx: 0.75, fy: 0.7, rot: 15 });
        link.reconcile();
        await r.waitUp(n + 1);
        const sent = jsonOf(r.upMsgs, n);
        assert.strictEqual(sent.length, 1);
        assert.strictEqual(sent[0].op, 'set');
        /* zoom 2, focus 0.75 -> pivot 1 (w 400), focus 0.7 -> pivot 0.9 (h 200) */
        assert.deepStrictEqual([sent[0].sx, sent[0].sy, sent[0].rotate, sent[0].px, sent[0].py], [2, 2, 15, 400, 180]);
    } finally {
        r.close();
    }
});
