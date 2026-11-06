// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * wazecontrol - sends commands to waze-on-cluster's control socket (/dev/shm/waze-on-cluster/ctl.sock, newline JSON)
 * over a connection that lives only as long as the commands need: connect, write, close. The socket has one owner at a
 * time and belongs to waze-on-cluster's own app; waze-on-cluster does nothing when an owner goes (`on_owner_gone` is
 * empty), so a short visit leaves the app free to connect whenever it is opened. When the app holds the socket,
 * waze-on-cluster answers "busy" and closes: the commands are not sent, and the caller asks again later.
 *
 * waze-on-cluster 0.9.0 and later has `{"cmd":"cluster","on":"0"|"1"}`, `{"cmd":"hud","on":"0"|"1"}` (the map on each
 * display) and `{"cmd":"hud","hud_width_pct":"20".."100"}` (how wide the HUD's frame is scaled).
 * Node 8 compatible; the process never exits on an error.
 */
'use strict';

const net = require('net');

const LINGER_MS = 250;           /* after the last command, so waze-on-cluster has read it before the socket closes */
const GIVE_UP_MS = 3000;

class WazeControl {
    constructor(opts) {
        const o = opts || {};
        this.path = o.path || '/dev/shm/waze-on-cluster/ctl.sock';
        this.log = o.log || (() => {});
        this.busyNow = false;          /* a visit is under way: no second one */
    }

    /* Sends the commands (objects) in one visit; done(result) with 'sent', 'busy' or 'failed'. */
    send(cmds, done) {
        const cb = done || (() => {});
        if (this.busyNow || !cmds || !cmds.length) {
            cb(this.busyNow ? 'busy' : 'sent');
            return;
        }
        this.busyNow = true;
        let result = 'failed', ended = false, heard = '';
        const finish = () => {
            if (ended) {
                return;
            }
            ended = true;
            clearTimeout(giveUp);
            this.busyNow = false;
            try { sock.destroy(); } catch (e) { /* gone */ }
            cb(result);
        };
        const sock = net.connect(this.path);
        const giveUp = setTimeout(finish, GIVE_UP_MS);
        sock.setEncoding('utf8');
        sock.on('connect', () => {
            /* a refused visit is answered at once with a status whose reason is "busy": wait a moment for it */
            setTimeout(() => {
                if (ended || /"reason"\s*:\s*"busy"/.test(heard)) {
                    return;
                }
                try {
                    sock.write(cmds.map((c) => `${JSON.stringify(c)}\n`).join(''));
                    result = 'sent';
                    setTimeout(finish, LINGER_MS);
                } catch (e) {
                    this.log(`wazecontrol: ${e.message}`);
                    finish();
                }
            }, 120);
        });
        sock.on('data', (d) => {
            heard += d;
            if (heard.length > 65536) {
                heard = heard.slice(-4096);
            }
            if (/"reason"\s*:\s*"busy"/.test(heard)) {
                result = 'busy';
                finish();
            }
        });
        sock.on('error', () => finish());
        sock.on('close', () => finish());
    }
}

module.exports = { WazeControl };
