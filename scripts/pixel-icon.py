"""The Radar mark as pixel art: the "d" from the radar wordmark (stem, thick ring, dashed inner ring,
hub, needle, dots), at two levels of detail. Writes the extension/site PNG icons and the SVG paths.
python scripts/pixel-icon.py  ->  extension/icons/icon{16,32,48,128,512}.png, web/icons/mark.svg,
                                  prints SMALL_PATH (16x16 box) for the in-page marks
"""
import pathlib

from PIL import Image, ImageDraw

# The wordmark's "d" sampled onto a 32x37 grid (from the logo artwork): used from 48 px up.
FULL = """
...............########.........
...............########.........
...............########.........
...............########.........
...............########.........
...............########.........
...............########.........
...............########.........
.......###################......
......####################......
....#########.......########....
....########.........########...
...######...............######..
..######...##.......#...######..
.######....##.......#..########.
######........####.....###.#####
#####.......##....##..###..#####
#####......#........####...#####
#####......#........###......###
####.....#........####.......###
####.....#........###........###
####....#......#####.....#...###
####....#.....#####.....##...###
####....#.....####...........###
####....#......###...........###
####.....#............#......###
####.....#............#......###
#####......#.........#......####
#####......#...............#####
#####...##............##...#####
.######........###........#####.
..#####..................#####..
..#######...............######..
...########..........########...
....########.........########...
......####################......
......####################......
"""
# Hand-drawn 14x16 version for 16-32 px: stem right of centre, 2px ring, hub, needle out to the
# top right, three of the dots. Sits in a 16x16 box one column in.
SMALL = """
......#####...
......#####...
......#####...
..##########..
.############.
####......####
###.#.....####
##.......##.##
##......##..##
##....###...##
##....##....##
##..#.....#.##
###........###
.############.
..##########..
..............
"""


def grid(art):
    rows = art.strip().splitlines()
    assert len({len(r) for r in rows}) == 1
    return [[1 if ch == "#" else 0 for ch in row] for row in rows]


FULL_GRID, SMALL_GRID = grid(FULL), grid(SMALL)
assert (len(FULL_GRID[0]), len(FULL_GRID)) == (32, 37) and (len(SMALL_GRID[0]), len(SMALL_GRID)) == (14, 16)


def svg_path(g, dx=0):
    parts = []
    for y, row in enumerate(g):
        x = 0
        while x < len(row):
            if row[x]:
                s = x
                while x < len(row) and row[x]:
                    x += 1
                parts.append(f"M{s + dx} {y}h{x - s}v1h-{x - s}z")
            else:
                x += 1
    return "".join(parts)


BRAND = (0x56, 0x21, 0xAC, 255)


def icon(size):
    # Toolbar sizes (16, 32): the small "d" in purple on clear, filling the square. From 48 up: purple
    # rounded square with the full "d" in white. Whole-pixel cells so every size stays crisp.
    small = size < 48
    g = SMALL_GRID if small else FULL_GRID
    h, w = len(g), len(g[0])
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if not small:
        d.rounded_rectangle([0, 0, size - 1, size - 1], radius=max(3, round(size * 0.22)), fill=BRAND)
    cell = max(1, int(size * (1 if small else 0.9) // h))
    ox, oy = (size - cell * w) // 2, (size - cell * h) // 2
    ink = BRAND if small else (255, 255, 255, 255)
    # On the toolbar the dial face is white, so the purple "d" reads on light and dark themes alike.
    face = enclosed(g) if small else set()
    for y in range(h):
        for x in range(w):
            if g[y][x] or (x, y) in face:
                d.rectangle([ox + x * cell, oy + y * cell, ox + (x + 1) * cell - 1, oy + (y + 1) * cell - 1],
                            fill=ink if g[y][x] else (255, 255, 255, 255))
    return img


def enclosed(g):
    """Empty cells the ring closes off (not reachable from the edge)."""
    h, w = len(g), len(g[0])
    seen = set()
    todo = [(x, y) for x in range(w) for y in (0, h - 1)] + [(x, y) for y in range(h) for x in (0, w - 1)]
    while todo:
        x, y = todo.pop()
        if (x, y) in seen or not (0 <= x < w and 0 <= y < h) or g[y][x]:
            continue
        seen.add((x, y))
        todo += [(x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)]
    return {(x, y) for y in range(h) for x in range(w) if not g[y][x] and (x, y) not in seen}


if __name__ == "__main__":
    out = pathlib.Path("extension/icons")
    for s in (16, 32, 48, 128, 512):
        icon(s).save(out / f"icon{s}.png")
    pathlib.Path("web/icons").mkdir(parents=True, exist_ok=True)
    pathlib.Path("web/icons/mark.svg").write_text(
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 37" shape-rendering="crispEdges"><path fill="#fff" d="{svg_path(FULL_GRID)}"/></svg>\n')
    print("SMALL_PATH", svg_path(SMALL_GRID, 1))
