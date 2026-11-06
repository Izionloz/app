// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { WazeControl } = require('../native/mgux-hud-ctl/wazecontrol.js');

/* a waze-on-cluster: the first visitor is the owner and gets a status, a second is told busy and closed */
async function fakeWaze(opts) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wc-'));
    const sock = path.join(dir, 'ctl.sock');
    const got = [];
    let owner = null, ownerGone = 0, visits = 0;
    const srv = net.createServer((c) => {
        visits++;
        c.setEncoding('utf8');
        if (owner || (opts && opts.busy)) {
            c.write('{"ev":"status","state":"error","target":null,"page":null,"reason":"busy"}\n');
            c.end();
            return;
        }
        owner = c;
        c.write('{"ev":"status","state":"showing","cluster":1,"hud":0,"hud_state":"off"}\n');
        c.on('data', (d) => d.split('\n').filter(Boolean).forEach((l) => got.push(JSON.parse(l))));
        c.on('close', () => { owner = null; ownerGone++; });
        c.on('error', () => {});
    });
    await new Promise((res) => srv.listen(sock, res));
    return { sock, got, visits: () => visits, ownerGone: () => ownerGone, hold() { return net.connect(sock); },
        done() { srv.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
}
const send = (c, cmds) => new Promise((res) => c.send(cmds, res));
const wait = (ms) => new Promise((res) => setTimeout(res, ms));

test('wazecontrol: the commands go in one short visit, and the owner slot is free again after it', async () => {
    const w = await fakeWaze();
    try {
        const c = new WazeControl({ path: w.sock });
        const r = await send(c, [{ cmd: 'cluster', on: '0' }, { cmd: 'hud', on: '1' }]);
        assert.strictEqual(r, 'sent');
        await wait(100);
        assert.deepStrictEqual(w.got, [{ cmd: 'cluster', on: '0' }, { cmd: 'hud', on: '1' }]);
        assert.strictEqual(w.ownerGone(), 1, 'the visitor left');
        /* its own app can come now */
        const app = w.hold();
        await wait(100);
        assert.strictEqual(w.visits(), 2);
        app.destroy();
    } finally {
        w.done();
    }
});

test('wazecontrol: when its app holds the socket (busy) nothing is sent, and it says so', async () => {
    const w = await fakeWaze();
    const app = w.hold();                                  /* waze-on-cluster\'s own app, the owner */
    try {
        await wait(100);
        const c = new WazeControl({ path: w.sock });
        const r = await send(c, [{ cmd: 'hud', on: '1' }]);
        assert.strictEqual(r, 'busy');
        assert.deepStrictEqual(w.got, []);
    } finally {
        app.destroy();
        w.done();
    }
});

test('wazecontrol: no waze-on-cluster is a failure, not a crash; a second visit while one is under way is refused', async () => {
    const c = new WazeControl({ path: path.join(os.tmpdir(), 'no-such-waze.sock') });
    assert.strictEqual(await send(c, [{ cmd: 'hud', on: '1' }]), 'failed');
    const w = await fakeWaze();
    try {
        const c2 = new WazeControl({ path: w.sock });
        const first = send(c2, [{ cmd: 'hud', on: '1' }]);
        assert.strictEqual(await send(c2, [{ cmd: 'hud', on: '0' }]), 'busy');
        assert.strictEqual(await first, 'sent');
    } finally {
        w.done();
    }
});
