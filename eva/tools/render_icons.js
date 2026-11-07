#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-or-later
// Draws eva/tools/icons/*.svg to eva/tools/icons/*.png (144x144, cream on transparent) with the Playwright Chromium.
'use strict';
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const dir = path.join(__dirname, 'icons');
(async () => {
    const b = await chromium.launch();
    const p = await b.newPage({ viewport: { width: 144, height: 144 }, deviceScaleFactor: 1 });
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.svg'))) {
        const svg = fs.readFileSync(path.join(dir, f), 'utf8').replace('<svg ', '<svg width="144" height="144" fill="#ffecd6" ');
        await p.setContent('<body style="margin:0;background:transparent">' + svg);
        await p.screenshot({ path: path.join(dir, f.replace('.svg', '.png')), omitBackground: true });
    }
    await b.close();
})();
