#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Writes eva/app/hud/layouts/eva.json (the layout is data: edit the numbers here and run it again).
1920x720 cluster; the hood hides the top corners, BMW's black gear box sits at x1406-1597 y342-419 and its belt light at
x587-626 y663-700 (shared/visible.js), so nothing important goes there."""
import json, os

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'app', 'hud', 'layouts', 'eva.json')
TITLE, SUB, DIM = [255, 98, 74, 255], [255, 118, 91, 255], [247, 152, 98, 255]
HEAD, VAL, CLOCK = [255, 172, 112, 255], [255, 173, 97, 255], [255, 153, 92, 255]
W = []

def text(id, x, y, w, h, t, font, color, align='left', z=5, **k):
    d = {'id': id, 'type': 'text', 'z': z, 'x': x, 'y': y, 'w': w, 'h': h, 'text': t, 'font': font, 'color': color, 'align': align}
    d.update(k)
    W.append(d)

frames = [
    {'x': 190, 'y': 92, 'w': 1540, 'h': 84, 'chamfer': 24},                       # header
    {'x': 110, 'y': 184, 'w': 1700, 'h': 140, 'chamfer': 26},                     # rev panel
    {'x': 110, 'y': 332, 'w': 1700, 'h': 240, 'kind': 1},                         # core: side lines and a bottom line
    {'x': 140, 'y': 342, 'w': 200, 'h': 210, 'chamfer': 24},                      # gear
    {'x': 372, 'y': 346, 'w': 2, 'h': 202, 'kind': 2},                            # speed, left rule
    {'x': 1100, 'y': 346, 'w': 2, 'h': 202, 'kind': 2},                           # speed, right rule
    {'x': 1130, 'y': 404, 'w': 250, 'h': 2, 'kind': 2, 'color': 1},               # rule in the label block
    {'x': 110, 'y': 580, 'w': 650, 'h': 58, 'chamfer': 16},                       # coolant
    {'x': 770, 'y': 580, 'w': 330, 'h': 58, 'chamfer': 16},                       # oil
    {'x': 1110, 'y': 580, 'w': 270, 'h': 58, 'chamfer': 16},                      # range
    {'x': 1390, 'y': 580, 'w': 420, 'h': 58, 'chamfer': 16},                      # outside
]
W.append({'id': 'eva', 'type': 'evadash', 'class': 'ambient', 'z': -10, 'x': 0, 'y': 0, 'w': 1920, 'h': 720,
          'frames': frames, 'stripe': [232, 164, 330, 6], 'rpmMax': 8000, 'coolMax': 120,
          # the shift lights (Redline): 12 fill over the last 2000 rpm before the shift point, then all strobe
          'lights': {'x': 330, 'y': 194, 'w': 1010, 'h': 20, 'count': 12, 'tail': 0},
          'rails': [{'x': 130, 'y': 228, 'w': 1210, 'h': 44, 'segs': 48, 'gap': 4},
                    {'x': 345, 'y': 588, 'w': 270, 'h': 42, 'segs': 24, 'gap': 3, 'ramp': True}]})
# the pilot: x 1610 keeps clear of BMW's gear box (x to 1597)
W.append({'id': 'pilot', 'type': 'picture', 'class': 'content', 'z': 1, 'own': True, 'x': 1610, 'y': 332, 'w': 200, 'h': 240, 'name': 'pilot'})

text('title', 232, 98, 520, 41, 'VEHICLE STATUS', 'e_title', TITLE, glow=True)
text('sub', 233, 144, 420, 18, 'TACTICAL DRIVE DISPLAY', 'e_sub', SUB)
# the 12 V battery's charge (CDS statusBattery2), in the header between the title and the clock
# the boost pressure (FES sport display, as M Vitals reads it): bar, or psi with the US units
text('boostCap', 790, 112, 86, 28, 'BOOST', 'e_label', HEAD)
text('boost', 878, 108, 100, 39, '{{boost}}', 'e_val', VAL, 'right')
text('boostU', 986, 111, 50, 37, '{{u:boost}}', 'e_unit', TITLE)
text('batCap', 1070, 112, 136, 28, 'BATTERY', 'e_label', HEAD)
text('bat', 1210, 108, 90, 39, '{{battery}}', 'e_val', VAL, 'right')
text('batU', 1308, 111, 40, 37, '%', 'e_unit', TITLE)
text('clock', 1430, 112, 270, 46, '{{time}}', 'e_clock', CLOCK, 'right', glow=True)

text('rpmLabel', 132, 190, 300, 28, 'ENGINE RPM', 'e_label', VAL, byRpm=True, z=6)
ticks = [('0', 130, 80, 'left'), ('2000', 353, 160, 'center'), ('4000', 655, 160, 'center'), ('6000', 958, 160, 'center'), ('8000 RPM', 1180, 160, 'right')]
for i, (t, x, w, a) in enumerate(ticks):
    text('tick%d' % i, x, 282, w, 24, t, 'e_tick', DIM, a, z=6)
text('rpm', 1380, 204, 290, 70, '{{rpm}}', 'e_rpm', VAL, 'right', byRpm=True, glow=True, z=6, rate=1)
text('rpmUnit', 1684, 236, 100, 37, 'rpm', 'e_unit', TITLE, z=6)
text('alert', 1500, 290, 232, 24, '{{evaAlert}}', 'e_mono', VAL, 'right', byRpm=True, z=6)

text('gearCap', 162, 356, 150, 28, 'GEAR', 'e_label', [255, 159, 112, 255], z=7)
# the gear as BMW's selector shows it: P R N, or D with the engaged gear (D1 .. D8), S / M by the shifter programme
text('gear', 160, 408, 160, 89, '{{gear}}', 'e_gearn', VAL, 'center', glow=True, z=7)
text('gearWord', 156, 516, 170, 24, '{{gearWord}}', 'e_mono', SUB, 'center', z=7)

text('speed', 392, 362, 440, 171, '{{speed}}', 'e_speed', VAL, 'right', glow=True, z=8, rate=1)
text('speedUnit', 850, 466, 200, 58, '{{u:speedLc}}', 'e_unitbig', [255, 187, 121, 255], z=8)
text('cruise', 392, 540, 440, 24, '{{cruise}}', 'e_mono', [64, 230, 120, 255], 'right', z=8)

text('modeCap', 1130, 350, 250, 24, 'DRIVE MODE', 'e_mono', SUB, z=8)
text('mode', 1130, 374, 250, 24, '{{mode}}', 'e_mono', VAL, z=8)
# the last shift scored against the shift point (Redline): the gears, the rpm and the verdict, coloured by it
text('shiftCap', 1130, 410, 250, 24, 'LAST SHIFT', 'e_mono', SUB, z=8)
text('shift', 1130, 436, 262, 32, '{{lastGears}}  {{lastShift}}  {{verdict}}', 'e_tyre', VAL, z=8, colorBy='verdict')
# tyre pressure (TPMS): a caption and two rows of two, in bar (psi with the US units), clear of BMW's gear box (x 1406-1597)
text('tyreCap', 1130, 474, 250, 24, 'TYRE PRESSURE', 'e_mono', SUB, z=8)
text('tyreF', 1130, 500, 260, 32, 'FL {{tyreP:FL}}   FR {{tyreP:FR}}', 'e_tyre', VAL, z=8)
text('tyreR', 1130, 532, 260, 32, 'RL {{tyreP:RL}}   RR {{tyreP:RR}}', 'e_tyre', VAL, z=8)

text('coolCap', 142, 594, 200, 28, 'COOLANT', 'e_label', HEAD, z=9)
text('cool', 625, 590, 90, 39, '{{coolant}}', 'e_val', VAL, 'right', z=9)
text('coolU', 722, 593, 36, 37, '{{u:temp}}', 'e_unit', TITLE, z=9)
text('oilCap', 802, 594, 100, 28, 'OIL', 'e_label', HEAD, z=9)
text('oil', 905, 590, 130, 39, '{{oil}}', 'e_val', VAL, 'right', z=9)
text('oilU', 1042, 593, 50, 37, '{{u:temp}}', 'e_unit', TITLE, z=9)
text('rangeCap', 1130, 594, 92, 28, 'RANGE', 'e_label', HEAD, z=9)
text('range', 1226, 590, 92, 39, '{{range}}', 'e_val', VAL, 'right', z=9)
text('rangeU', 1324, 593, 52, 37, '{{u:distLc}}', 'e_unit', TITLE, z=9)
text('outCap', 1422, 594, 150, 28, 'OUTSIDE', 'e_label', HEAD, z=9)
text('out', 1580, 590, 130, 39, '{{ambient}}', 'e_val', VAL, 'right', z=9)
text('outU', 1720, 593, 70, 37, '{{u:temp}}', 'e_unit', TITLE, z=9)
# the cold-engine guard's note, left of the rev warning
text('coldNote', 1380, 316, 220, 24, '{{coldNote}}', 'e_mono', [255, 173, 84, 255], 'right', z=6)

with open(OUT, 'w') as f:
    json.dump({'schemaVersion': 2, 'name': 'EVA', 'theme': 'eva',
               '_about': 'After the EVA HUD design: one effect layer (evadash) for the frames, rails and stripe; text and a picture on top. Generated by eva/tools/gen_layout.py.',
               'widgets': W}, f, indent=1)
print(len(W), 'widgets')
