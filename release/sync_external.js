#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
/**
 * Brings the catalog entries that point at someone else's release assets (RideTube and its tools) up to date from the
 * author's own catalogs.
 *
 *   node release/sync_external.js            rewrite those entries of catalog.json from the authors' catalogs
 *   node release/sync_external.js --check    only say what would change (exit 1 when something would)
 *   node release/sync_external.js --verify   also download every asset and check its size and sha256 (about 60 MB)
 *
 * Nothing is built or uploaded here; release/catalog.js leaves these entries as they are.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CATALOG = path.join(__dirname, '..', 'catalog.json');
const SOURCES = [
    { url: 'https://github.com/JustAnotherPU/ridetube/releases/download/catalog/catalog.json', ids: ['jap_ridetube', 'jap-ridetube-d'] },
    { url: 'https://github.com/JustAnotherPU/mgu-apps/releases/download/catalog/catalog.json', ids: ['jap-node22'] },
];
const ARTIFACT_URL = /^https:\/\/github\.com\/JustAnotherPU\/(ridetube|mgu-apps)\/releases\/download\/catalog\/[^/]+$/;

/** The catalog with the entries in `ids` replaced by the upstream's (or appended): returns { catalog, changes }. */
function merge(catalog, upstream, ids) {
    const changes = [];
    ids.forEach((id) => {
        const up = (upstream.components || []).find((c) => c.id === id);
        if (!up) throw new Error(`${id} is not in the author's catalog any more`);
        if (!up.artifact || !ARTIFACT_URL.test(up.artifact.url) || !/^[0-9a-f]{64}$/.test(up.artifact.sha256) || !(up.artifact.size > 0)) {
            throw new Error(`${id}: the author's entry has no usable artifact (url, size, sha256)`);
        }
        const i = catalog.components.findIndex((c) => c.id === id);
        if (i < 0) { catalog.components.push(up); changes.push(`${id}: added ${up.version}`); return; }
        if (JSON.stringify(catalog.components[i]) !== JSON.stringify(up)) {
            changes.push(`${id}: ${catalog.components[i].version} -> ${up.version}${catalog.components[i].artifact.sha256 !== up.artifact.sha256 ? ' (sha256 differs)' : ''}`);
            catalog.components[i] = up;
        }
    });
    return { catalog, changes };
}

async function get(url) {
    const r = await fetch(url, { redirect: 'follow' });
    if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
    return r;
}

async function verify(entry) {
    const r = await get(entry.artifact.url);
    const h = crypto.createHash('sha256');
    let n = 0;
    for await (const chunk of r.body) { h.update(chunk); n += chunk.length; }
    if (n !== entry.artifact.size || h.digest('hex') !== entry.artifact.sha256) throw new Error(`${entry.id}: the asset is not what the author's catalog says`);
}

async function main() {
    const argv = process.argv.slice(2);
    let catalog = JSON.parse(fs.readFileSync(CATALOG, 'utf8'));
    const all = [];
    for (const s of SOURCES) {
        const up = await (await get(s.url)).json();
        const m = merge(catalog, up, s.ids);
        catalog = m.catalog;
        all.push(...m.changes);
    }
    if (argv.includes('--verify')) {
        for (const s of SOURCES) for (const id of s.ids) { await verify(catalog.components.find((c) => c.id === id)); console.log(`${id}: asset verified`); }
    }
    all.forEach((c) => console.log(c));
    if (!all.length) console.log('the RideTube entries are up to date');
    if (all.length && argv.includes('--check')) { process.exitCode = 1; return; }
    if (all.length) fs.writeFileSync(CATALOG, `${JSON.stringify(catalog, null, 4)}\n`);
}

if (require.main === module) main().catch((e) => { console.error(`sync_external: ${e.message}`); process.exitCode = 1; });
module.exports = { merge };
