# Re-derive every number in README.md from the screenshots in shots/.
#
# Written because the first version of this investigation was ME REASONING FROM A DESCRIPTION —
# I built a spec section on "iOS treats icon+label as one square budget", flagged that I had not
# verified it, and carried on anyway. Flagging is not verifying. The measurement refuted it.
#
#   python3 docs/experiments/ios-launcher-2026-07/measure.py
#
# Method: the shots are white-ish icons on pure black, so a brightness threshold gives clean bands.
# Column widths/pitch are read on PURE icon rows only — a row range that includes label text
# contaminates the column extents, because the label is wider than the icon it sits under.
import os
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
SHOTS = os.path.join(HERE, 'shots')

# 🔴 SAY SO, LOUDLY, RATHER THAN MEASURING AN EMPTY DIRECTORY. The screenshots are the maintainer's
# own phone and stayed in the private incubator when this experiment moved to the public engine
# (2026-09-07, see README.md) — a picture of one person's apps is not de-identifiable by renaming a
# file. Every band-finder below returns an empty list on no input, so without this the script would
# print a full table of zeros and read exactly like a device that has no icons on it.
if not os.path.isdir(SHOTS) or not [f for f in os.listdir(SHOTS) if f.lower().endswith('.png')]:
    raise SystemExit(
        'measure.py: no screenshots in ' + SHOTS + '\n'
        '  They are the maintainer\'s own device and did not move to this repo — see README.md,\n'
        '  "What is not here, and why". Every number this script derives is already written down\n'
        '  there; re-deriving them needs the shots, and this cannot invent them.')


def bands(mask, minlen):
    """Contiguous runs of True at least `minlen` long, as (start, end) inclusive."""
    out, s = [], None
    for i, v in enumerate(mask):
        if v and s is None:
            s = i
        elif not v and s is not None:
            if i - s >= minlen:
                out.append((s, i - 1))
            s = None
    if s is not None and len(mask) - s >= minlen:
        out.append((s, len(mask) - 1))
    return out


def grey(name):
    return np.asarray(Image.open(os.path.join(SHOTS, name)).convert('L')).astype(int)


# Row ranges hand-picked to contain ONLY icon pixels (no label text, no badge).
CASES = [
    ('01-labels-on.png',  'labels ON  (small icons)', [(450, 540), (605, 693), (759, 849)], 508),
    ('02-labels-off.png', 'labels OFF (large icons)', [(447, 552), (588, 693), (739, 844)], 513),
]

print('icon width and column pitch, measured on three pure-icon rows per shot')
print(f"{'state':26} {'row':14} {'icon widths':22} {'column pitch'}")
summary = {}
for f, tag, rows, col in CASES:
    a = grey(f)
    widths, pitches = [], []
    for (y0, y1) in rows:
        cs = (a[y0:y1, :] > 20).sum(axis=0)
        cb = bands(cs > 4, 10)
        w = [e - s + 1 for s, e in cb]
        c = [(s + e) / 2 for s, e in cb]
        p = [round(c[i + 1] - c[i], 1) for i in range(len(c) - 1)]
        widths += w
        pitches += p
        print(f'{tag:26} y{y0}-{y1:<8} {str(w):22} {p}')
    summary[tag] = {'icon': np.mean(widths), 'hpitch': np.mean(pitches)}

print('\nvertical pitch, from the first icon top to the last over 5 gaps')
for f, tag, _, col in CASES:
    a = grey(f)
    rs = (a[:, col - 35:col + 35] > 18).sum(axis=1)
    rb = [b for b in bands(rs > 3, 8) if 250 < b[0] < 1250]
    icons = [b for b in rb if (b[1] - b[0]) > 60]          # icon bands; label bands are ~15px tall
    labels = [b for b in rb if (b[1] - b[0]) <= 60]
    tops = [s for s, _ in icons]
    v = (tops[-1] - tops[0]) / (len(tops) - 1)
    summary[tag]['vpitch'] = v
    summary[tag]['label_h'] = np.mean([e - s + 1 for s, e in labels]) if labels else 0
    print(f'{tag:26} rows={len(tops)}  tops={tops}  v-pitch={v:.1f}  label bands={len(labels)}')

on = summary['labels ON  (small icons)']
off = summary['labels OFF (large icons)']
print(f"""
{'':14}{'labels ON':>12}{'labels OFF':>12}{'change':>12}
{'icon side':14}{on['icon']:>12.1f}{off['icon']:>12.1f}{(off['icon'] / on['icon'] - 1) * 100:>11.1f}%
{'h-pitch':14}{on['hpitch']:>12.1f}{off['hpitch']:>12.1f}{(off['hpitch'] / on['hpitch'] - 1) * 100:>11.1f}%
{'v-pitch':14}{on['vpitch']:>12.1f}{off['vpitch']:>12.1f}{(off['vpitch'] / on['vpitch'] - 1) * 100:>11.1f}%
{'label height':14}{on['label_h']:>12.1f}{'—':>12}

THE TEST: if the cell were a fixed budget the label eats into, pitch would not move.
v-pitch moved {(off['vpitch'] / on['vpitch'] - 1) * 100:.1f}%. It is not a fixed budget — the whole grid re-derives.""")

# The size toggle glyph: two rounded squares, the ACTIVE size drawn solid.
print('\nsize-toggle glyph — mean brightness of the small vs large square')
for f, tag in [('03-customize-large.png', 'large selected'), ('04-customize-small.png', 'small selected')]:
    a = grey(f)
    small = a[1115:1140, 655:672].mean()
    large = a[1105:1145, 675:705].mean()
    print(f'  {tag:16} small-square={small:6.1f}  large-square={large:6.1f}  '
          f'-> solid is {"LARGE" if large > small else "SMALL"}')
