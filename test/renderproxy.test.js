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
        const layers = r.upMsgs.filter((m) => m.type === 0x4A).map((m) => JSON.parse(m.body.toString())).filter((j) => j.op === 'layer');
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

test('proxy: the whole layout is sent again with the first frame, on a renderer state change and after waze\'s set', async () => {
    const layout = { mode: 'hud', hud: { x: 300, y: 120, w: 240, h: 300, opacity: 1, zoom: 2, rot: 0, fx: 0.6, fy: 0.7 }, map: null };
    const r = await rig(layout);
    try {
        r.waze.write(jsonMsg({ op: 'layer', kind: 'video', ref: 4, target: 'map' }));
        await r.waitUp(1);
        let n = r.upMsgs.length;
        r.waze.write(frameMsg(4, 64, 3));                      /* the first frame: then the layout again */
        await r.waitUp(n + 2);
        let sets = jsonOf(r.upMsgs, n).filter((j) => j.op === 'set');
        assert.strictEqual(sets.length, 1);
        assert.deepStrictEqual([sets[0].x, sets[0].y, sets[0].w, sets[0].h, sets[0].sx], [300, 120, 240, 300, 2]);
        const link = Array.from(r.proxy.links)[0];
        n = r.upMsgs.length;
        r.waze.write(frameMsg(4, 64, 3));                      /* later frames: nothing more */
        await r.waitUp(n + 1);
        assert.strictEqual(jsonOf(r.upMsgs, n).length, 0);
        /* the renderer says the layer changed state: the layout again, once per change */
        n = r.upMsgs.length;
        link.onUp({ type: 0x4A, body: Buffer.from(JSON.stringify({ ev: 'layer', ref: 4, state: 'shown' })), raw: jsonMsg({}) });
        link.onUp({ type: 0x4A, body: Buffer.from(JSON.stringify({ ev: 'layer', ref: 4, state: 'shown' })), raw: jsonMsg({}) });
        await new Promise((res) => setTimeout(res, 300));
        sets = jsonOf(r.upMsgs, n).filter((j) => j.op === 'set');
        assert.strictEqual(sets.length, 1);
        assert.strictEqual(sets[0].h, 300);
        /* waze shows the map: its set goes on, then ours with the whole place */
        n = r.upMsgs.length;
        r.waze.write(jsonMsg({ op: 'set', ref: 4, visible: 1, x: 0, y: 0, w: 1088, h: 480 }));
        await r.waitUp(n + 2);
        sets = jsonOf(r.upMsgs, n);
        assert.deepStrictEqual(sets[0], { op: 'set', ref: 4, visible: 1 });
        assert.deepStrictEqual([sets[1].x, sets[1].y, sets[1].w, sets[1].h], [300, 120, 240, 300]);
    } finally {
        r.close();
    }
});

