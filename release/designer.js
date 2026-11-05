#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
/**
 * Builds the HUD map designer's package with the idrive7-apps kit, as designer/README.md describes:
 *
 *   node release/designer.js --kit <idrive7-apps checkout> --out <dir>
 *
 * The app (designer/app) goes into the kit's apps/hud_designer, the three patched kit files over the kit's own.
 * The kit's build wants BMW's oap-sdk, but only copies it into node_modules/oap-sdk, which the released package
 * leaves out (the head unit's deploy tool makes that module from its own firmware when it installs the package):
 * a placeholder is enough, and it is not in the result. The staged package is then packed again sorted, owner 0:0,
 * one mtime (tools/oap_pack.js), so the same kit commit gives the same bytes.
 * The kit is run in its own checkout; nothing of it is kept in this repository.
 */
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const { tgz, MTIME } = require('../tools/oap_pack.js');

const ROOT = path.join(__dirname, '..');
const APP = path.join(ROOT, 'designer', 'app');
const PATCH = path.join(ROOT, 'designer', 'kit-patch');
const ID = 'hud_designer';
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
    const need = ['kit/tools/build.py', 'kit/runtime/mgu.js', 'kit/runtime/display.js', 'kit/tools/hu-stub.js'];
    need.forEach((f) => {
        if (!fs.existsSync(path.join(kit, f))) {
            throw new Error(`${kitDir} is not an idrive7-apps checkout (no ${f})`);
        }
    });
    const appDir = path.join(kit, 'apps', ID);
    fs.rmSync(appDir, { recursive: true, force: true });
    fs.mkdirSync(appDir, { recursive: true });
    fs.readdirSync(APP).forEach((f) => fs.copyFileSync(path.join(APP, f), path.join(appDir, f)));
    fs.copyFileSync(path.join(PATCH, 'mgu.js'), path.join(kit, 'kit', 'runtime', 'mgu.js'));
    fs.copyFileSync(path.join(PATCH, 'display.js'), path.join(kit, 'kit', 'runtime', 'display.js'));
    fs.copyFileSync(path.join(PATCH, 'hu-stub.js'), path.join(kit, 'kit', 'tools', 'hu-stub.js'));
    const sdk = path.join(kit, 'oap-sdk');
    let placeholder = false;
    if (!fs.existsSync(path.join(sdk, 'index.js'))) {
        placeholder = true;
        fs.mkdirSync(sdk, { recursive: true });
        fs.writeFileSync(path.join(sdk, 'index.js'), '// placeholder: not in the package; the head unit makes oap-sdk\n');
        fs.writeFileSync(path.join(sdk, 'package.json'), '{"name":"oap-sdk","version":"0.0.0"}\n');
    }
    try {
        /* the kit's output goes to stderr: stdout is this script's result */
        cp.execFileSync('python3', ['kit/tools/build.py', ID], { cwd: kit, stdio: ['ignore', 2, 2] });
    } finally {
        if (placeholder) {
            fs.rmSync(sdk, { recursive: true, force: true });
        }
    }
    const src = path.join(kit, 'dist', ID, 'source');
    const names = walk(src, 'package', []).filter((n) => !n.startsWith(SDK_DIR));
    const entries = names.map((n) => ({ name: n, data: fs.readFileSync(path.join(src, n.slice('package/'.length))), mode: 0o644 }));
    fs.mkdirSync(outDir, { recursive: true });
    const file = path.join(outDir, `${ID}@${version()}.tgz`);
    fs.writeFileSync(file, tgz(entries, MTIME));
    return file;
}

if (require.main === module) {
    const argv = process.argv.slice(2);
    const kit = argv[argv.indexOf('--kit') + 1];
    const out = argv.indexOf('--out') >= 0 ? argv[argv.indexOf('--out') + 1] : 'dist';
    if (argv.indexOf('--kit') < 0 || !kit) {
        console.error('usage: node release/designer.js --kit <idrive7-apps checkout> [--out <dir>]');
        process.exitCode = 2;
    } else {
        try {
            console.log(build(kit, path.resolve(out)));
        } catch (e) {
            console.error(`designer: ${e.message}`);
            process.exitCode = 1;
        }
    }
}

module.exports = { build, version, ID };
