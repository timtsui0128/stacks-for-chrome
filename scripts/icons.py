"""Render the approved 03 Tabs mark as SVG and antialiased Chrome PNG icons.

Requires Pillow. Geometry is shared by the vector source and all raster sizes.
"""
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "extension" / "icons"
ASSETS = ROOT / "assets"
COLOR = "#171717"
# Three separated folder silhouettes. Wide gaps stay legible at toolbar sizes.
PATHS = [
    [("M", 28, 13), ("L", 30, 9), ("Q", 31, 7, 34, 7),
     ("L", 40, 7), ("L", 44, 10), ("L", 55, 10),
     ("Q", 62, 10, 62, 17), ("L", 62, 36),
     ("Q", 62, 38, 60, 38), ("L", 59, 38), ("L", 59, 25),
     ("Q", 59, 16, 49, 16), ("L", 36, 16), ("L", 32, 13), ("Z",)],
    [("M", 16, 22), ("L", 18, 18), ("Q", 19, 16, 22, 16),
     ("L", 29, 16), ("L", 33, 19), ("L", 49, 19),
     ("Q", 49+7, 19, 56, 26), ("L", 56, 44),
     ("Q", 56, 46, 54, 46), ("L", 52, 46), ("L", 52, 35),
     ("Q", 52, 25, 42, 25), ("L", 27, 25), ("L", 23, 22), ("Z",)],
    [("M", 3, 31), ("Q", 3, 25, 9, 25), ("L", 20, 25),
     ("Q", 21, 25, 22, 26), ("L", 25, 29), ("L", 42, 29),
     ("Q", 48, 29, 48, 35), ("L", 48, 49),
     ("Q", 48, 53, 44, 53), ("L", 8, 53),
     ("Q", 3, 53, 3, 48), ("Z",)],
]

def points(commands):
    result = []
    current = (0, 0)
    for command in commands:
        op, *values = command
        if op in ("M", "L"):
            current = tuple(values)
            result.append(current)
        elif op == "Q":
            start, control, end = current, values[:2], values[2:]
            for step in range(1, 33):
                t = step / 32
                result.append(tuple((1 - t) ** 2 * start[i] +
                                    2 * (1 - t) * t * control[i] +
                                    t ** 2 * end[i] for i in range(2)))
            current = tuple(end)
    return result

def main():
    OUT.mkdir(parents=True, exist_ok=True)
    ASSETS.mkdir(parents=True, exist_ok=True)
    image = Image.new("RGBA", (1024, 1024))
    draw = ImageDraw.Draw(image)
    for path in PATHS:
        draw.polygon([(x * 16, y * 16) for x, y in points(path)], fill=COLOR)
    for size in (16, 32, 48, 128):
        image.resize((size, size), Image.Resampling.LANCZOS).save(OUT / f"{size}.png")
    shapes = "\n".join('<path d="' + " ".join(
        " ".join(map(str, command)) for command in path) + '"/>' for path in PATHS)
    mark = f'<g fill="{COLOR}">{shapes}</g>'
    (ASSETS / "stacks-mark.svg").write_text(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="Stacks">'
        f'{mark}</svg>\n')
    (ASSETS / "stacks-wordmark.svg").write_text(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 390 100" role="img" aria-label="stacks">'
        '<rect width="390" height="100" rx="12" fill="#fcfbf9"/>'
        f'<g transform="translate(20 18)">{mark}</g>'
        '<text x="104" y="68" fill="#171717" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" '
        'font-size="52" font-weight="500" letter-spacing="1">stacks</text></svg>\n')
    print("Generated the 03 Tabs mark and Chrome icons (16, 32, 48, 128 px).")

if __name__ == "__main__":
    main()