test('proxy: soft edges are an effect layer above the HUD map that follows it, shows with it and goes with it', async () => {
    const { FX, FEATHER_FS } = require('../native/mgux-hud-ctl/renderproxy.js');
    const layout = { mode: 'hud', hud: { x: 200, y: 100, w: 400, h: 200, opacity: 1, zoom: 1, rot: 0, fx: 0.5, fy: 0.5, fe: 0.2 }, map: null };
    const r = await rig(layout);
    try {
        r.waze.write(jsonMsg({ op: 'layer', kind: 'video', ref: 6, target: 'map', z: 3, visible: 0 }));
        await r.waitUp(3);
        let msgs = jsonOf(r.upMsgs, 0);
        const fxl = msgs.find((j) => j.ref === 6 + FX && j.op === 'layer');
        assert.ok(fxl, 'an effect layer is made');
        assert.deepStrictEqual([fxl.kind, fxl.target, fxl.z, fxl.visible, fxl.x, fxl.y, fxl.w, fxl.h], ['effect', 'hud', 4, 0, 200, 100, 400, 200]);
        assert.strictEqual(fxl.fs, FEATHER_FS);
        /* the fade is 0.2 of the shorter side (200 px = 40 px): 40/400 of the width, 40/200 of the height */
        assert.deepStrictEqual(msgs.find((j) => j.op === 'uniform'), { op: 'uniform', ref: 6 + FX, name: 'u_f', v: '0.1 0.2' });

        /* frames go to the map only */
        let n = r.upMsgs.length;
        r.waze.write(frameMsg(6, 16, 1));
        await r.waitUp(n + 1);
        assert.ok(r.upMsgs.slice(n).filter((m) => m.type === 0x46).every((m) => m.body.readUInt32LE(0) === 6));

        /* waze shows the map: the edges show too */
        n = r.upMsgs.length;
        r.waze.write(jsonMsg({ op: 'set', ref: 6, visible: 1 }));
        await r.waitUp(n + 2);
        assert.ok(jsonOf(r.upMsgs, n).some((j) => j.ref === 6 + FX && j.op === 'set' && j.visible === 1));

        /* the map zoomed and turned: the edges get the same scale, turn and pivot, so they stay on the map's own edge */
        n = r.upMsgs.length;
        const link0 = Array.from(r.proxy.links)[0];
        layout.hud = Object.assign({}, layout.hud, { zoom: 2, rot: 15, fx: 0.75, fy: 0.7 });
        link0.reconcile();
        await r.waitUp(n + 2);
        const mapSet = jsonOf(r.upMsgs, n).find((j) => j.ref === 6 && j.op === 'set');
        const fxSet = jsonOf(r.upMsgs, n).find((j) => j.ref === 6 + FX && j.op === 'set');
        assert.ok(mapSet && fxSet);
        ['sx', 'sy', 'rotate', 'px', 'py'].forEach((k) => assert.strictEqual(fxSet[k], mapSet[k], `the edges have the map's ${k}`));
        assert.deepStrictEqual([fxSet.sx, fxSet.rotate], [2, 15]);
        layout.hud = Object.assign({}, layout.hud, { zoom: 1, rot: 0, fx: 0.5, fy: 0.5 });
        link0.reconcile();
        await new Promise((res) => setTimeout(res, 100));

        /* a move moves the edges; a softer edge is a uniform, not a new layer */
        const link = Array.from(r.proxy.links)[0];
        n = r.upMsgs.length;
        layout.hud = Object.assign({}, layout.hud, { x: 240, fe: 0.1 });
        link.reconcile();
        await r.waitUp(n + 3);
        msgs = jsonOf(r.upMsgs, n);
        assert.ok(msgs.some((j) => j.ref === 6 + FX && j.op === 'set' && j.x === 240));
        assert.ok(msgs.some((j) => j.ref === 6 + FX && j.op === 'uniform' && j.v === '0.05 0.1'));
        assert.ok(!msgs.some((j) => j.ref === 6 + FX && (j.op === 'layer' || j.op === 'drop')));

        /* no soft edges, or the map off the HUD: the effect layer is dropped */
        n = r.upMsgs.length;
        layout.hud = Object.assign({}, layout.hud, { fe: 0 });
        link.reconcile();
        await r.waitUp(n + 1);
        assert.ok(jsonOf(r.upMsgs, n).some((j) => j.ref === 6 + FX && j.op === 'drop'));
        assert.deepStrictEqual(link.fx, {});
    } finally {
        r.close();
    }
});

test('proxy: with waze-on-cluster 0.9.0 its HUD layer keeps its place until one is set here; nothing is copied', async () => {
    const { FX } = require('../native/mgux-hud-ctl/renderproxy.js');
    const layout = { mode: 'both', native: true,
        hud: { x: 150, y: 90, w: 300, h: 150, opacity: 1, zoom: 2, rot: 0, fx: 0.5, fy: 0.5, fe: 0.2, placed: false },
        map: { x: 10, y: 20, w: 900, h: 400, opacity: 1, zoom: 1, rot: 0, fx: 0.5, fy: 0.5, fe: 0, custom: true, placed: true } };
    const hudRig = await rig(layout);
    const mapRig = await rig(layout);
    try {
        /* the HUD feed: its own connection, the frame already scaled (vw x vh), placed by waze-on-cluster's app */
        hudRig.waze.write(jsonMsg({ op: 'layer', kind: 'video', ref: 2, target: 'hud', x: 200, y: 140, w: 400, h: 176, vw: 400, vh: 176 }));
        hudRig.waze.write(frameMsg(2, 64, 5));
        await hudRig.waitUp(4);
        let msgs = jsonOf(hudRig.upMsgs, 0);
        const layers = msgs.filter((j) => j.op === 'layer' && j.kind === 'video');
        assert.strictEqual(layers.length, 1, 'one video layer, no copy for another display');
        assert.deepStrictEqual([layers[0].ref, layers[0].target, layers[0].x, layers[0].y, layers[0].w, layers[0].h, layers[0].vw],
            [2, 'hud', 200, 140, 400, 176, 400], 'its own place');
        assert.deepStrictEqual([layers[0].sx, layers[0].px, layers[0].py], [2, 200, 88], 'our zoom about the middle of waze\'s size');
        assert.ok(hudRig.upMsgs.filter((m) => m.type === 0x46).every((m) => m.body.readUInt32LE(0) === 2));
        const fx = msgs.find((j) => j.op === 'layer' && j.ref === 2 + FX);
        assert.deepStrictEqual([fx.x, fx.y, fx.w, fx.h], [200, 140, 400, 176], 'the soft edges are where waze put the map');
        const link = Array.from(hudRig.proxy.links)[0];
        assert.deepStrictEqual(hudRig.proxy.hudPlace(), { x: 200, y: 140, w: 400, h: 176 });

        /* its app moves the HUD map (a set with the new place): it goes on, and the soft edges follow */
        let n = hudRig.upMsgs.length;
        hudRig.waze.write(jsonMsg({ op: 'set', ref: 2, x: 220, y: 150, w: 400, h: 176 }));
        await hudRig.waitUp(n + 3);
        msgs = jsonOf(hudRig.upMsgs, n);
        const moved = msgs.filter((j) => j.op === 'set' && j.ref === 2 && j.x !== undefined);
        assert.ok(moved.length >= 1);
        assert.deepStrictEqual([moved[0].x, moved[0].y], [220, 150]);
        assert.ok(msgs.some((j) => j.op === 'set' && j.ref === 2 + FX && j.x === 220 && j.y === 150));
        assert.deepStrictEqual(hudRig.proxy.hudPlace(), { x: 220, y: 150, w: 400, h: 176 });

        /* a place set here takes over: our rect, and waze's moves are not passed on */
        n = hudRig.upMsgs.length;
        layout.hud = Object.assign({}, layout.hud, { placed: true });
        link.reconcile();
        await hudRig.waitUp(n + 3);
        assert.ok(jsonOf(hudRig.upMsgs, n).some((j) => (j.op === 'layer' || j.op === 'set') && j.ref === 2 && j.x === 150 && j.y === 90 && j.w === 300));
        n = hudRig.upMsgs.length;
        hudRig.waze.write(jsonMsg({ op: 'set', ref: 2, x: 500, y: 300, visible: 1 }));
        await hudRig.waitUp(n + 2);
        const after = jsonOf(hudRig.upMsgs, n).filter((j) => j.op === 'set' && j.ref === 2);
        assert.ok(after.length >= 1);
        assert.ok(after.every((j) => j.x === undefined || j.x === 150), 'waze\'s x is not passed on');
        assert.ok(after.some((j) => j.visible === 1));

        /* the cluster feed, on its own connection: placed as the cluster map is, not copied to the HUD */
        mapRig.waze.write(jsonMsg({ op: 'layer', kind: 'video', ref: 1, target: 'map' }));
        await mapRig.waitUp(1);
        const m = jsonOf(mapRig.upMsgs, 0).filter((j) => j.op === 'layer');
        assert.strictEqual(m.length, 1);
        assert.deepStrictEqual([m[0].target, m[0].x, m[0].y, m[0].w, m[0].h], ['map', 10, 20, 900, 400]);

        /* the layout turning to an older waze-on-cluster (no HUD feed of its own) goes back to copying */
        layout.native = false;
        Array.from(mapRig.proxy.links)[0].reconcile();
        await mapRig.waitUp(4);
        assert.ok(jsonOf(mapRig.upMsgs, 0).some((j) => j.op === 'layer' && j.ref === 1 + DUP && j.target === 'hud'));
    } finally {
        hudRig.close();
        mapRig.close();
    }
});

