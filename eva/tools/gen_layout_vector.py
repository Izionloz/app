#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Writes eva/app/hud/layouts/eva_vector.json: "EVA Vector", a modern, sporty, science-fiction cluster of our own: black, steel-blue lines with
hot orange accents, slanted panels, two big glass dials with a technical look (segmented ring, hairline rings, bracket corners, glow) and
seven-segment numbers, a wedge with the gear in the middle, chips for boost, torque and load, the tyres, stars and light streaks behind. 1920x720,
no map. BMW's black gear box (x1406-1597 y342-419) sits over the right dial's middle: the speed digits are under it."""
import json, math, os

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'app', 'hud', 'layouts', 'eva_vector.json')
CY, R, RW = 380, 205, 24
LC, RC = 400, 1520
START, SWEEP = 215, 250
ACC, HOT, WHITE, GREY = [80, 215, 255, 255], [255, 112, 52, 255], [255, 255, 255, 255], [160, 182, 204, 255]
ACC_F = [0.28, 0.86, 1.0]
PAL = [[0.52, 0.74, 0.96], [0.15, 0.22, 0.32], [1.0, 0.42, 0.14]]
W = []


def text(id, x, y, w, h, t, font, color, align='left', z=9, **k):
    d = {'id': id, 'type': 'text', 'class': 'alert', 'z': z, 'x': x, 'y': y, 'w': w, 'h': h, 'text': t, 'font': font, 'color': color, 'align': align}
    d.update(k)
    W.append(d)


def picture(id, name, x, y, w, h, z):
    W.append({'id': id, 'type': 'picture', 'class': 'alert', 'z': z, 'x': x, 'y': y, 'w': w, 'h': h, 'name': name})


FY, FH = 636, 64
SEC = [(26, 531), (557, 427), (984, 366), (1460, 434)]
frames = [
    {'x': 700, 'y': 92, 'w': 520, 'h': 64, 'cut': [30, 0, 30, 0], 'glow': 1},                     # the bar: mode and clock
    {'x': 760, 'y': 186, 'w': 400, 'h': 262, 'cut': [0, 56, 0, 56], 'glow': 2},                   # the gear wedge
    {'x': 700, 'y': 466, 'w': 150, 'h': 72, 'cut': [16, 0, 16, 0], 'glow': 1},                    # the three chips
    {'x': 885, 'y': 466, 'w': 150, 'h': 72, 'cut': [16, 0, 16, 0], 'glow': 1},
    {'x': 1070, 'y': 466, 'w': 150, 'h': 72, 'cut': [16, 0, 16, 0], 'glow': 1},
    {'x': 26, 'y': FY, 'w': 1868, 'h': FH, 'chamfer': 16, 'glow': 1},                             # the bottom row
    {'x': 664, 'y': 100, 'w': 14, 'h': 48, 'kind': 3, 'border': 2, 'color': 2},                   # slanted rules at the bar's ends
    {'x': 1242, 'y': 100, 'w': 14, 'h': 48, 'kind': 3, 'border': 2, 'color': 2},
]
W.append({'id': 'eva', 'type': 'evadash2', 'class': 'overlay', 'z': -10, 'x': 0, 'y': 0, 'w': 1920, 'h': 720, 'frames': frames, 'pal': PAL, 'rpmMax': 8000,
          'coolMax': 120, 'rails': [{'x': 640, 'y': 682, 'w': 310, 'h': 14, 'segs': 22, 'gap': 3, 'ramp': True, 'signal': 'oil', 'max': 140},
                                    {'x': 100, 'y': 682, 'w': 426, 'h': 14, 'segs': 28, 'gap': 3, 'ramp': True}]})
needle = {'inner': 150, 'outer': R + RW // 2 + 2, 'width': 3}
# the left dial's layer is the whole cluster (stars, the vignette, the warp streaks from the middle); the right dial is a box above it
W.append({'id': 'dialL', 'type': 'evadial', 'class': 'overlay', 'z': -9, 'x': 0, 'y': 0, 'w': 1920, 'h': 720,
          'dial': {'cx': LC, 'cy': CY, 'r': R, 'width': RW, 'start': START, 'sweep': SWEEP, 'majors': 8, 'minors': 4, 'majorLen': 24, 'minorLen': 11,
                   'rpmMax': 8000, 'clip': 250, 'flat': 3, 'origin': [960, CY], 'yellow': ACC_F, 'red': [1.0, 0.22, 0.14], 'needle': needle,
                   'leds': {'radius': R + 42, 'dot': 6, 'count': 11, 'from': 4000, 'wings': True}}})
W.append({'id': 'dialR', 'type': 'evadial', 'class': 'overlay', 'z': -8, 'x': RC - 270, 'y': 110, 'w': 540, 'h': 540,
          'dial': {'cx': RC, 'cy': CY, 'r': R, 'width': RW, 'start': START, 'sweep': SWEEP, 'majors': 8, 'minors': 4, 'majorLen': 24, 'minorLen': 11,
                   'signal': 'speed', 'redFrom': 1.0, 'clip': 250, 'flat': 3, 'fx': False, 'yellow': ACC_F, 'red': [1.0, 0.22, 0.14], 'needle': needle}})

text('mode', 736, 100, 296, 41, '{{mode}}', 'e_title', WHITE, glow=True)
text('clock', 1040, 102, 150, 46, '{{time}}', 'e_clock', WHITE, 'right', glow=True)

for i in range(9):
    a = math.radians(START + SWEEP * i / 8)
    for cx, tok, col, zz, nm in ((LC, str(i), HOT if i >= 7 else WHITE, 6, 'rn'), (RC, '{{spd:%d}}' % i, WHITE, 7, 'sn')):
        if nm == 'sn' and i in (0, 8):
            continue                                            # the right dial's end labels would sit on the speed digits
        x, y = cx + 140 * math.sin(a), CY - 140 * math.cos(a)
        text('%s%d' % (nm, i), round(x) - 22, round(y) - 12, 44, 24, tok, 'e_tick', col, 'center', z=zz)

text('rpm', LC - 80, 350, 160, 56, '{{rpm}}', 'e_segs', WHITE, 'center', z=6, rate=1)
text('rpmCap', LC - 40, 414, 80, 28, 'RPM', 'e_label', ACC, 'center', z=6)
text('speed', RC - 100, 432, 200, 100, '{{speed}}', 'e_seg', WHITE, 'center', z=7, rate=1)
text('speedUnit', RC - 60, 538, 120, 37, '{{u:speedLc}}', 'e_unit', HOT, 'center', z=7)
text('cruise', RC - 90, 588, 180, 28, '{{cruise}}', 'e_mono', [64, 230, 120, 255], 'center', z=9)

GC = 960
text('gearCap', GC - 60, 194, 120, 28, 'GEAR', 'e_label', ACC, 'center', z=9)
text('gear', GC - 88, 232, 176, 127, '{{gear}}', 'e_gearx', WHITE, 'center', z=9, glow=True)
for k, L in enumerate('PRNDSM'):
    x = GC + round((k - 2.5) * 44) - 14
    text('selDim' + L, x, 372, 28, 30, L, 'e_label', [70, 88, 108, 255], 'center', z=9)
    text('sel' + L, x, 372, 28, 30, '{{selx:%s}}' % L, 'e_label', HOT, 'center', z=10, glow=True)
for i, (cap, val, unit) in enumerate((('BOOST', '{{boost}}', '{{u:boost}}'), ('TORQUE', '{{torque}}', '{{u:torque}}'), ('LOAD', '{{torquePct}}', '%'))):
    x = 712 + 185 * i
    text('dCap%d' % i, x, 472, 80, 18, cap, 'e_sub', ACC, 'right', z=9)
    text('dVal%d' % i, x, 490, 80, 39, val, 'e_val', WHITE, 'right', z=9)
    text('dUnit%d' % i, x + 82, 494, 46, 37, unit, 'e_unit', GREY, 'left', z=9)
for i, key in enumerate(('FL', 'FR', 'RL', 'RR')):
    x = 724 + 120 * i
    text('tyreN' + key, x, 556, 100, 18, key, 'e_sub', ACC, z=9)
    text('tyre' + key, x, 574, 100, 31, '{{tyreP:%s}}' % key, 'e_tp', WHITE, z=9)

ICONS = {'COOLANT': ('v_coolant_n', 45), 'OIL': ('v_oil_n', 52), 'BATTERY': ('v_battery_n', 41), 'RANGE': ('v_fuel_n', 36)}
for (cx, cw), cap, val, unit, uw in zip(SEC, ('COOLANT', 'OIL', 'BATTERY', 'RANGE'), ('{{coolant}}', '{{oil}}', '{{battery}}', '{{range}}'),
                                         ('{{u:temp}}', '{{u:temp}}', '%', '{{u:distLc}}'), (50, 50, 40, 60)):
    right = cx + cw - 19
    name, iw = ICONS[cap]
    ix = cx + 75 if cap == 'OIL' else cx + (12 if cap == 'RANGE' else 22)
    picture('ic_' + cap.lower(), name, ix, 641, iw, 38, 11)
    text('cap_' + cap.lower(), ix + iw + (8 if cap == 'RANGE' else 14), 646, {'OIL': 72, 'RANGE': 68}.get(cap, 110), 28, cap, 'e_label', ACC, z=11)
    vw = 72 if cap == 'RANGE' else 110
    text('val_' + cap.lower(), right - uw - 8 - vw, 641, vw, 39, val, 'e_val', WHITE, 'right', z=11)
    text('u_' + cap.lower(), right - uw, 644, uw, 37, unit, 'e_unit', GREY, z=11)

with open(OUT, 'w') as f:
    json.dump({'schemaVersion': 2, 'name': 'EVA Vector', 'theme': 'eva',
               '_about': 'A modern, sporty, science-fiction cluster. Generated by eva/tools/gen_layout_vector.py.', 'widgets': W}, f, indent=1)
print('eva_vector.json', len(W), 'widgets')
