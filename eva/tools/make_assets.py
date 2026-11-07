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
    ('e_tp', 'BarlowCondensed-SemiBold.ttf', 26, D + '.°-' + U + L + ' '),
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
    # EVA Comfort: the car with its tyre sensors from the owner's asset pack; the footer icons and the red hazard dashes are drawn here.
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
    # the four icons of the bottom row, drawn here as line art in one style (4x, then scaled down), cream with a warm edge
    from PIL import ImageDraw
    K = 4
    CREAM = (255, 236, 214, 255)

    def icon(name, w, draw):
        im = Image.new('RGBA', (w * K, 36 * K), (0, 0, 0, 0))
        d = ImageDraw.Draw(im)
        P = lambda *pts: [(x * K, y * K) for x, y in pts]
        draw(d, P, lambda x: round(x * K))
        save(name, im.resize((w, 36), Image.LANCZOS))

    def coolant(d, P, k):                      # a thermometer in a pool with two waves
        d.rounded_rectangle([k(7), k(2), k(15), k(22)], radius=k(4), outline=CREAM, width=k(2.4))
        d.ellipse([k(3.5), k(18), k(18.5), k(33)], outline=CREAM, width=k(2.4))
        d.rectangle([k(10), k(11), k(12), k(27)], fill=CREAM)
        d.ellipse([k(7), k(23), k(15), k(31)], fill=CREAM)
        for y in (13, 22):
            pts = [(22 + t, y + 2.2 * __import__('math').sin(t / 2.4)) for t in [i * 0.5 for i in range(0, 33)]]
            d.line(P(*pts), fill=CREAM, width=k(2.4), joint='curve')

    def oil(d, P, k):                          # an oil can with its spout and a drop
        d.line(P((6, 14), (30, 14), (36, 22), (36, 29), (6, 29), (6, 14)), fill=CREAM, width=k(2.4), joint='curve')
        d.line(P((10, 14), (10, 9), (26, 9)), fill=CREAM, width=k(2.4), joint='curve')
        d.line(P((6, 17), (2, 13), (2, 9)), fill=CREAM, width=k(2.4), joint='curve')
        d.line(P((36, 21), (47, 27)), fill=CREAM, width=k(2.4))
        d.polygon(P((49, 30), (46.5, 34.5), (51.5, 34.5)), fill=CREAM)
        d.line(P((14, 21), (28, 21)), fill=CREAM, width=k(2))

    def battery(d, P, k):                      # a 12 V battery with its two terminals, minus and plus
        d.rounded_rectangle([k(2), k(8), k(41), k(31)], radius=k(3), outline=CREAM, width=k(2.4))
        d.rectangle([k(8), k(4), k(15), k(8)], fill=CREAM)
        d.rectangle([k(28), k(4), k(35), k(8)], fill=CREAM)
        d.line(P((9, 19.5), (16, 19.5)), fill=CREAM, width=k(2.4))
        d.line(P((27, 19.5), (35, 19.5)), fill=CREAM, width=k(2.4))
        d.line(P((31, 15.5), (31, 23.5)), fill=CREAM, width=k(2.4))

    def fuel(d, P, k):                         # a fuel pump with its hose
        d.rounded_rectangle([k(3), k(3), k(21), k(32)], radius=k(3), outline=CREAM, width=k(2.4))
        d.rectangle([k(7), k(8), k(17), k(15)], outline=CREAM, width=k(2))
        d.line(P((1, 33), (23, 33)), fill=CREAM, width=k(2.4))
        d.line(P((21, 12), (27, 12), (30, 15), (30, 27), (33, 27)), fill=CREAM, width=k(2.4), joint='curve')

    icon('c_coolant', 40, coolant)
    icon('c_oil', 54, oil)
    icon('c_battery', 44, battery)
    icon('c_fuel', 34, fuel)
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