test('proxy: while the EVA cluster shows, the HUD map and its soft edges are hidden, and shown again after; the cluster map is left alone', async () => {
    const { FX } = require('../native/mgux-hud-ctl/renderproxy.js');
    const layout = { mode: 'hud', native: true, hideHud: true,
        hud: { x: 150, y: 90, w: 300, h: 150, opacity: 1, zoom: 1, rot: 0, fx: 0.5, fy: 0.5, fe: 0.2, placed: false },
        map: null };
    const r = await rig(layout);
    const m = await rig(layout);
    try {
        r.waze.write(jsonMsg({ op: 'layer', kind: 'video', ref: 2, target: 'hud', x: 200, y: 140, w: 400, h: 176, vw: 400, vh: 176, visible: 1 }));
        r.waze.write(frameMsg(2, 64, 5));
        await r.waitUp(4);
        let msgs = jsonOf(r.upMsgs, 0);
        assert.strictEqual(msgs.find((j) => j.op === 'layer' && j.ref === 2).visible, 0, 'the HUD layer is made hidden');
        assert.strictEqual(msgs.find((j) => j.op === 'layer' && j.ref === 2 + FX).visible, 0, 'and so are its soft edges');
        /* waze shows its map (a set with visible 1): it stays hidden */
        let n = r.upMsgs.length;
        r.waze.write(jsonMsg({ op: 'set', ref: 2, visible: 1 }));
        await r.waitUp(n + 2);
        const sets = jsonOf(r.upMsgs, n).filter((j) => j.op === 'set' && j.visible !== undefined);
        assert.ok(sets.length >= 1 && sets.every((j) => j.visible === 0), 'waze\'s visible 1 is not passed on');
        /* EVA goes: both are shown again */
        n = r.upMsgs.length;
        layout.hideHud = false;
        r.proxy.apply();
        await r.waitUp(n + 2);
        msgs = jsonOf(r.upMsgs, n);
        assert.ok(msgs.some((j) => j.op === 'set' && j.ref === 2 && j.visible === 1));
        assert.ok(msgs.some((j) => j.op === 'set' && j.ref === 2 + FX && j.visible === 1));
        /* the cluster's map is not a HUD layer */
        layout.hideHud = true;
        m.waze.write(jsonMsg({ op: 'layer', kind: 'video', ref: 1, target: 'map', visible: 1 }));
        await m.waitUp(1);
        assert.strictEqual(jsonOf(m.upMsgs, 0).find((j) => j.op === 'layer' && j.ref === 1).visible, 1);
    } finally {
        r.close();
        m.close();
    }
});
