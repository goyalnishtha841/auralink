"""Render Auralink's favicon from the same wave mark as components/ui.jsx's BrandMark,
at high resolution then downsample, so edges stay crisp at 16-32px instead of jagged."""
from PIL import Image, ImageDraw

SCALE = 12.8  # maps the 40-wide SVG viewBox to a 512px canvas
CANVAS = 512
BG = (5, 5, 5, 255)
CORAL = (255, 91, 91, 255)
BASELINE = (175, 175, 175, 255)  # #f5f5f5 at ~0.7 opacity over BG, flattened


def cubic_bezier(p0, c1, c2, p1, steps=40):
    pts = []
    for i in range(steps + 1):
        t = i / steps
        mt = 1 - t
        x = mt**3 * p0[0] + 3 * mt**2 * t * c1[0] + 3 * mt * t**2 * c2[0] + t**3 * p1[0]
        y = mt**3 * p0[1] + 3 * mt**2 * t * c1[1] + 3 * mt * t**2 * c2[1] + t**3 * p1[1]
        pts.append((x, y))
    return pts


def reflect(p, about):
    return (2 * about[0] - p[0], 2 * about[1] - p[1])


def scaled(pts, dy=7):
    return [((x) * SCALE, (y + dy) * SCALE) for x, y in pts]


def draw_rounded_line(draw, pts, width, fill):
    draw.line(pts, fill=fill, width=width, joint="curve")
    r = width / 2
    for p in (pts[0], pts[-1]):
        draw.ellipse([p[0] - r, p[1] - r, p[0] + r, p[1] + r], fill=fill)


img = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
draw = ImageDraw.Draw(img)
radius = 8 * SCALE
draw.rounded_rectangle([0, 0, CANVAS, CANVAS], radius=radius, fill=BG)

# wave: M3 18 C7 4,11 4,14 13  S21 22,24 11  S32 2,37 18
p0, c1, c2, p1 = (3, 18), (7, 4), (11, 4), (14, 13)
seg1 = cubic_bezier(p0, c1, c2, p1)
c1b = reflect(c2, p1)
c2b, p2 = (21, 22), (24, 11)
seg2 = cubic_bezier(p1, c1b, c2b, p2)
c1c = reflect(c2b, p2)
c2c, p3 = (32, 2), (37, 18)
seg3 = cubic_bezier(p2, c1c, c2c, p3)
wave = seg1 + seg2[1:] + seg3[1:]
draw_rounded_line(draw, scaled(wave), width=round(2.8 * SCALE), fill=CORAL)

# baseline: M3 23 H37
draw_rounded_line(draw, scaled([(3, 23), (37, 23)]), width=round(1.8 * SCALE), fill=BASELINE)

flat = Image.alpha_composite(Image.new("RGBA", img.size, BG), img).convert("RGB")

flat.resize((180, 180), Image.LANCZOS).save("public/apple-touch-icon.png")
flat.resize((512, 512), Image.LANCZOS).save("public/icon-512.png")
flat.resize((192, 192), Image.LANCZOS).save("public/icon-192.png")

ico_sizes = [16, 32, 48]
flat.save(
    "public/favicon.ico",
    sizes=[(s, s) for s in ico_sizes],
)
print("done")
