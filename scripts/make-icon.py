#!/usr/bin/env python3
"""Render the plugin icon (180x180 PNG) used by the npm/registry listing.

Three model nodes on the left converge into one aggregated answer node on the
right — the whole point of `multi_model_run`. Deterministic: same input, same
bytes, no fonts, no network.

Usage: python scripts/make-icon.py [output.png]
"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw

SIZE = 180
SS = 4  # supersample factor for clean edges, downsampled at the end

BG = (15, 23, 42, 255)        # slate-900
EDGE = (51, 65, 85, 255)      # slate-700
MODELS = [(56, 189, 248, 255), (129, 140, 248, 255), (192, 132, 252, 255)]  # sky / indigo / purple
LINK = (148, 163, 184, 210)   # slate-400, translucent
OUTPUT = (251, 191, 36, 255)  # amber-400


def main() -> int:
    out = Path(sys.argv[1] if len(sys.argv) > 1 else "assets/icon.png")
    img = Image.new("RGBA", (SIZE * SS, SIZE * SS), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    def s(value: float) -> float:
        return value * SS

    # Rounded background tile.
    d.rounded_rectangle(
        [s(4), s(4), s(SIZE - 4), s(SIZE - 4)],
        radius=s(34),
        fill=BG,
        outline=EDGE,
        width=s(2),
    )

    inputs = [(50.0, 54.0), (50.0, 90.0), (50.0, 126.0)]
    target = (126.0, 90.0)
    in_r, out_r = 14.0, 20.0

    # Converging links, drawn under the nodes.
    for x, y in inputs:
        d.line([(s(x), s(y)), (s(target[0] - 4), s(target[1]))], fill=LINK, width=s(4))

    # Input nodes.
    for (x, y), colour in zip(inputs, MODELS):
        d.ellipse([s(x - in_r), s(y - in_r), s(x + in_r), s(y + in_r)], fill=colour)

    # Aggregated answer node with a soft ring.
    d.ellipse(
        [s(target[0] - out_r - 7), s(target[1] - out_r - 7),
         s(target[0] + out_r + 7), s(target[1] + out_r + 7)],
        outline=(251, 191, 36, 90),
        width=s(3),
    )
    d.ellipse(
        [s(target[0] - out_r), s(target[1] - out_r),
         s(target[0] + out_r), s(target[1] + out_r)],
        fill=OUTPUT,
    )

    out.parent.mkdir(parents=True, exist_ok=True)
    img.resize((SIZE, SIZE), Image.LANCZOS).save(out, "PNG", optimize=True)
    print(f"wrote {out} ({out.stat().st_size} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
