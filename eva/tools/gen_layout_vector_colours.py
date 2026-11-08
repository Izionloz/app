#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Writes the five other colourings of EVA Vector (eva_vector_red, _violet, _lime, _mono, _gold) from eva_vector.json (run gen_layout_vector.py first): the
caption and highlight colours, the line palette, the dial's lit and red-zone colours, and the icons (the cyan set recoloured, suffix _r _v _l _m _g)."""
import json, base64, os, copy
HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.join(HERE, '..', 'app', 'hud')
BASE = json.load(open(os.path.join(APP, 'layouts', 'eva_vector.json')))
PIC = os.path.join(APP, 'pictures')
OUT = APP
V = [
 ('eva_vector_red',    'EVA Vector Red',    [255, 96, 72],  [1.0, 0.32, 0.22], [255, 205, 60], [[0.92, 0.66, 0.6], [0.32, 0.14, 0.12], [1.0, 0.78, 0.2]], [1.0, 0.86, 0.3], '_r'),
 ('eva_vector_violet', 'EVA Vector Violet', [196, 128, 255], [0.74, 0.44, 1.0], [255, 90, 170], [[0.74, 0.62, 0.96], [0.22, 0.15, 0.34], [1.0, 0.3, 0.7]], [1.0, 0.2, 0.5], '_v'),
 ('eva_vector_lime',   'EVA Vector Lime',   [150, 255, 96], [0.52, 1.0, 0.3], [255, 232, 60], [[0.66, 0.92, 0.6], [0.16, 0.3, 0.14], [1.0, 0.86, 0.2]], [1.0, 0.3, 0.15], '_l'),
 ('eva_vector_mono',   'EVA Vector Mono',   [214, 224, 238], [0.94, 0.96, 1.0], [255, 70, 60], [[0.82, 0.84, 0.88], [0.22, 0.24, 0.28], [1.0, 0.26, 0.2]], [1.0, 0.2, 0.15], '_m'),
 ('eva_vector_gold',   'EVA Vector Gold',   [255, 198, 72], [1.0, 0.78, 0.26], [255, 112, 50], [[0.92, 0.82, 0.58], [0.3, 0.24, 0.14], [1.0, 0.45, 0.15]], [1.0, 0.25, 0.1], '_g'),
]
ICONS = ['v_coolant', 'v_oil', 'v_battery', 'v_fuel', 'v_car']
for vid, name, acc, accf, hot, pal, zone, suf in V:
    L = copy.deepcopy(BASE)
    L['name'] = name
    for w in L['widgets']:
        if w['type'] == 'text':
            if w['color'] == [80, 215, 255, 255]: w['color'] = acc + [255]
            elif w['color'] == [255, 112, 52, 255]: w['color'] = hot + [255]
        elif w['type'] == 'picture':
            w['name'] = w['name'].replace('_n', suf)
        elif w['type'] == 'evadash2':
            w['pal'] = pal
        elif w['type'] == 'evadial':
            w['dial']['yellow'] = accf; w['dial']['red'] = zone
    json.dump(L, open(os.path.join(OUT, 'layouts', vid + '.json'), 'w'), indent=1)
    # icons: the cyan set recoloured
    for n in ICONS:
        d = json.load(open('%s/%s_n.json' % (PIC, n)))
        raw = bytearray(base64.b64decode(d['rgba']))
        for i in range(0, len(raw), 4):
            r, g, b, a = raw[i:i+4]
            l = min(1.0, max(r, g, b) / 255 * 1.15)
            for k in range(3):
                raw[i + k] = round(min(255, acc[k] * (0.4 + 0.6 * l) + 255 * 0.35 * l * l))
        json.dump({'w': d['w'], 'h': d['h'], 'rgba': base64.b64encode(bytes(raw)).decode('ascii')}, open(os.path.join(OUT, 'pictures', n + suf + '.json'), 'w'), separators=(',', ':'))
print('ok', len(V))
