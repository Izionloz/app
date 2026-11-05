// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * wazelink - the helper's connection to waze-on-cluster's control socket (/dev/shm/waze-on-cluster/ctl.sock,
 * newline JSON). waze-on-cluster 0.9.0 and later draws the map on the cluster and on the HUD itself, each on its own
 * connection to the renderer, the HUD's scaled to the size it is shown at with a black background (a HUD shows black as
 * nothing), rounded corners and feathered edges; `{"cmd":"cluster","on":"0"|"1"}` and `{"cmd":"hud","on":"0"|"1"}`
 * turn each on or off, `{"cmd":"hud","hud_width_pct":"20".."100"}` sizes the HUD's.
 *
 * The socket has one owner: this connection holds it so the choice of where the map shows applies from every start,
 * not only while an app is open. An older waze-on-cluster has no HUD feed of its own: its status has no `hud_state`,
 * and the proxy then puts the map on the HUD itself (a copy of the cluster's frames).
 * Node 8 compatible; the process never exits on an error.
 */
'use strict';

const net = require('net');

const RETRY_MS = 3000;
const MAX_BUFFER = 65536;

class WazeLink {
    constructor(opts) {
        const o = opts || {};
        this.path = o.path || '/dev/shm/waze-on-cluster/ctl.sock';
        this.onChange = o.onChange || (() => {});
        this.log = o.log || (() => {});
        this.status = null;            /* the last {"ev":"status"} of this connection */
        this.sock = null;
        this.ready = false;
        this.busy = false;             /* another owner holds the socket */
        this.timer = null;
        this.wanted = false;
        this.buf = '';
        this.heard = false;            /* a status came on this connection */
        this.last = '';                /* the summary last reported, to tell a change */
    }

    open() {
        this.wanted = true;
        this._connect();
    }

    close() {
        this.wanted = false;
        clearTimeout(this.timer);
        this.timer = null;
        const s = this.sock;
        this.sock = null;
        this.ready = false;
        this.status = null;
        if (s) {
            s.removeAllListeners('data');
            s.on('error', () => {});
            s.destroy();
        }
    }

    /* this waze-on-cluster draws the HUD itself */
    native() {
        return !!(this.ready && this.status && typeof this.status.hud_state === 'string');
    }

    send(obj) {
        if (!this.ready || !this.sock) {
            return false;
        }
        try {
            this.sock.write(`${JSON.stringify(obj)}\n`);
            return true;
        } catch (e) {
            return false;
        }
    }

    summary() {
        const s = this.status || {};
        return {
            connected: this.ready && !!this.status,
            busy: this.busy,
            native: this.native(),
            state: s.state || null,
            page: s.page || null,
            reason: s.reason || null,
            cluster: s.cluster === undefined ? null : Number(s.cluster),
            hud: s.hud === undefined ? null : Number(s.hud),
            hudState: s.hud_state || null,
            hudWidthPct: s.hud_width_pct === undefined ? null : Number(s.hud_width_pct)
        };
    }

    _changed() {
        const j = JSON.stringify(this.summary());
        if (j !== this.last) {
            this.last = j;
            try { this.onChange(); } catch (e) { this.log(`wazelink: ${e.message}`); }
        }
    }

    _connect() {
        if (!this.wanted || this.sock) {
            return;
        }
        const s = net.connect(this.path);
        this.sock = s;
        this.heard = false;
        this.buf = '';
        s.setEncoding('utf8');
        s.on('connect', () => { this.ready = true; this._changed(); });
        s.on('data', (d) => {
            this.buf += d;
            if (this.buf.length > MAX_BUFFER && this.buf.indexOf('\n') < 0) {
                this.buf = '';
            }
            let i;
            while ((i = this.buf.indexOf('\n')) >= 0) {
                const line = this.buf.slice(0, i);
                this.buf = this.buf.slice(i + 1);
                try {
                    const m = JSON.parse(line);
                    if (m && m.ev === 'status') {
                        this.status = m;
                        this.heard = true;
                        this.busy = false;
                        this._changed();
                    }
                } catch (e) { /* not JSON: ignored */ }
            }
        });
        s.on('error', () => { /* 'close' follows */ });
        s.on('close', () => {
            if (this.sock !== s) {
                return;
            }
            /* closed before it ever told its status: another owner holds the socket (it answers "busy" and closes) */
            this.busy = this.ready && !this.heard;
            this.sock = null;
            this.ready = false;
            this.status = null;
            this._changed();
            if (this.wanted && !this.timer) {
                this.timer = setTimeout(() => { this.timer = null; this._connect(); }, RETRY_MS);
            }
        });
    }
}

module.exports = { WazeLink };
