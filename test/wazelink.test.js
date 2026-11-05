// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { WazeLink } = require('../native/mgux-hud-ctl/wazelink.js');

const wait = (ms) => new Promise((res) => setTimeout(res, ms));

async function fakeWaze(onConnect) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wl-'));
    const sock = path.join(dir, 'ctl.sock');
    const got = [];
    const conns = [];
    const srv = net.createServer((c) => {
        conns.push(c);
        c.setEncoding('utf8');
        c.on('data', (d) => d.split('\n').filter(Boolean).forEach((l) => got.push(JSON.parse(l))));
        c.on('error', () => {});
        onConnect(c, conns.length);
    });
    await new Promise((res) => srv.listen(sock, res));
    return { sock, got, conns, srv, done() { conns.forEach((c) => c.destroy()); srv.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
}

test('wazelink: a 0.9.0 status says it draws the HUD itself; commands are sent to it', async () => {
    const w = await fakeWaze((c) => c.write('{"ev":"status","state":"showing","page":"map","cluster":1,"hud":0,"hud_state":"off","hud_width_pct":0}\n'));
    let changes = 0;
    const l = new WazeLink({ path: w.sock, onChange: () => { changes++; } });
    try {
        l.open();
        await wait(150);
        assert.strictEqual(l.native(), true);
        assert.deepStrictEqual([l.summary().state, l.summary().hud, l.summary().hudState], ['showing', 0, 'off']);
        assert.ok(changes >= 1);
        assert.strictEqual(l.send({ cmd: 'hud', on: '1' }), true);
        await wait(100);
        assert.deepStrictEqual(w.got, [{ cmd: 'hud', on: '1' }]);
    } finally {
        l.close();
        w.done();
    }
});

test('wazelink: an older waze-on-cluster (no hud_state) is not native', async () => {
    const w = await fakeWaze((c) => c.write('{"ev":"status","state":"showing","target":"map","page":"map"}\n'));
    const l = new WazeLink({ path: w.sock });
    try {
        l.open();
        await wait(150);
        assert.strictEqual(l.summary().connected, true);
        assert.strictEqual(l.native(), false);
    } finally {
        l.close();
        w.done();
    }
});

test('wazelink: closed before any status means another owner holds the socket; it connects again', async () => {
    let n = 0;
    const w = await fakeWaze((c) => {
        n++;
        if (n === 1) { c.end(); } else { c.write('{"ev":"status","state":"idle","cluster":1,"hud":0,"hud_state":"off"}\n'); }
    });
    const l = new WazeLink({ path: w.sock });
    try {
        l.open();
        await wait(150);
        assert.strictEqual(l.summary().busy, true);
        assert.strictEqual(l.summary().connected, false);
        l._connect();                                   /* the retry (3 s) done now */
        clearTimeout(l.timer);
        l.timer = null;
        l._connect();
        await wait(150);
        assert.strictEqual(l.summary().connected, true);
        assert.strictEqual(l.summary().busy, false);
    } finally {
        l.close();
        w.done();
    }
});
