#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Writes eva/app/hud/layouts/eva_neo.json: our own cluster design "EVA Neo" (ideas, not copies, from the digital clusters looked at: two glass
dials either side of a column, seven-segment numbers). The left dial is the rev counter (ring, ticks, needle, shift dots from both ends) with
the rpm as seven-segment digits; the right dial is the speed along the speed scale with the speed as big seven-segment digits (BMW's black gear
box, x1406-1597 y342-419, sits above them); between them the drive mode and the clock, the gear with its selector row P R N D S M, boost, torque
and load, the four tyres; the bottom row of coolant, oil, battery and range. 1920x720, no map. The digits are drawn by make_seg.py."""
import json, math, os

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'app', 'hud', 'layouts', 'eva_neo.json')
ACC, ACC_F = [86, 200, 255, 255], [0.34, 0.78, 1.0]
WHITE, GREY, RED = [255, 255, 255, 255], [176, 190, 204, 255], [255, 96, 80, 255]
PAL = [[0.82, 0.86, 0.9], [0.24, 0.30, 0.36], ACC_F]
W = []
LC, RC, CY, R, RW = 430, 1490, 392, 196, 22
START, SWEEP = 215, 250


def text(id, x, y, w, h, t, font, color, align='left', z=9, **k):
    d = {'id': id, 'type': 'text', 'class': 'alert', 'z': z, 'x': x, 'y': y, 'w': w, 'h': h, 'text': t, 'font': font, 'color': color, 'align': align}
    d.update(k)
    W.append(d)


def picture(id, name, x, y, w, h, z):
    W.append({'id': id, 'type': 'picture', 'class': 'alert', 'z': z, 'x': x, 'y': y, 'w': w, 'h': h, 'name': name})


FY, FH = 636, 64
SEC = [(26, 531), (557, 427), (984, 366), (1460, 434)]
# the left dial's layer is the whole cluster: it paints the black (BMW's gauges are under it), the stars, the vignette and the warp streaks from the middle;
# the right dial is a 500 x 500 box above it
W.append({'id': 'dialL', 'type': 'evadial', 'class': 'overlay', 'z': -10, 'x': 0, 'y': 0, 'w': 1920, 'h': 720,
          'dial': {'cx': LC, 'cy': CY, 'r': R, 'width': RW, 'start': START, 'sweep': SWEEP, 'majors': 8, 'minors': 4, 'majorLen': 22, 'minorLen': 10,
                   'rpmMax': 8000, 'clip': 240, 'bg': True, 'origin': [960, CY], 'yellow': ACC_F, 'needle': {'inner': 150, 'outer': R + RW // 2 + 2, 'width': 3},
                   'leds': {'radius': R + 40, 'dot': 6, 'count': 11, 'from': 4000, 'wings': True}}})
W.append({'id': 'dialR', 'type': 'evadial', 'class': 'overlay', 'z': -8, 'x': RC - 250, 'y': 142, 'w': 500, 'h': 500,
          'dial': {'cx': RC, 'cy': CY, 'r': R, 'width': RW, 'start': START, 'sweep': SWEEP, 'majors': 8, 'minors': 4, 'majorLen': 22, 'minorLen': 10,
                   'signal': 'speed', 'redFrom': 1.0, 'clip': 240, 'fx': False, 'yellow': ACC_F, 'needle': {'inner': 150, 'outer': R + RW // 2 + 2, 'width': 3}}})

text('mode', 756, 104, 296, 41, '{{mode}}', 'e_title', WHITE, glow=True)
text('clock', 1060, 106, 120, 46, '{{time}}', 'e_clock', WHITE, 'right', glow=True)

# the numbers round the two dials
for i in range(9):
    a = math.radians(START + SWEEP * i / 8)
    for cx, tok, col, zz in ((LC, str(i), RED if i >= 7 else WHITE, 6), (RC, '{{spd:%d}}' % i, WHITE, 7)):
        x, y = cx + 134 * math.sin(a), CY - 134 * math.cos(a)
        text(('rn%d' if cx == LC else 'sn%d') % i, round(x) - 22, round(y) - 12, 44, 24, tok, 'e_tick', col, 'center', z=zz)

# the digits inside the dials
text('rpm', LC - 80, 360, 160, 56, '{{rpm}}', 'e_segs', WHITE, 'center', z=6, rate=1)
text('rpmCap', LC - 40, 424, 80, 28, 'RPM', 'e_label', ACC, 'center', z=6)
text('speed', RC - 100, 436, 200, 100, '{{speed}}', 'e_seg', WHITE, 'center', z=8, rate=1)
text('speedUnit', RC - 60, 542, 120, 37, '{{u:speedLc}}', 'e_unit', ACC, 'center', z=7)

# the column: the gear, its selector row, three engine numbers, the tyres
GC = 960
text('gearCap', GC - 60, 194, 120, 28, 'GEAR', 'e_label', ACC, 'center', z=9)
text('gear', GC - 88, 226, 176, 127, '{{gear}}', 'e_gearx', WHITE, 'center', z=9, glow=True)
for k, L in enumerate('PRNDSM'):
    x = GC + round((k - 2.5) * 40) - 14
    text('selDim' + L, x, 356, 28, 30, L, 'e_label', [78, 92, 106, 255], 'center', z=9)
    text('sel' + L, x, 356, 28, 30, '{{selx:%s}}' % L, 'e_label', ACC, 'center', z=10, glow=True)
for i, (cap, val, unit) in enumerate((('BOOST', '{{boost}}', '{{u:boost}}'), ('TORQUE', '{{torque}}', '{{u:torque}}'), ('LOAD', '{{torquePct}}', '%'))):
    x = 748 + 148 * i
    text('dCap%d' % i, x, 404, 130, 28, cap, 'e_label', ACC, z=9)
    text('dVal%d' % i, x, 436, 90, 39, val, 'e_val', WHITE, 'right', z=9)
    text('dUnit%d' % i, x + 92, 440, 50, 37, unit, 'e_unit', GREY, 'left', z=9)
text('tyreCap', 748, 496, 200, 28, 'TYRES', 'e_label', ACC, z=9)
for i, key in enumerate(('FL', 'FR', 'RL', 'RR')):
    x = 748 + 110 * i
    text('tyreN' + key, x, 528, 100, 18, key, 'e_sub', GREY, z=9)
    text('tyre' + key, x, 548, 100, 31, '{{tyreP:%s}}' % key, 'e_tp', WHITE, z=9)
    text('tyreT' + key, x, 580, 100, 31, '{{tyreT:%s}}' % key, 'e_tp', GREY, z=9)

# the bottom row
ICONS = {'COOLANT': ('v_coolant', 45), 'OIL': ('v_oil', 52), 'BATTERY': ('v_battery', 41), 'RANGE': ('v_fuel', 36)}
for (cx, cw), cap, val, unit, uw in zip(SEC, ('COOLANT', 'OIL', 'BATTERY', 'RANGE'), ('{{coolant}}', '{{oil}}', '{{battery}}', '{{range}}'),
                                         ('{{u:temp}}', '{{u:temp}}', '%', '{{u:distLc}}'), (50, 50, 40, 60)):
    right = cx + cw - 19
    name, iw = ICONS[cap]
    ix = cx + 75 if cap == 'OIL' else cx + (12 if cap == 'RANGE' else 22)
    picture('ic_' + cap.lower(), 'v_' + {'COOLANT': 'coolant', 'OIL': 'oil', 'BATTERY': 'battery', 'RANGE': 'fuel'}[cap] + '_n', ix, 641, iw, 38, 11)
    text('cap_' + cap.lower(), ix + iw + (8 if cap == 'RANGE' else 14), 646, {'OIL': 72, 'RANGE': 68}.get(cap, 110), 28, cap, 'e_label', ACC, z=11)
    vw = 72 if cap == 'RANGE' else 110
    text('val_' + cap.lower(), right - uw - 8 - vw, 641, vw, 39, val, 'e_val', WHITE, 'right', z=11)
    text('u_' + cap.lower(), right - uw, 644, uw, 37, unit, 'e_unit', GREY, z=11)

with open(OUT, 'w') as f:
    json.dump({'schemaVersion': 2, 'name': 'EVA Neo', 'theme': 'eva',
               '_about': 'Two glass dials, seven-segment numbers, a column in the middle, no frames. Generated by eva/tools/gen_layout_neo.py.', 'widgets': W}, f, indent=1)
print('eva_neo.json', len(W), 'widgets')
