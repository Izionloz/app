#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
/**
 * Builds the catalog's artifacts that can be built from this repository and keeps catalog.json in step with them.
 *
 *   node release/catalog.js --out dist            build them into dist/ and rewrite catalog.json (version, name,
 *                                                 size, sha256, url) from what was built
 *   node release/catalog.js --out dist --check    build them and fail if catalog.json does not match
 *   node release/catalog.js --out dist --commit <sha> --write <file>
 *                                                 also write a copy of the catalog carrying that commit
 *   ... --kit <idrive7-apps checkout>             also build the designer (release/designer.js)
 *
 * Tools (native/<id>) are packed with tool_artifact.js; apps built on the unit (apps/<id>, "build": "unit") are
 * their source package. The builds are reproducible: the same tree gives the same bytes.
 * The designer is built with the idrive7-apps kit, only when --kit is given. Its bytes depend on the kit's commit
 * as well, so --check checks its version against designer/app/app.json but not its artifact: the copy written with
 * --write carries the artifact that was built.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cp = require('child_process');
const { buildArtifact } = require('./tool_artifact.js');
const designer = require('./designer.js');

const ROOT = path.join(__dirname, '..');
const CATALOG = path.join(ROOT, 'catalog.json');
const REPO = 'Izionloz/app';

function arg(argv, name) {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
}

function urlOf(id, version, file) {
    const tag = encodeURIComponent(`${id}@${version}`);
    return `https://github.com/${REPO}/releases/download/${tag}/${encodeURIComponent(file)}`;
}

/* builds one component into outDir: {version, file} or null when it is not built here */
function build(c, outDir, kit) {
    if (c.id === designer.ID) {
        return kit ? { version: designer.version(), file: designer.build(kit, outDir), kit: true } : null;
    }
    const toolDir = path.join(ROOT, 'native', c.id);
    if (c.kind === 'tool' && fs.existsSync(path.join(toolDir, 'component.json'))) {
        const version = JSON.parse(fs.readFileSync(path.join(toolDir, 'component.json'), 'utf8')).version;
        return { version, file: buildArtifact(toolDir, outDir) };
    }
    const appDir = path.join(ROOT, 'apps', c.id);
    if (c.kind === 'app' && c.build === 'unit' && fs.existsSync(path.join(appDir, 'mgu-app.json'))) {
        const version = JSON.parse(fs.readFileSync(path.join(appDir, 'mgu-app.json'), 'utf8')).version;
        cp.execFileSync(process.execPath, ['tools/build.js'], { cwd: appDir, stdio: 'ignore' });
        const src = path.join(appDir, `${c.id}@${version}.src.tgz`);
        const file = path.join(outDir, `${c.id}@${version}.tgz`);
        fs.mkdirSync(outDir, { recursive: true });
        fs.copyFileSync(src, file);
        fs.unlinkSync(src);
        return { version, file };
    }
    return null;
}

function main() {
    const argv = process.argv.slice(2);
    const outDir = path.resolve(arg(argv, '--out') || 'dist');
    const check = argv.includes('--check');
    const kit = arg(argv, '--kit');
    const catalog = JSON.parse(fs.readFileSync(CATALOG, 'utf8'));
    const problems = [];
    const built = [];
    catalog.components.forEach((c) => {
        if (c.id === designer.ID && c.version !== designer.version()) {
            problems.push(`${c.id}: catalog has ${c.version}, designer/app/app.json ${designer.version()}`);
        }
        const b = build(c, outDir, kit);
        if (!b) {
            built.push({ id: c.id, version: c.version, built: false });
            return;
        }
        const data = fs.readFileSync(b.file);
        const name = path.basename(b.file);
        const artifact = { name, size: data.length, sha256: crypto.createHash('sha256').update(data).digest('hex'),
            url: urlOf(c.id, b.version, name) };
        if (!b.kit && (c.version !== b.version || JSON.stringify(c.artifact) !== JSON.stringify(artifact))) {
            problems.push(`${c.id}: catalog has ${c.version} ${c.artifact && c.artifact.sha256}, built ${b.version} ${artifact.sha256}`);
        }
        c.version = b.version;
        c.artifact = artifact;
        built.push({ id: c.id, version: b.version, built: true, file: path.relative(ROOT, b.file), tag: `${c.id}@${b.version}` });
    });
    if (check && problems.length) {
        problems.forEach((p) => console.error(`catalog: ${p}`));
        console.error('catalog: run `node release/catalog.js --out dist` and commit catalog.json');
        process.exitCode = 1;
        return;
    }
    const text = (o) => `${JSON.stringify(o, null, 4)}\n`;
    if (!check) {
        fs.writeFileSync(CATALOG, text(catalog));
    }
    const commit = arg(argv, '--commit');
    const copy = arg(argv, '--write');
    if (copy) {
        fs.writeFileSync(path.resolve(copy), text(Object.assign({}, catalog, { commit: commit ? commit.slice(0, 7) : catalog.commit })));
    }
    console.log(JSON.stringify(built));
}

try {
    main();
} catch (e) {
    console.error(`catalog: ${e.message}`);
    process.exitCode = 1;
}
