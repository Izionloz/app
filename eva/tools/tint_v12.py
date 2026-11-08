#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Makes the V12 layout's pictures (v_coolant, v_oil, v_battery, v_fuel, v_car) from EVA Comfort's baked ones (c_*): the same shapes, their
brightness painted white-yellow instead of orange. Run after make_assets.py --comfort."""
import base64, json, os

PIC = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'app', 'hud', 'pictures')
for src, dst in (('c_coolant', 'v_coolant'), ('c_oil', 'v_oil'), ('c_battery', 'v_battery'), ('c_fuel', 'v_fuel'), ('c_car', 'v_car')):
    d = json.load(open(os.path.join(PIC, src + '.json')))
    raw = bytearray(base64.b64decode(d['rgba']))
    for i in range(0, len(raw), 4):
        r, g, b, a = raw[i:i + 4]
        l = min(1.0, max(r, g, b) / 255 * 1.15)
        raw[i], raw[i + 1], raw[i + 2] = round(255 * (0.55 + 0.45 * l)), round(212 * (0.35 + 0.65 * l) + 30 * l), round(40 * l + 220 * l * l * 0.2)
    json.dump({'w': d['w'], 'h': d['h'], 'rgba': base64.b64encode(bytes(raw)).decode('ascii')}, open(os.path.join(PIC, dst + '.json'), 'w'), separators=(',', ':'))
    print(dst, d['w'], d['h'])
