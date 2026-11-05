// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * wazestatus - what waze-on-cluster reports about itself, read from the status file it writes every second
 * (/run/waze-on-cluster/status.json, mode 0644, the same line its control socket sends: {"ev":"status",...}).
 * Reading the file takes nothing from the control socket, which has one owner at a time and belongs to waze-on-cluster's
 * own app: choosing the cluster, the HUD or both, and the HUD map's size and place, stay with that app.
 *
 * waze-on-cluster 0.9.0 and later draws the HUD's map itself (its own connection and layer, scaled to the size it is
 * shown at, with a black background, which a HUD shows as nothing): its status has `hud_state`. An older one has not,
 * and the proxy then copies the cluster's frames to the HUD itself.
 * Node 8 compatible; the process never exits on an error.
 */
'use strict';

const fs = require('fs');

const POLL_MS = 2000;
const STALE_MS = 15000;        /* waze-on-cluster writes it every second: older than this, it is not running */

class WazeStatus {
    constructor(opts) {
        const o = opts || {};
        this.file = o.file || '/run/waze-on-cluster/status.json';
        this.onChange = o.onChange || (() => {});
        this.now = o.now || Date.now;
        this.status = null;            /* the last status line, null when the file is missing or stale */
        this.timer = null;
        this.last = '';
    }

    open() {
        if (!this.timer) {
            this.poll();
            this.timer = setInterval(() => this.poll(), POLL_MS);
        }
    }

    close() {
        clearInterval(this.timer);
        this.timer = null;
    }

    poll() {
        let st = null;
        try {
            const age = this.now() - fs.statSync(this.file).mtime.getTime();
            if (age <= STALE_MS) {
                const j = JSON.parse(fs.readFileSync(this.file, 'utf8'));
                if (j && j.ev === 'status') {
                    st = j;
                }
            }
        } catch (e) { /* not there, or being replaced: the next poll */ }
        this.status = st;
        const sum = JSON.stringify(this.summary());
        if (sum !== this.last) {
            this.last = sum;
            try { this.onChange(); } catch (e) { /* the helper never stops for it */ }
        }
    }

    /* this waze-on-cluster draws the HUD's map itself */
    native() {
        return !!(this.status && typeof this.status.hud_state === 'string');
    }

    summary() {
        const s = this.status || {};
        return {
            connected: !!this.status,
            native: this.native(),
            state: s.state || null,
            reason: s.reason || null,
            cluster: s.cluster === undefined ? null : Number(s.cluster),
            hud: s.hud === undefined ? null : Number(s.hud),
            hudState: s.hud_state || null,
            hudWidthPct: s.hud_width_pct === undefined ? null : Number(s.hud_width_pct)
        };
    }
}

module.exports = { WazeStatus };
