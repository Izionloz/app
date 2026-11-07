#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Writes eva/app/hud/layouts/eva_hud.json: the EVA design of the windshield HUD (EVA_Windshield_HUD, supplied by the owner:
NERV mark, drive mode, segmented rev bar, gear box, big speed, redline warning; no road, no coolant, fuel or character).
800x480 HUD target; the part the driver sees through the windshield is about 485x278 at x 120, y 100 (shared/visible.js), and BMW's
own content sits at the lower left of it, so nothing is put at x < 360, y > 312. On the glass black is no light: only the lines and
the numbers are drawn. Run it again after changing the numbers; it reads the fonts' cell heights from hud/fonts."""
import json, os

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.join(HERE, '..', 'app', 'hud')
OUT = os.path.join(APP, 'layouts', 'eva_hud.json')
WIN = (120, 100, 485, 278)


def cell(font):
    with open(os.path.join(APP, 'fonts', font + '.json')) as f:
        return json.load(f)['cellHeight']


RED, AMBER, VAL, SUB = [255, 67, 72, 255], [255, 159, 74, 255], [255, 170, 80, 255], [249, 113, 88, 255]
DIM = [247, 152, 98, 255]
# BMW's own white speed ("0 km/h", it cannot be removed): about x 287-353, y 335-372, estimated from the owner's photo
BMW = (282, 330, 80, 46)


def build(variant):
    W = []

    def text(id, x, y, w, t, font, color, align='left', z=5, **k):
        d = {'id': id, 'type': 'text', 'z': z, 'x': x, 'y': y, 'w': w, 'h': cell(font), 'text': t, 'font': font, 'color': color, 'align': align}
        d.update(k)
        W.append(d)

    own = variant == 'eva_hud'
    rail = {'x': 168, 'y': 156, 'w': 370 if own else 430, 'h': 24, 'segs': 38 if own else 44, 'gap': 2}
    frames = [
        {'x': 126, 'y': 150, 'w': 474, 'h': 2, 'kind': 2, 'color': 1},                 # under the header
        {'x': 130, 'y': 206, 'w': 96, 'h': 104, 'chamfer': 14},                        # gear box
        {'x': 244, 'y': 214, 'w': 2, 'h': 96, 'kind': 2},                              # centre, left rule
        {'x': 588, 'y': 214, 'w': 2, 'h': 96, 'kind': 2},                              # centre, right rule
    ]
    if not own:
        # BMW's speed is the speed: a rule over it with two ticks, and "SPEED" to its left
        frames += [{'x': 262, 'y': 326, 'w': 124, 'h': 2, 'kind': 2}, {'x': 262, 'y': 326, 'w': 2, 'h': 8, 'kind': 2},
                   {'x': 384, 'y': 326, 'w': 2, 'h': 8, 'kind': 2}]
    W.append({'id': 'eva', 'type': 'evadash', 'class': 'ambient', 'z': -10, 'x': WIN[0], 'y': WIN[1], 'w': WIN[2], 'h': WIN[3],
              'frames': frames, 'rpmMax': 8000,
              # the shift lights (Redline) in the header: they fill over the last 2000 rpm before the shift point, then strobe
              'lights': {'x': 262, 'y': 108, 'w': 160, 'h': 14, 'count': 10, 'tail': 0}, 'rails': [rail]})

    text('nerv', 130, 104, 150, 'NERV', 'w_title', RED, glow=True)
    text('hud', 131, 131, 160, 'HEAD-UP DISPLAY', 'w_small', SUB)
    text('modeCap', 440, 106, 156, 'DRIVE MODE', 'w_small', SUB, 'right')
    text('mode', 380, 122, 216, '{{mode}}', 'w_mode', RED, 'right', glow=True)

    text('rpmCap', 130, 158, 36, 'RPM', 'w_label', AMBER, z=6, byRpm=True)
    for i, k in enumerate(['0', '2K', '4K', '6K', '8K']):
        cx = rail['x'] + 5 + (rail['w'] - 10) * i / 4
        text('tick%d' % i, min(round(cx - 20), WIN[0] + WIN[2] - 44), 183, 40, k, 'w_small', DIM, 'center', z=6)
    if own:
        text('rpm', 542, 158, 56, '{{rpm}}', 'w_rpm', VAL, 'right', z=6, byRpm=True, rate=1)

    text('gearCap', 140, 212, 76, 'GEAR', 'w_small', SUB, 'center', z=7)
    text('gear', 135, 226, 86, '{{gear}}', 'w_gear', VAL, 'center', z=7, glow=True)       # P R N, or D with the engaged gear (D1 .. D8)
    text('gearWord', 138, 291, 80, '{{gearWord}}', 'w_small', SUB, 'center', z=7)

    if own:
        text('speed', 252, 222, 214, '{{speed}}', 'w_speed', VAL, 'right', z=8, glow=True, rate=1)
        text('speedUnit', 474, 278, 100, '{{u:speedLc}}', 'w_unit', [255, 187, 121, 255], z=8)
        # the warning is centred well to the right of BMW's speed
        text('alert', 380, 314, 200, '{{evaAlert}}', 'w_alert', RED, 'center', z=9, byRpm=True)
    else:
        # the big number is the rev count; the speed is BMW's own, under its rule
        text('rpm', 252, 222, 214, '{{rpm}}', 'w_speed', VAL, 'right', z=8, byRpm=True, glow=True, rate=1)
        text('rpmUnit', 474, 278, 100, 'rpm', 'w_unit', [255, 187, 121, 255], z=8)
        text('speedCap', 236, 346, 42, 'SPEED', 'w_small', SUB, 'right', z=9)
        text('alert', 400, 314, 200, '{{evaAlert}}', 'w_alert', RED, 'center', z=9, byRpm=True)

    name = 'EVA HUD' if own else 'EVA HUD (BMW speed)'
    with open(os.path.join(APP, 'layouts', variant + '.json'), 'w') as f:
        json.dump({'schemaVersion': 2, 'name': name, 'theme': 'eva',
                   '_about': 'After the owner\'s EVA_Windshield_HUD design. One effect layer (evadash) for the frames and the rev bar, text on top. Generated by eva/tools/gen_layout_hud.py.',
                   'widgets': W}, f, indent=1)
    print(variant, len(W), 'widgets')


build('eva_hud')
build('eva_hud_bmw')
