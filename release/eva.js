#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
/**
 * Builds the EVA cluster app's package from bimmer-lab/apps (MIT), the cluster-drawing engine it is made with:
 *
 *   node release/eva.js --kit <bimmer-lab/apps checkout> --out <dir>
 *
 * Nothing of the engine is kept in this repository except eva/engine.patch (the evadash and picture widgets, the EVA
 * theme and tokens) and the app itself (eva/app: app.json, main.js, the layout, the baked fonts and the pilot picture).
 * The build runs in a scratch copy of the checkout's kit/ and shared/ (so a checkout is never changed), applies the
 * patch, puts eva/app in as apps/eva_cluster and runs the kit's build.py. That wants BMW's oap-sdk but only copies it
 * into node_modules/oap-sdk, which the released package leaves out (the head unit makes it); a placeholder does for
 * the build. The staged package is then packed sorted, owner 0:0, one mtime (tools/oap_pack.js).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const { tgz, MTIME } = require('../tools/oap_pack.js');

const ROOT = path.join(__dirname, '..');
const APP = path.join(ROOT, 'eva', 'app');
const PATCH = path.join(ROOT, 'eva', 'engine.patch');
const ID = 'eva_cluster';
const SDK_DIR = 'package/node_modules/oap-sdk/';

function version() {
    return JSON.parse(fs.readFileSync(path.join(APP, 'app.json'), 'utf8')).version;
}

function walk(dir, base, out) {
    fs.readdirSync(dir).sort().forEach((name) => {
        const p = path.join(dir, name);
        const rel = `${base}/${name}`;
        if (fs.statSync(p).isDirectory()) {
            walk(p, rel, out);
        } else {
            out.push(rel);
        }
    });
    return out;
}

function build(kitDir, outDir) {
    const kit = path.resolve(kitDir);
    ['kit/tools/build.py', 'shared/hud.js', 'shared/shaders.js'].forEach((f) => {
        if (!fs.existsSync(path.join(kit, f))) {
            throw new Error(`${kitDir} is not a bimmer-lab/apps checkout (no ${f})`);
        }
    });
    const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'eva-build-'));
    try {
        ['kit', 'shared'].forEach((d) => fs.cpSync(path.join(kit, d), path.join(stage, d), { recursive: true }));
        cp.execFileSync('git', ['apply', '-p1', PATCH], { cwd: stage, stdio: ['ignore', 2, 2] });
        fs.cpSync(APP, path.join(stage, 'apps', ID), { recursive: true });
        fs.mkdirSync(path.join(stage, 'oap-sdk'), { recursive: true });
        fs.writeFileSync(path.join(stage, 'oap-sdk', 'index.js'), '// placeholder: not in the package; the head unit makes oap-sdk\n');
        fs.writeFileSync(path.join(stage, 'oap-sdk', 'package.json'), '{"name":"oap-sdk","version":"0.0.0"}\n');
        /* the kit's output goes to stderr: stdout is this script's result */
        cp.execFileSync('python3', ['kit/tools/build.py', ID], { cwd: stage, stdio: ['ignore', 2, 2] });
        const src = path.join(stage, 'dist', ID, 'source');
        const names = walk(src, 'package', []).filter((n) => !n.startsWith(SDK_DIR));
        const entries = names.map((n) => ({ name: n, data: fs.readFileSync(path.join(src, n.slice('package/'.length))), mode: 0o644 }));
        fs.mkdirSync(outDir, { recursive: true });
        const file = path.join(outDir, `${ID}@${version()}.tgz`);
        fs.writeFileSync(file, tgz(entries, MTIME));
        return file;
    } finally {
        fs.rmSync(stage, { recursive: true, force: true });
    }
}

if (require.main === module) {
    const argv = process.argv.slice(2);
    const kit = argv[argv.indexOf('--kit') + 1];
    const out = argv.indexOf('--out') >= 0 ? argv[argv.indexOf('--out') + 1] : 'dist';
    if (argv.indexOf('--kit') < 0 || !kit) {
        console.error('usage: node release/eva.js --kit <bimmer-lab/apps checkout> [--out <dir>]');
        process.exitCode = 2;
    } else {
        try {
            console.log(build(kit, path.resolve(out)));
        } catch (e) {
            console.error(`eva: ${e.message}`);
            process.exitCode = 1;
        }
    }
}

module.exports = { build, version, ID };
