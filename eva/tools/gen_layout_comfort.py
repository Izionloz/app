#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Writes eva/app/hud/layouts/eva_comfort.json: the cluster layout after the owner's EVA_Comfort_Cluster design (header with COMFORT,
rev panel, speed, a window for the map, gear, tyre pressures, a bottom row of four). 1920x720.
Edit the numbers here and run it again. Differences from the design, and why:
  - the map window is a see-through hole in the backdrop (evadash `hole`): BMW's / the HUD map service's map shows through it;
  - BMW's black gear box (x1406-1597 y342-419, shared/visible.js) stays where it is, so the gear section is wider than in the design and
    keeps that corner free, and the tyre section starts right of it (the map window is 800 wide instead of 830);
  - the battery shows its charge in % (the voltage is not on the signals the app can reach)."""
import json, os

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'app', 'hud', 'layouts', 'eva_comfort.json')
TITLE, SUB, DIM = [255, 98, 74, 255], [255, 118, 91, 255], [247, 152, 98, 255]
HEAD, VAL, WHITE = [255, 172, 112, 255], [255, 173, 97, 255], [255, 240, 217, 255]
W = []

def text(id, x, y, w, h, t, font, color, align='left', z=5, **k):
    d = {'id': id, 'type': 'text', 'z': z, 'x': x, 'y': y, 'w': w, 'h': h, 'text': t, 'font': font, 'color': color, 'align': align}
    d.update(k)
    W.append(d)

MY, MH = 332, 296                                            # the middle row: below the hood line everywhere, so it can use the full width
MAP = (404, MY, 800, MH)                                     # the map window's frame; the hole is inset by 3
GEAR = (1217, MY, 380, MH)
TYRE = (1610, MY, 284, MH)
CARDS = [(26, 519), (557, 415), (984, 386), (1382, 511)]     # coolant, oil, battery, range (y 636, h 64)
FY, FH = 636, 64

framesA = [
    {'x': 190, 'y': 92, 'w': 1540, 'h': 84, 'chamfer': 24},                # header (the hood hides its corners, as in the EVA layout)
    {'x': 70, 'y': 184, 'w': 1780, 'h': 140, 'chamfer': 24},               # rev panel
    {'x': 26, 'y': MY, 'w': 365, 'h': MH, 'chamfer': 22},                  # speed
    {'x': MAP[0], 'y': MAP[1], 'w': MAP[2], 'h': MAP[3], 'chamfer': 22},   # the map window (frames[3]: the test finds it)
    {'x': GEAR[0], 'y': GEAR[1], 'w': GEAR[2], 'h': GEAR[3], 'chamfer': 22},
    {'x': TYRE[0], 'y': TYRE[1], 'w': TYRE[2], 'h': TYRE[3], 'chamfer': 22},
    {'x': 1235, 'y': 386, 'w': 150, 'h': 140, 'chamfer': 34},              # the gear box
    {'x': 710, 'y': 152, 'w': 500, 'h': 2, 'kind': 2, 'color': 2},         # the line under the drive mode
] + [{'x': x, 'y': FY, 'w': w, 'h': FH, 'chamfer': 14} for x, w in CARDS]
framesB = [
    {'x': 1712, 'y': 384, 'w': 80, 'h': 190, 'chamfer': 28},               # the car
    {'x': 1698, 'y': 418, 'w': 14, 'h': 46, 'kind': 2, 'color': 2},        # its tyres
    {'x': 1792, 'y': 418, 'w': 14, 'h': 46, 'kind': 2, 'color': 2},
    {'x': 1698, 'y': 502, 'w': 14, 'h': 46, 'kind': 2, 'color': 2},
    {'x': 1792, 'y': 502, 'w': 14, 'h': 46, 'kind': 2, 'color': 2},
    {'x': 1621, 'y': 370, 'w': 262, 'h': 2, 'kind': 2, 'color': 1},        # the rule under the tyre caption
    {'x': 1230, 'y': 370, 'w': 150, 'h': 2, 'kind': 2, 'color': 1},        # ... and under the gear caption
]
# the backdrop: opaque, black, with the map window cut out of it; the rev rail and the coolant ramp
W.append({'id': 'eva', 'type': 'evadash', 'class': 'ambient', 'z': -10, 'x': 0, 'y': 0, 'w': 1920, 'h': 720,
          'frames': framesA, 'stripe': [585, 150, 110, 6], 'rpmMax': 8000, 'coolMax': 120,
          'hole': [MAP[0] + 3, MAP[1] + 3, MAP[2] - 6, MAP[3] - 6], 'holeRadius': 42,
          'lights': {'x': 560, 'y': 192, 'w': 780, 'h': 20, 'count': 12, 'tail': 0},
          'rails': [{'x': 100, 'y': 228, 'w': 1420, 'h': 40, 'segs': 48, 'gap': 4},
                    {'x': 46, 'y': 682, 'w': 480, 'h': 14, 'segs': 32, 'gap': 3, 'ramp': True}]})
# a second layer over it with nothing but what is drawn: the car, the oil ramp
W.append({'id': 'eva2', 'type': 'evadash', 'class': 'ambient', 'z': -9, 'x': 0, 'y': 0, 'w': 1920, 'h': 720, 'bg': False,
          'frames': framesB, 'coolMax': 140, 'rail1Signal': 'oil', 'rpmMax': 8000,
          'rails': [{'x': 0, 'y': 0, 'w': 0, 'h': 0, 'segs': 1, 'ramp': True},
                    {'x': 640, 'y': 682, 'w': 310, 'h': 14, 'segs': 22, 'gap': 3, 'ramp': True}]})

text('title', 232, 98, 520, 41, 'VEHICLE STATUS', 'e_title', TITLE, glow=True)
text('sub', 233, 144, 340, 18, 'TACTICAL DRIVE DISPLAY', 'e_sub', SUB)
text('comfort', 710, 102, 500, 41, '{{mode}}', 'e_title', WHITE, 'center', glow=True)
text('amb', 1390, 110, 100, 39, '{{ambient}}', 'e_val', VAL, 'right')
text('ambU', 1496, 113, 50, 37, '{{u:temp}}', 'e_unit', TITLE)
text('clock', 1430, 112, 270, 46, '{{time}}', 'e_clock', VAL, 'right', glow=True)

text('rpmLabel', 112, 190, 160, 28, 'ENGINE RPM', 'e_label', VAL, byRpm=True, z=6)
text('coldNote', 276, 191, 250, 24, '{{coldNote}}', 'e_mono', [255, 173, 84, 255], z=6)
text('alert', 1350, 191, 170, 24, '{{evaAlert}}', 'e_mono', VAL, 'right', byRpm=True, z=6)
for i in range(9):
    x = 100 + round(i * 1420 / 8)
    t = '%d' % (i * 1000)
    if i == 0:
        text('tick0', x, 278, 80, 24, t, 'e_tick', DIM, 'left', z=6)
    elif i == 8:
        text('tick8', x - 80, 278, 80, 24, t, 'e_tick', DIM, 'right', z=6)
    else:
        text('tick%d' % i, x - 40, 278, 80, 24, t, 'e_tick', DIM, 'center', z=6)
text('rpm', 1530, 206, 230, 70, '{{rpm}}', 'e_rpm', VAL, 'right', byRpm=True, glow=True, z=6, rate=1)
text('rpmUnit', 1768, 236, 76, 37, 'rpm', 'e_unit', TITLE, z=6)

text('speed', 36, 342, 345, 171, '{{speed}}', 'e_speed', VAL, 'center', glow=True, z=8, rate=1)
text('speedUnit', 36, 514, 345, 58, '{{u:speedLc}}', 'e_unitbig', [255, 187, 121, 255], 'center', z=8)
text('speedCap', 26, 596, 365, 24, 'SPEED', 'e_mono', SUB, 'center', z=8)

text('gearCap', 1230, 339, 150, 28, 'GEAR', 'e_label', [255, 159, 112, 255], 'center', z=8)
text('gear', 1235, 411, 150, 89, '{{gear}}', 'e_gearn', VAL, 'center', glow=True, z=8)
text('gearWord', 1217, 548, 190, 24, '{{gearWord}}', 'e_mono', SUB, 'center', z=8)

text('tyreCap', 1621, 339, 70, 28, 'TYRE', 'e_label', HEAD, z=8)
text('tyreU', 1692, 346, 60, 37, '{{u:pressure}}', 'e_unit', TITLE, z=8)
for key, x, y, al in (('FL', 1620, 422, 'left'), ('FR', 1814, 422, 'right'), ('RL', 1620, 506, 'left'), ('RR', 1814, 506, 'right')):
    text('tyre' + key, x, y, 70, 39, '{{tyreP:%s}}' % key, 'e_val', VAL, al, z=8)

for (cx, cw), cap, val, unit, uw in zip(CARDS, ('COOLANT', 'OIL', 'BATTERY', 'RANGE'), ('{{coolant}}', '{{oil}}', '{{battery}}', '{{range}}'),
                                         ('{{u:temp}}', '{{u:temp}}', '%', '{{u:distLc}}'), (50, 50, 40, 60)):
    right = cx + cw - 19
    capx = cx + 75 if cap == 'OIL' else cx + 22              # BMW's seat-belt light covers x 587-626 here
    text('cap_' + cap.lower(), capx, 646, 140, 28, cap, 'e_label', HEAD, z=9)
    text('val_' + cap.lower(), right - uw - 8 - 110, 641, 110, 39, val, 'e_val', VAL, 'right', z=9)
    text('u_' + cap.lower(), right - uw, 644, uw, 37, unit, 'e_unit', TITLE, z=9)

with open(OUT, 'w') as f:
    json.dump({'schemaVersion': 2, 'name': 'EVA Comfort', 'theme': 'eva',
               '_about': 'After the EVA_Comfort_Cluster design: the EVA frames with a window for the map. Generated by eva/tools/gen_layout_comfort.py.',
               'widgets': W}, f, indent=1)
print(len(W), 'widgets')
