#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Makes the V12 layout's pictures (v_coolant, v_oil, v_battery, v_fuel, v_car) from EVA Comfort's baked ones (c_*): the same shapes, their
brightness painted white-yellow instead of orange. Run after make_assets.py --comfort."""
import base64, json, os

PIC = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'app', 'hud', 'pictures')
ACC = {'': (255, 209, 26), '_s': (255, 72, 52), '_e': (92, 200, 255), '_n': (86, 200, 255)}      # Comfort yellow, Sport red, Eco Pro blue, Neo cyan
for suf, acc in ACC.items():
    for src, dst in (('c_coolant', 'v_coolant'), ('c_oil', 'v_oil'), ('c_battery', 'v_battery'), ('c_fuel', 'v_fuel'), ('c_car', 'v_car')):
        d = json.load(open(os.path.join(PIC, src + '.json')))
        raw = bytearray(base64.b64decode(d['rgba']))
        for i in range(0, len(raw), 4):
            r, g, b, a = raw[i:i + 4]
            l = min(1.0, max(r, g, b) / 255 * 1.15)
            for k in range(3):
                raw[i + k] = round(min(255, acc[k] * (0.4 + 0.6 * l) + 255 * 0.35 * l * l))
        json.dump({'w': d['w'], 'h': d['h'], 'rgba': base64.b64encode(bytes(raw)).decode('ascii')}, open(os.path.join(PIC, dst + suf + '.json'), 'w'), separators=(',', ':'))
        print(dst + suf, d['w'], d['h'])
