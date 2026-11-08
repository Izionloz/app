#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Bakes the layout pictures of the settings page's gallery: eva/app/hud/previews/<layout>.json, 240x90 RGBA ({ w, h, rgba: base64 }), from bench pictures of each
layout (1920x720 PNGs named <layout>.png in the folder given, default /tmp/prev: run the bench with the layout chosen, "?only=1&backdrop=1&clean=1&car=0").
Run:  python3 eva/tools/make_previews.py [folder]"""
import base64, json, os, sys
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = sys.argv[1] if len(sys.argv) > 1 else '/tmp/prev'
OUT = os.path.join(HERE, '..', 'app', 'hud', 'previews')
os.makedirs(OUT, exist_ok=True)
app = json.load(open(os.path.join(HERE, '..', 'app', 'app.json')))
ids = [o[0] for o in next(s for s in app['settings'] if s['key'] == 'hudLayout')['options'] if o[0] != 'off']
for i in ids:
    p = os.path.join(SRC, i + '.png')
    if not os.path.exists(p):
        print('no picture for', i)
        continue
    im = Image.open(p).convert('RGBA').resize((240, 90), Image.LANCZOS)
    with open(os.path.join(OUT, i + '.json'), 'w') as f:
        json.dump({'w': 240, 'h': 90, 'rgba': base64.b64encode(im.tobytes()).decode('ascii')}, f, separators=(',', ':'))
    print(i)
