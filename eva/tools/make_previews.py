#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Bakes the layout pictures of the settings page's galleries: eva/app/hud/previews/<layout>.json, a mosaic from bench pictures of each layout (PNGs named
<layout>.png in the folder given, default /tmp/prev: run the bench with the layout chosen, "?only=1&backdrop=1&clean=1&car=0"). The car's renderer draws no
pixel images (the kit warns "pixel images need the upstream dialect"), so the picture is runs of 3 px cells of one colour, which the page draws as rectangles:
{ w, h, runs: [[x, y, length, "#rrggbb"], ...] } with w x h cells, the black cells left out. The cluster's layouts are 80 x 30 cells (the whole 1920x720), the
HUD's 80 x 46 (the part of the 800x480 HUD the driver sees: x 120, y 100, 485x278).
Run:  python3 eva/tools/make_previews.py [folder]"""
import json, os, sys, glob
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = sys.argv[1] if len(sys.argv) > 1 else '/tmp/prev'
OUT = os.path.join(HERE, '..', 'app', 'hud', 'previews')
os.makedirs(OUT, exist_ok=True)
for f in glob.glob(os.path.join(OUT, '*.json')):
    os.remove(f)
app = json.load(open(os.path.join(HERE, '..', 'app', 'app.json')))
opts = lambda key: [o[0] for o in next(s for s in app['settings'] if s['key'] == key)['options'] if o[0] != 'off']
CELL, LEVEL = 3, 40


def quant(v):
    return min(255, (v // LEVEL) * LEVEL + LEVEL // 2)


for key, box, crop in (('hudLayout', (240, 90), None), ('windHudLayout', (240, 138), (120, 100, 605, 378))):
    for i in opts(key):
        p = os.path.join(SRC, i + '.png')
        if not os.path.exists(p):
            print('no picture for', i)
            continue
        im = Image.open(p).convert('RGB')
        if crop:
            im = im.crop(crop)
        im = im.resize(box, Image.LANCZOS).resize((box[0] // CELL, box[1] // CELL), Image.BOX)
        px, runs = im.load(), []
        for y in range(im.height):
            x = 0
            while x < im.width:
                r, g, b = px[x, y]
                if max(r, g, b) < 24:
                    x += 1
                    continue
                c = (quant(r), quant(g), quant(b))
                n = 1
                while x + n < im.width:
                    r2, g2, b2 = px[x + n, y]
                    if max(r2, g2, b2) < 24 or (quant(r2), quant(g2), quant(b2)) != c:
                        break
                    n += 1
                runs.append([x, y, n, '#%02x%02x%02x' % c])
                x += n
        with open(os.path.join(OUT, i + '.json'), 'w') as f:
            json.dump({'w': im.width, 'h': im.height, 'runs': runs}, f, separators=(',', ':'))
        print(i, len(runs), 'runs')
