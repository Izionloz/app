#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Bakes the layout pictures of the settings page's galleries: eva/app/hud/previews/<layout>.json, 240x90 (cluster) or 240x138 (HUD) RGBA ({ w, h, rgba: base64 }), from bench pictures of each
layout (PNGs named <layout>.png in the folder given, default /tmp/prev: run the bench with the layout chosen, "?only=1&backdrop=1&clean=1&car=0").
Run:  python3 eva/tools/make_previews.py [folder]"""
import base64, json, os, sys
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = sys.argv[1] if len(sys.argv) > 1 else '/tmp/prev'
OUT = os.path.join(HERE, '..', 'app', 'hud', 'previews')
os.makedirs(OUT, exist_ok=True)
app = json.load(open(os.path.join(HERE, '..', 'app', 'app.json')))
opts = lambda key: [o[0] for o in next(s for s in app['settings'] if s['key'] == key)['options'] if o[0] != 'off']
# the cluster's layouts: the whole 1920x720 picture; the HUD's: the part of the 800x480 HUD the driver sees (x 120, y 100, 485x278) as 240x138
for key, box, crop in (('hudLayout', (240, 90), None), ('windHudLayout', (240, 138), (120, 100, 605, 378))):
    for i in opts(key):
        p = os.path.join(SRC, i + '.png')
        if not os.path.exists(p):
            print('no picture for', i)
            continue
        im = Image.open(p).convert('RGBA')
        if crop:
            im = im.crop(crop)
        im = im.resize(box, Image.LANCZOS)
        with open(os.path.join(OUT, i + '.json'), 'w') as f:
            json.dump({'w': box[0], 'h': box[1], 'rgba': base64.b64encode(im.tobytes()).decode('ascii')}, f, separators=(',', ':'))
        print(i)
