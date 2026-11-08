#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Writes eva/app/hud/layouts/eva_v12.json: a cluster layout in the manner of a V12 grand tourer's digital display (black, white
lines, yellow lights): a big round rev counter in the middle with the speed inside it, boost, torque and power on the left, the gear
and the tyres on the right, a bottom row of four. 1920x720. No maker's logo or lettering is drawn.
  - the rev counter is one evadial layer (shaders.js evadial): ring, lit part, red zone, ticks, shift dots and the circle line of the map window;
  - no map: the backdrop is opaque black over the whole cluster;
  - BMW's black gear box (x1406-1597 y342-419) and its small gear letter at the bottom (x1360-1450 y664-712) are left alone, as in EVA Comfort.
Edit the numbers here and run it again."""
import json, math, os

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'app', 'hud', 'layouts', 'eva_v12.json')
YEL, WHITE, GREY, RED = [255, 209, 26, 255], [255, 255, 255, 255], [190, 192, 198, 255], [255, 86, 66, 255]
PAL = [[0.82, 0.83, 0.86], [0.30, 0.30, 0.33], [1.0, 0.82, 0.05]]           # the lines: white, dim, yellow
W = []
CX, CY = 960, 392                  # the rev counter's centre
R, RW = 288, 28                    # ring radius and width

def text(id, x, y, w, h, t, font, color, align='left', z=9, **k):
    d = {'id': id, 'type': 'text', 'class': 'alert', 'z': z, 'x': x, 'y': y, 'w': w, 'h': h, 'text': t, 'font': font, 'color': color, 'align': align}
    d.update(k)
    W.append(d)

def picture(id, name, x, y, w, h, z):
    W.append({'id': id, 'type': 'picture', 'class': 'alert', 'z': z, 'x': x, 'y': y, 'w': w, 'h': h, 'name': name})

SEC = [(26, 531), (557, 427), (984, 366), (1460, 434)]

FY, FH = 636, 64
framesA = [
    {'x': 190, 'y': 92, 'w': 430, 'h': 76, 'cut': [26, 0, 40, 0], 'glow': 1},          # the mode plate
    {'x': 1300, 'y': 92, 'w': 430, 'h': 76, 'cut': [0, 26, 0, 40], 'glow': 1},         # the clock plate
    {'x': 40, 'y': 236, 'w': 500, 'h': 388, 'cut': [44, 12, 12, 44], 'glow': 1},       # the engine card
    {'x': 1330, 'y': 210, 'w': 564, 'h': 118, 'cut': [12, 30, 12, 12], 'glow': 1},     # the g forces
    {'x': 1394, 'y': 332, 'w': 209, 'h': 260, 'cut': [8, 8, 24, 24], 'glow': 1},       # the gear box (BMW's black box is inside)
    {'x': 1610, 'y': 332, 'w': 284, 'h': 296, 'chamfer': 22, 'glow': 1},               # tyres
    {'x': 1622, 'y': 376, 'w': 260, 'h': 236, 'chamfer': 8, 'border': 1, 'color': 1},  # the box round the car
    {'x': 26, 'y': FY, 'w': 1868, 'h': FH, 'chamfer': 16, 'glow': 1},                  # the bottom row
]
# the backdrop: black, the map's round window cut out of it (the circle's box is 2 * HOLE_R)
W.append({'id': 'eva', 'type': 'evadash2', 'class': 'overlay', 'z': -10, 'x': 0, 'y': 0, 'w': 1920, 'h': 720, 'frames': framesA, 'pal': PAL,
          'rpmMax': 8000, 'coolMax': 120,
          'rails': [{'x': 640, 'y': 682, 'w': 310, 'h': 14, 'segs': 22, 'gap': 3, 'ramp': True, 'signal': 'oil', 'max': 140},      # the oil
                    {'x': 100, 'y': 682, 'w': 426, 'h': 14, 'segs': 28, 'gap': 3, 'ramp': True}]})                                    # the coolant
# the rev counter (a 720 x 720 box, so the shift dots at the top and the ring fit)
W.append({'id': 'dial', 'type': 'evadial', 'class': 'overlay', 'z': -9, 'x': 600, 'y': 0, 'w': 720, 'h': 720,
          'dial': {'cx': CX, 'cy': CY, 'r': R, 'width': RW, 'start': 225, 'sweep': 270, 'majors': 8, 'minors': 4, 'majorLen': 26, 'minorLen': 12,
                   'rpmMax': 8000, 'leds': {'radius': 334, 'dot': 7, 'count': 15, 'from': 4000}}})
text('mode', 232, 106, 360, 41, '{{mode}}', 'e_title', WHITE, glow=True)
text('modeSub', 233, 149, 300, 18, 'DRIVE MODE', 'e_sub', GREY)
text('clock', 1360, 112, 140, 46, '{{time}}', 'e_clock', WHITE, 'right', glow=True)
text('amb', 1550, 110, 100, 39, '{{ambient}}', 'e_val', WHITE, 'right')
text('ambU', 1656, 113, 50, 37, '{{u:temp}}', 'e_unit', YEL)

# the rev counter's numbers: 0 to 8 along the ring, the red zone's in red
for i in range(9):
    a = math.radians(225 + 270 * i / 8)
    x, y = CX + 214 * math.sin(a), CY - 214 * math.cos(a)
    text('tick%d' % i, round(x) - 30, round(y) - 12, 60, 24, str(i), 'e_tick', RED if i >= 7 else WHITE, 'center', z=6)

# inside the ring: the speed, under it the rev count
text('speed', CX - 172, 236, 345, 171, '{{speed}}', 'e_speed', WHITE, 'center', glow=True, z=7, rate=1)
text('speedUnit', CX - 172, 410, 345, 58, '{{u:speedLc}}', 'e_unitbig', YEL, 'center', z=7)
text('rpm', CX - 100, 500, 200, 70, '{{rpm}}', 'e_rpm', WHITE, 'center', z=7, rate=1)
text('rpmCap', CX - 40, 572, 80, 28, 'RPM', 'e_label', YEL, 'center', z=7)

# the left card: boost, torque, power, the shift point
text('engCap', 84, 250, 300, 28, 'ENGINE', 'e_label', YEL, z=8)
for i, (cap, val, unit) in enumerate((('BOOST', '{{boost}}', '{{u:boost}}'), ('TORQUE', '{{torque}}', '{{u:torque}}'), ('POWER', '{{powerPct}}', '%'), ('SHIFT AT', '{{shiftAt}}', 'rpm'))):
    y0 = 294 + i * 80
    text('lCap%d' % i, 84, y0, 150, 28, cap, 'e_label', GREY, z=8)
    text('lVal%d' % i, 84, y0 + 28, 330, 39, val, 'e_val', WHITE, 'right', z=8)
    text('lUnit%d' % i, 420, y0 + 31, 90, 37, unit, 'e_unit', YEL, 'left', z=8)

# the top right card: the g forces and the engine's load
for i, (cap, val, unit) in enumerate((('G LAT', '{{gLat}}', 'g'), ('G LONG', '{{gLong}}', 'g'), ('LOAD', '{{torquePct}}', '%'))):
    x = 1350 + 180 * i
    text('dCap%d' % i, x, 222, 150, 28, cap, 'e_label', YEL)
    text('dVal%d' % i, x, 258, 110, 39, val, 'e_val', WHITE, 'right', z=9)
    text('dUnit%d' % i, x + 114, 262, 44, 37, unit, 'e_unit', GREY, 'left', z=9)

# the gear: BMW's black box is above, the number below it, the selector row under
GC = (1394 + 1603) // 2
text('gear', GC - 88, 422, 176, 127, '{{gear}}', 'e_gearx', WHITE, 'center', glow=True, z=10)
for k, L in enumerate('PRNDM'):
    text('selDim' + L, GC + (k - 2) * 34 - 16, 556, 32, 30, L, 'e_label', [100, 100, 106, 255], 'center', z=10)
    text('sel' + L, GC + (k - 2) * 34 - 16, 556, 32, 30, '{{sel:%s}}' % L, 'e_label', YEL, 'center', glow=True, z=11)

# the tyres
text('tyreCap', 1630, 338, 200, 28, 'TYRE PRESSURE', 'e_label', YEL, z=10)
for key, x, y, al in (('FL', 1624, 435, 'left'), ('FR', 1801, 435, 'right'), ('RL', 1624, 514, 'left'), ('RR', 1801, 514, 'right')):
    text('tyre' + key, x, y, 70 if al == 'left' else 79, 31, '{{tyreP:%s}} {{u:pressure}}' % key, 'e_tp', WHITE, al, z=10)
    text('tyreT' + key, x, y + 31, 70 if al == 'left' else 79, 31, '{{tyreT:%s}} {{u:temp}}' % key, 'e_tp', GREY, al, z=10)
picture('car', 'v_car', 1714, 402, 77, 156, 10)

# the bottom row
ICONS = {'COOLANT': ('v_coolant', 45), 'OIL': ('v_oil', 52), 'BATTERY': ('v_battery', 41), 'RANGE': ('v_fuel', 36)}
for (cx, cw), cap, val, unit, uw in zip(SEC, ('COOLANT', 'OIL', 'BATTERY', 'RANGE'), ('{{coolant}}', '{{oil}}', '{{battery}}', '{{range}}'),
                                         ('{{u:temp}}', '{{u:temp}}', '%', '{{u:distLc}}'), (50, 50, 40, 60)):
    right = cx + cw - 19
    name, iw = ICONS[cap]
    ix = cx + 75 if cap == 'OIL' else cx + (12 if cap == 'RANGE' else 22)
    picture('ic_' + cap.lower(), name, ix, 641, iw, 38, 11)
    text('cap_' + cap.lower(), ix + iw + (8 if cap == 'RANGE' else 14), 646, {'OIL': 72, 'RANGE': 68}.get(cap, 110), 28, cap, 'e_label', YEL, z=11)
    vw = 72 if cap == 'RANGE' else 110
    text('val_' + cap.lower(), right - uw - 8 - vw, 641, vw, 39, val, 'e_val', WHITE, 'right', z=11)
    text('u_' + cap.lower(), right - uw, 644, uw, 37, unit, 'e_unit', GREY, z=11)

with open(OUT, 'w') as f:
    json.dump({'schemaVersion': 2, 'name': 'EVA V12', 'theme': 'eva',
               '_about': 'A round rev counter with the speed inside, engine data left, gear and tyres right. Generated by eva/tools/gen_layout_v12.py.',
               'widgets': W}, f, indent=1)
print('eva_v12.json', len(W), 'widgets')
