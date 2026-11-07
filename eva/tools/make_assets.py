#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Bakes the EVA cluster app's font atlases and the pilot picture into eva/app/hud/ (run once, outputs are committed so
the release build is reproducible):

    python3 eva/tools/make_assets.py --kit <bimmer-lab/apps checkout> --pilot <pilot.webp>

Fonts are baked with bimmer-lab's own tools/bake_fonts.py (Barlow Condensed, SIL OFL 1.1). The pilot picture is cut to the
cluster's box, its left edge faded to black, and stored as raw RGBA (base64 in JSON: the car has no image decoder)."""
import argparse, base64, json, os, sys

ap = argparse.ArgumentParser()
ap.add_argument('--kit', required=True)
ap.add_argument('--pilot')
ap.add_argument('--comfort', help='the unzipped EVA_Comfort_Full_Assets folder (icons, car) for the EVA Comfort layout')
a = ap.parse_args()

sys.path.insert(0, os.path.join(a.kit, 'tools'))
import bake_fonts as bf          # noqa: E402
from PIL import Image            # noqa: E402

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'app', 'hud')
U, D, L = bf.UPPER, bf.DIGITS, bf.LOWER
FONTS = [
    ('e_title', 'BarlowCondensed-Bold.ttf', 46, U + ' '),
    ('e_sub', 'BarlowCondensed-SemiBold.ttf', 18, U + ' /'),
    ('e_clock', 'BarlowCondensed-Bold.ttf', 60, D + ':-'),
    ('e_label', 'BarlowCondensed-Bold.ttf', 30, U + ' '),
    ('e_tick', 'BarlowCondensed-SemiBold.ttf', 24, U + D + ' '),
    ('e_rpm', 'BarlowCondensed-Bold.ttf', 92, D + '-'),
    ('e_unit', 'BarlowCondensed-SemiBold.ttf', 30, L + U + '/°% '),
    ('e_speed', 'BarlowCondensed-Bold.ttf', 230, D + '-'),
    ('e_unitbig', 'BarlowCondensed-Bold.ttf', 58, L + '/'),
    ('e_gear', 'BarlowCondensed-Bold.ttf', 150, 'PRNDSM' + D + '-'),
    ('e_mono', 'BarlowCondensed-SemiBold.ttf', 24, U + D + ' .:-\u00b7'),
    ('e_val', 'BarlowCondensed-Bold.ttf', 50, D + '.+-'),
    ('e_gearn', 'BarlowCondensed-Bold.ttf', 118, 'PRNDSM' + D + '-'),
    ('e_tyre', 'BarlowCondensed-Bold.ttf', 28, U + L + D + ' .->'),
    # the EVA HUD on the windshield (800x480, the window the driver sees is about 485x278)
    ('w_title', 'BarlowCondensed-Bold.ttf', 26, U + ' '),
    ('w_small', 'BarlowCondensed-SemiBold.ttf', 12, U + D + ' :.-/\u00b0'),
    ('w_mode', 'BarlowCondensed-Bold.ttf', 20, U + ' :'),
    ('w_label', 'BarlowCondensed-Bold.ttf', 20, U + ' '),
    ('w_rpm', 'BarlowCondensed-Bold.ttf', 24, D + '-'),
    ('w_gear', 'BarlowCondensed-Bold.ttf', 84, 'PRNDSM' + D + '-'),
    ('w_speed', 'BarlowCondensed-Bold.ttf', 112, D + '-'),
    ('w_unit', 'BarlowCondensed-Bold.ttf', 26, L + '/'),
    ('w_alert', 'BarlowCondensed-Bold.ttf', 22, U + ' '),
]
fo = os.path.join(OUT, 'fonts')
os.makedirs(fo, exist_ok=True)
for spec in FONTS:
    bf.bake(fo, *spec)

if a.pilot:
    W, H = 200, 240
    src = Image.open(a.pilot).convert('RGB')
    # the face and shoulder, the part of the picture worth keeping in a box this size
    cw = round(src.height * W / H)
    left = max(0, min(src.width - cw, 190))
    im = src.crop((left, 0, left + cw, src.height)).resize((W, H), Image.LANCZOS)
    px = bytearray()
    for y in range(H):
        for x in range(W):
            r, g, b = im.getpixel((x, y))
            f = min(1.0, x / (W * 0.30)) * min(1.0, (W - 1 - x) / (W * 0.05) + 0.0)
            px += bytes((int(r * f), int(g * f), int(b * f), 255))
    po = os.path.join(OUT, 'pictures')
    os.makedirs(po, exist_ok=True)
    with open(os.path.join(po, 'pilot.json'), 'w') as f:
        json.dump({'w': W, 'h': H, 'rgba': base64.b64encode(bytes(px)).decode('ascii')}, f, separators=(',', ':'))
    print('pilot %dx%d' % (W, H))

if a.comfort:
    # EVA Comfort: the footer icons and the car with its tyre sensors from the owner's asset pack, and the red hazard dashes drawn here.
    # Straight (non-premultiplied) RGBA, as cluster-render's image layers take it. Sizes are what eva_comfort.json asks for.
    po = os.path.join(OUT, 'pictures')
    os.makedirs(po, exist_ok=True)

    def save(name, im):
        im = im.convert('RGBA')
        with open(os.path.join(po, name + '.json'), 'w') as f:
            json.dump({'w': im.width, 'h': im.height, 'rgba': base64.b64encode(im.tobytes()).decode('ascii')}, f, separators=(',', ':'))
        print('%s %dx%d' % (name, im.width, im.height))

    comp = os.path.join(a.comfort, 'png', 'components')
    load = lambda n: Image.open(os.path.join(comp, n + '.png')).convert('RGBA')
    for name, src in (('c_coolant', '21_icon_coolant'), ('c_oil', '22_icon_oil'), ('c_battery', '23_icon_battery'), ('c_fuel', '24_icon_fuel')):
        im = load(src)
        save(name, im.resize((round(im.width * 36 / im.height), 36), Image.LANCZOS))
    # the car (x 1650, y 295) and its four tyre sensors (x 1630, y 344) on one 122x238 canvas, then 0.9
    car, tyres = load('17_car_top'), load('18_tyre_icons')
    cv = Image.new('RGBA', (122, 238), (0, 0, 0, 0))
    cv.alpha_composite(car, (1650 - 1630, 0))
    cv.alpha_composite(tyres, (0, 344 - 295))
    save('c_car', cv.resize((110, 214), Image.LANCZOS))

    def dashes(n, w=20, h=10, skew=7, gap=8, color=(236, 70, 42, 255)):
        W = n * (w + gap) - gap + skew
        im = Image.new('RGBA', (W * 4, h * 4), (0, 0, 0, 0))
        from PIL import ImageDraw
        d = ImageDraw.Draw(im)
        for i in range(n):
            x0 = i * (w + gap)
            d.polygon([((x0 + skew) * 4, 0), ((x0 + skew + w) * 4, 0), ((x0 + w) * 4, h * 4 - 1), (x0 * 4, h * 4 - 1)], fill=color)
        return im.resize((W, h), Image.LANCZOS)
    save('c_dash5', dashes(5))
    save('c_dash3', dashes(3))
