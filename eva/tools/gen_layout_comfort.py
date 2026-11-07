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
    d = {'id': id, 'type': 'text', 'class': 'alert', 'z': z, 'x': x, 'y': y, 'w': w, 'h': h, 'text': t, 'font': font, 'color': color, 'align': align}
    d.update(k)
    W.append(d)

def build(wide):
    global W
    W[:] = []
    GX = 1406 if wide else 1119                                   # the gear panel's left edge (it ends at x 1597)
    MY, MH = 332, 296                                            # the middle row: below the hood line everywhere, so it can use the full width
    MAP = (432, MY, 962, 268) if wide else (502, MY, 604, 268)  # the map window's frame (it ends at y 600, where the map target does)
    SPW = 394 if wide else 463                                    # the speed panel's width
    TYRE = (1610, MY, 284, MH)
    FY, FH = 636, 64                                             # the bottom row
    SEC = [(26, 531), (557, 427), (984, 366), (1460, 434)]       # its four sections: coolant, oil, battery, range; x 1350-1460 is left for BMW's gear box

    # the frames take the owner's reference render: corners cut one by one (cut: top-left, top-right, bottom-right, bottom-left), a glow
    framesA = [                                                         # evadash2 holds 8 frames a layer
        {'x': 190, 'y': 92, 'w': 555, 'h': 84, 'cut': [26, 0, 56, 0], 'glow': 1},        # header: left part, the middle plate, right part
        {'x': 745, 'y': 92, 'w': 430, 'h': 70, 'cut': [0, 0, 40, 40], 'glow': 1},
        {'x': 1175, 'y': 92, 'w': 555, 'h': 84, 'cut': [0, 26, 0, 56], 'glow': 1},
        {'x': MAP[0], 'y': MAP[1], 'w': MAP[2], 'h': MAP[3], 'cut': [6, 6, 6, 6], 'glow': 2},   # the map window (frames[3]: the test finds it)
        {'x': 70, 'y': 184, 'w': 1780, 'h': 140, 'chamfer': 24, 'glow': 1},               # rev panel
        {'x': 26, 'y': MY, 'w': SPW, 'h': MH, 'cut': [60, 22, 22, 60], 'glow': 1},        # speed
        {'x': TYRE[0], 'y': TYRE[1], 'w': TYRE[2], 'h': TYRE[3], 'chamfer': 22, 'glow': 1},
        {'x': GX, 'y': 340, 'w': 1597 - GX, 'h': 252, 'chamfer': 24, 'glow': 1},          # the gear box
    ]
    framesB = [
        {'x': 1622, 'y': 376, 'w': 260, 'h': 236, 'chamfer': 8, 'border': 1, 'color': 1},  # the box round the car
        {'x': 26, 'y': FY, 'w': 1868, 'h': FH, 'chamfer': 16, 'glow': 1},                 # the bottom row
        {'x': 1517, 'y': 104, 'w': 14, 'h': 50, 'kind': 3, 'border': 2, 'color': 2},       # slanted rules: in the header and between the bottom sections
        {'x': 541, 'y': FY + 8, 'w': 14, 'h': 48, 'kind': 3, 'border': 2, 'color': 2},
        {'x': 968, 'y': FY + 8, 'w': 14, 'h': 48, 'kind': 3, 'border': 2, 'color': 2},
        {'x': 1450, 'y': FY + 8, 'w': 14, 'h': 48, 'kind': 3, 'border': 2, 'color': 2},
    ]
    # the backdrop (class overlay: above the CarPlay map, which waze-on-cluster draws as a content layer when EVA Comfort puts it in the panel's scene,
    # and under the text and pictures, class alert): opaque, black, with the map window cut out of it; the rev rail, the shift lights and the coolant ramp
    W.append({'id': 'eva', 'type': 'evadash2', 'class': 'overlay', 'z': -10, 'x': 0, 'y': 0, 'w': 1920, 'h': 720,
              'frames': framesA, 'rpmMax': 8000, 'coolMax': 120,
              'hole': [440, 336, 946, 264] if wide else [506, 336, 594, 262], 'holeRadius': 6,       # inside COMFORT_WIDE_MAP / = COMFORT_MAP in main.js (the map target sits at x 416, y 120)
              'lights': {'x': 560, 'y': 192, 'w': 780, 'h': 20, 'count': 12, 'tail': 0},
              'rails': [{'x': 100, 'y': 228, 'w': 1420, 'h': 40, 'segs': 64, 'gap': 3},
                        {'x': 100, 'y': 682, 'w': 426, 'h': 14, 'segs': 28, 'gap': 3, 'ramp': True}]})
    # a second layer over it with nothing but what is drawn: the gear box, the car's box, the bottom row, the slanted rules, the oil ramp and the fuel rail
    W.append({'id': 'eva2', 'type': 'evadash2', 'class': 'overlay', 'z': -9, 'x': 0, 'y': 0, 'w': 1920, 'h': 720, 'bg': False,
              'frames': framesB, 'rpmMax': 8000,
              'rails': [{'x': 640, 'y': 682, 'w': 310, 'h': 14, 'segs': 22, 'gap': 3, 'ramp': True, 'signal': 'oil', 'max': 140},
                        {'x': 1768, 'y': 664, 'w': 96, 'h': 14, 'segs': 8, 'gap': 3, 'plain': True, 'signal': 'fuel', 'max': 1, 'color': [1.0, 0.72, 0.3]}]})

    text('title', 232, 98, 330, 41, 'VEHICLE STATUS', 'e_title', TITLE, glow=True)
    text('sub', 233, 144, 400, 18, 'COMFORT MODE / NAVIGATION', 'e_sub', SUB)
    text('comfort', 745, 100, 430, 41, '{{mode}}', 'e_title', WHITE, 'center', glow=True)
    text('clock', 1360, 112, 140, 46, '{{time}}', 'e_clock', VAL, 'right', glow=True)
    text('amb', 1550, 110, 100, 39, '{{ambient}}', 'e_val', VAL, 'right')
    text('ambU', 1656, 113, 50, 37, '{{u:temp}}', 'e_unit', TITLE)

    text('rpmLabel', 112, 190, 160, 28, 'ENGINE RPM', 'e_label', VAL, byRpm=True, z=5)
    text('coldNote', 276, 191, 250, 24, '{{coldNote}}', 'e_mono', [255, 173, 84, 255], z=5)
    text('alert', 1350, 191, 170, 24, '{{evaAlert}}', 'e_mono', VAL, 'right', byRpm=True, z=5)
    for i in range(9):
        x = 100 + round(i * 1420 / 8)
        t = '%d' % (i * 1000)
        if i == 0:
            text('tick0', x, 278, 80, 24, t, 'e_tick', DIM, 'left', z=5)
        elif i == 8:
            text('tick8', x - 80, 278, 80, 24, t, 'e_tick', DIM, 'right', z=5)
        else:
            text('tick%d' % i, x - 40, 278, 80, 24, t, 'e_tick', DIM, 'center', z=5)
    text('rpm', 1530, 206, 230, 70, '{{rpm}}', 'e_rpm', VAL, 'right', byRpm=True, glow=True, z=5, rate=1)
    text('rpmUnit', 1768, 236, 76, 37, 'rpm', 'e_unit', TITLE, z=5)

    text('speed', SPW // 2 + 26 - 172, 350, 345, 171, '{{speed}}', 'e_speed', VAL, 'center', glow=True, z=7, rate=1)
    text('speedUnit', SPW // 2 + 26 - 172, 522, 345, 58, '{{u:speedLc}}', 'e_unitbig', [255, 187, 121, 255], 'center', z=7)

    GC = (GX + 1597) // 2                                       # the gear panel's middle
    if wide:
        text('gearCap', GX + 14, 352, 120, 28, 'GEAR', 'e_label', [255, 159, 112, 255], 'left', z=11)
        text('gear', GC - 70, 410, 140, 89, '{{gear}}', 'e_gearn', VAL, 'center', glow=True, z=11)
        step, bw = 34, 32
        word = (GC - 85, 170)
    else:
        text('gearCap', GX + 20, 352, 120, 28, 'GEAR', 'e_label', [255, 159, 112, 255], 'left', z=11)
        text('gear', GC - 70, 410, 140, 89, '{{gear}}', 'e_gearn', VAL, 'center', glow=True, z=11)
        step, bw = 62, 52
        word = (GC - 165, 330)
    for k, L in enumerate('PRNDM'):                              # the selector row: dim letters, the engaged one lit over its own
        text('selDim' + L, GC + (k - 2) * step - bw // 2, 524, bw, 30, L, 'e_label', [150, 84, 62, 255], 'center', z=8)
        text('sel' + L, GC + (k - 2) * step - bw // 2, 524, bw, 30, '{{sel:%s}}' % L, 'e_label', [255, 190, 110, 255], 'center', glow=True, z=11)
    text('gearWord', word[0], 560, word[1], 24, '{{gearWord}}', 'e_mono', SUB, 'center', z=11)

    text('tyreCap', 1630, 338, 200, 28, 'TYRE PRESSURE', 'e_label', HEAD, z=9)
    for key, x, y, al in (('FL', 1624, 435, 'left'), ('FR', 1801, 435, 'right'), ('RL', 1624, 514, 'left'), ('RR', 1801, 514, 'right')):
        text('tyre' + key, x, y, 70 if al == 'left' else 79, 31, '{{tyreP:%s}} {{u:pressure}}' % key, 'e_tp', [255, 214, 160, 255], al, z=9)
        text('tyreT' + key, x, y + 31, 70 if al == 'left' else 79, 31, '{{tyreT:%s}} {{u:temp}}' % key, 'e_tp', [236, 150, 110, 255], al, z=9)


    def picture(id, name, x, y, w, h, z):
        W.append({'id': id, 'type': 'picture', 'class': 'alert', 'z': z, 'x': x, 'y': y, 'w': w, 'h': h, 'name': name})

    # the owner's EVA_HUD_Icons pack: the car with its tyre sensors, the red slashed stripes and an icon in each section of the bottom row; small hazard dashes
    picture('car', 'c_car', 1714, 402, 77, 156, 9)       # symmetric, centred on x 1752
    picture('dashHead', 'c_dash5', 575, 112, 139, 10, 5)
    picture('dashHead2', 'c_dash5', 1205, 112, 139, 10, 5)
    picture('stripes', 'c_stripes', 26 + 64, 588, 173, 28, 7)
    picture('dashTyre', 'c_dash3', 1790, 617, 83, 10, 9)

    ICONS = {'COOLANT': ('c_coolant', 45), 'OIL': ('c_oil', 52), 'BATTERY': ('c_battery', 41), 'RANGE': ('c_fuel', 36)}
    for (cx, cw), cap, val, unit, uw in zip(SEC, ('COOLANT', 'OIL', 'BATTERY', 'RANGE'), ('{{coolant}}', '{{oil}}', '{{battery}}', '{{range}}'),
                                             ('{{u:temp}}', '{{u:temp}}', '%', '{{u:distLc}}'), (50, 50, 40, 60)):
        right = cx + cw - 19
        if cap == 'RANGE':
            right = 1740                                          # the fuel rail with E and F takes the right of the section
        name, iw = ICONS[cap]
        ix = cx + 75 if cap == 'OIL' else cx + (12 if cap == 'RANGE' else 22)                 # BMW's seat-belt light covers x 587-626 on the oil section
        picture('ic_' + cap.lower(), name, ix, 641, iw, 38, 10)
        text('cap_' + cap.lower(), ix + iw + (8 if cap == 'RANGE' else 14), 646, {'OIL': 72, 'RANGE': 68}.get(cap, 110), 28, cap, 'e_label', HEAD, z=10)
        vw = 72 if cap == 'RANGE' else 110
        text('val_' + cap.lower(), right - uw - 8 - vw, 641, vw, 39, val, 'e_val', VAL, 'right', z=10)
        text('u_' + cap.lower(), right - uw, 644, uw, 37, unit, 'e_unit', TITLE, z=10)
    text('fuelE', 1748, 640, 16, 24, 'E', 'e_mono', SUB, 'center', z=10)
    text('fuelF', 1868, 640, 16, 24, 'F', 'e_mono', SUB, 'center', z=10)


    name = 'EVA Comfort (big map)' if wide else 'EVA Comfort'
    out = os.path.join(os.path.dirname(OUT), 'eva_comfort_wide.json' if wide else 'eva_comfort.json')
    with open(out, 'w') as f:
        json.dump({'schemaVersion': 2, 'name': name, 'theme': 'eva',
                   '_about': 'After the EVA_Comfort_Cluster design: the EVA frames with a window for the map%s. Generated by eva/tools/gen_layout_comfort.py.' % (' (a wide one, the map cropped to it)' if wide else ''),
                   'widgets': W}, f, indent=1)
    print(out.split(os.sep)[-1], len(W), 'widgets')


build(False)
build(True)
