"""Small deterministic browser-test inputs; no dependency on a previous test run."""
import math
from pathlib import Path


def write_fixtures(directory):
    directory = Path(directory)
    cell = directory / 'yappari_cell.dat'
    rows = ['freq/Hz\tZr\tZi']
    for k in range(40):
        f = 10 ** (6 - 8 * k / 39)
        z = 20 + 1000 / complex(1, 2 * math.pi * f * 1000 * 1e-6)
        rows.append(f'{f:.12E}\t{z.real:.12E}\t{z.imag:.12E}')
    cell.write_text('\n'.join(rows) + '\n', encoding='utf-8')
    csv = directory / 'mfli_generated.csv'
    rows = ['chunk;timestamp;size;fieldname' + ';' * 10]
    for sweep in range(3):
        f = [10 ** (6 - 7 * k / 9) for k in range(10)]
        z = [100 + (1000 + sweep * 100) / complex(1, 2 * math.pi * fk * 1e-4) for fk in f]
        for field, values in [('absz', [abs(v) for v in z]), ('frequency', f),
                              ('realz', [v.real for v in z]), ('imagz', [v.imag for v in z])]:
            rows.append(';'.join(map(str, [sweep, 11257490332120 + sweep, 10, field] + values)))
    csv.write_text('\n'.join(rows) + '\n', encoding='utf-8')
    incomplete = directory / 'mfli_incomplete.csv'
    incomplete.write_text('\n'.join(rows[:2]) + '\n', encoding='utf-8')
    return {'cell': str(cell), 'mfli': str(csv), 'incomplete': str(incomplete)}
