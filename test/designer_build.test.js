// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const designer = require('../release/designer.js');

/* a stand-in for the idrive7-apps kit: its build.py stages what the real one does around oap-sdk */
function fakeKit() {
    const kit = fs.mkdtempSync(path.join(os.tmpdir(), 'fakekit-'));
    fs.mkdirSync(path.join(kit, 'kit', 'tools'), { recursive: true });
    fs.mkdirSync(path.join(kit, 'kit', 'runtime'), { recursive: true });
    ['runtime/mgu.js', 'runtime/display.js', 'tools/hu-stub.js'].forEach((f) => fs.writeFileSync(path.join(kit, 'kit', f), '// kit\n'));
    fs.writeFileSync(path.join(kit, 'kit', 'tools', 'build.py'), `
import os, shutil, sys
app = sys.argv[1]
src = os.path.join('dist', app, 'source')
shutil.rmtree(os.path.join('dist', app), ignore_errors=True)
os.makedirs(os.path.join(src, 'javascript', 'kit'))
os.makedirs(os.path.join(src, 'node_modules', 'oap-sdk'))
shutil.copy(os.path.join('apps', app, 'main.js'), os.path.join(src, 'javascript', 'app.js'))
shutil.copy(os.path.join('apps', app, 'hudclient.js'), os.path.join(src, 'javascript', 'hudclient.js'))
shutil.copy(os.path.join('kit', 'runtime', 'display.js'), os.path.join(src, 'javascript', 'kit', 'display.js'))
for f in ('index.js', 'package.json'):
    shutil.copy(os.path.join('oap-sdk', f), os.path.join(src, 'node_modules', 'oap-sdk', f))
open(os.path.join(src, 'package.json'), 'w').write('{}')
`);
    return kit;
}

function members(file) {
    const tar = zlib.gunzipSync(fs.readFileSync(file));
    const out = {};
    for (let o = 0; o + 512 <= tar.length;) {
        const h = tar.slice(o, o + 512);
        if (h.every((b) => b === 0)) {
            break;
        }
        const name = h.toString('utf8', 0, 100).replace(/\0.*$/, '');
        const prefix = h.toString('utf8', 345, 500).replace(/\0.*$/, '');
        const size = parseInt(h.toString('utf8', 124, 136).replace(/\0.*$/, ''), 8);
        out[prefix ? `${prefix}/${name}` : name] = tar.slice(o + 512, o + 512 + size);
        o += 512 + Math.ceil(size / 512) * 512;
    }
    return out;
}

test('designer build: the patched kit files are used, oap-sdk is left out, the bytes repeat', () => {
    const kit = fakeKit();
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'designer-out-'));
    try {
        const file = designer.build(kit, out);
        assert.strictEqual(path.basename(file), `hud_designer@${designer.version()}.tgz`);
        const m = members(file);
        assert.deepStrictEqual(Object.keys(m).sort(), ['package/javascript/app.js', 'package/javascript/hudclient.js',
            'package/javascript/kit/display.js', 'package/package.json']);
        assert.ok(m['package/javascript/kit/display.js'].toString().includes('ctx.onTouch'), 'the patched display.js');
        assert.ok(m['package/javascript/hudclient.js'].equals(fs.readFileSync(path.join(__dirname, '..', 'designer', 'app', 'hudclient.js'))));
        assert.ok(!fs.existsSync(path.join(kit, 'oap-sdk')), 'the placeholder sdk is removed again');
        const first = fs.readFileSync(file);
        designer.build(kit, out);
        assert.ok(fs.readFileSync(file).equals(first), 'same input, same bytes');
    } finally {
        fs.rmSync(kit, { recursive: true, force: true });
        fs.rmSync(out, { recursive: true, force: true });
    }
});
