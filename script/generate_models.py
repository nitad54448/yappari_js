#!/usr/bin/env python3
"""Generate Boukamp series/parallel topology catalogues without merging response families.

Usage: python generate_models.py --output catalog
Default: R C L Q W, up to seven elements. To include all Yappari types:
  python generate_models.py --elements R C L Q W Wo Ws G HN --output catalog

Only order/association duplicates and directly reducible repeated R/C/L/W
leaves are removed by default. Use --keep-reducible to keep the latter too.
Distinct topologies such as R(RC)(RC) and (R[(RC)RC]) are BOTH retained.
Q exponents are independent; repeated Q is never reduced. Wo/Ws/G/HN likewise.
No external dependencies. Large nine-type catalogues require substantial RAM.
"""
from __future__ import annotations
import argparse
from functools import lru_cache
import json
from math import comb
from pathlib import Path
import time

KINDS = 'RCLQW'
FIXED = frozenset('0124')
BRACKETS = {'[': ']', '(': ')'}
TRANS = str.maketrans('01234', KINDS)
KEEP_REDUCIBLE = False
ALL_KINDS = ('R', 'C', 'L', 'Q', 'W', 'Wo', 'Ws', 'G', 'HN')

@lru_cache(maxsize=100000)
def children(code: str) -> tuple[str, ...]:
    if code[0] not in BRACKETS:
        return ()
    out, i = [], 1
    while i < len(code) - 1:
        start = i
        if code[i] in BRACKETS:
            depth = 1
            i += 1
            while depth:
                if code[i] in BRACKETS: depth += 1
                elif code[i] in '])': depth -= 1
                i += 1
        else:
            i += 1
        out.append(code[start:i])
    return tuple(out)


def make(op: str, parts, reject_redundant: bool = False) -> str | None:
    """Flatten equal operators, sort children, and reduce repeated fixed power laws."""
    flat = []
    for part in parts:
        flat.extend(children(part) if part[0] == op else (part,))
    fixed_seen, kept = set(), []
    for part in sorted(flat):
        if not KEEP_REDUCIBLE and part in FIXED:
            if part in fixed_seen:
                if reject_redundant: return None
                continue
            fixed_seen.add(part)
        kept.append(part)
    if len(kept) == 1: return kept[0]
    if not kept: raise ValueError('empty circuit')
    return op + ''.join(kept) + BRACKETS[op]


def element_count(code: str) -> int:
    return sum(c.isdigit() for c in code)


def boukamp(code: str) -> str:
    return (code[1:-1] if code.startswith('[') else code).translate(TRANS)


def structural_counts(max_elements: int) -> list[int]:
    """Independent coefficient recurrence for unordered alternating SP trees.

    For either root operator, children are four nonrepeatable fixed leaves,
    arbitrary Q leaves, and a multiset of opposite-root subtrees.
    """
    a = [0] * (max_elements + 1)
    def multiply(p, q):
        return [sum(p[j] * q[i-j] for j in range(i+1)) for i in range(max_elements + 1)]
    for n in range(2, max_elements + 1):
        fixed = 0 if KEEP_REDUCIBLE else len(FIXED)
        repeatable = len(KINDS) - fixed
        p = [comb(fixed, i) if i <= fixed else 0 for i in range(max_elements + 1)]
        q = [comb(repeatable+i-1, i) if repeatable else int(i == 0) for i in range(max_elements + 1)]
        p = multiply(p, q)
        for size in range(2, n):
            q = [0] * (max_elements + 1)
            for k in range(max_elements // size + 1):
                q[k*size] = comb(a[size] + k - 1, k) if a[size] else int(k == 0)
            p = multiply(p, q)
        a[n] = p[n]
    return [0, len(KINDS)] + [2*a[n] for n in range(2, max_elements + 1)]


def enumerate_structural(max_elements: int):
    levels = [[], [str(i) for i in range(len(KINDS))]]
    expected = structural_counts(max_elements)
    for n in range(2, max_elements + 1):
        found = set()
        for i in range(1, n//2 + 1):
            j = n-i
            for ai, a in enumerate(levels[i]):
                bs = levels[j][ai:] if i == j else levels[j]
                for b in bs:
                    for op in ('[', '('):
                        code = make(op, (a, b), reject_redundant=True)
                        if code is not None: found.add(code)
        assert len(found) == expected[n], (n, len(found), expected[n])
        levels.append(sorted(found))
        print(f'{n} elements: {len(found):,} structural candidates', flush=True)
    return levels


def configure(kinds, keep_reducible=False):
    global KINDS, FIXED, TRANS, KEEP_REDUCIBLE
    if not kinds or len(set(kinds)) != len(kinds) or any(k not in ALL_KINDS for k in kinds):
        raise ValueError('Choose distinct types from: ' + ' '.join(ALL_KINDS))
    KINDS = tuple(kinds)
    FIXED = frozenset(str(i) for i, k in enumerate(KINDS) if k in ('R', 'C', 'L', 'W'))
    TRANS = {ord(str(i)): k for i, k in enumerate(KINDS)}
    KEEP_REDUCIBLE = keep_reducible
    children.cache_clear()


def build(output: Path, max_elements: int):
    output.mkdir(parents=True, exist_ok=True)
    started = time.monotonic()
    levels = enumerate_structural(max_elements)
    for n in range(1, max_elements + 1):
        with (output / f'models_{n}_elements.txt').open('w', encoding='utf-8') as f:
            for code in levels[n]:
                f.write(boukamp(code) + '\n')
    summary = {
        'elements': list(KINDS), 'max_elements': max_elements,
        'deduplication': 'unordered associative series/parallel topology only',
        'exclude_direct_repeated_R_C_L_W': not KEEP_REDUCIBLE,
        'electrical_family_merging': False,
        'counts': {str(n): len(levels[n]) for n in range(1, max_elements + 1)},
        'total': sum(map(len, levels)),
        'elapsed_seconds': round(time.monotonic() - started, 2),
    }
    (output / 'summary.json').write_text(json.dumps(summary, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(summary, indent=2), flush=True)
    return summary


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('--max-elements', type=int, choices=range(1, 8), default=7)
    p.add_argument('--output', type=Path, default=Path('catalog'))
    p.add_argument('--elements', nargs='+', choices=ALL_KINDS, default=list('RCLQW'))
    p.add_argument('--keep-reducible', action='store_true', help='Also include directly repeated R/C/L/W in series or parallel')
    args = p.parse_args()
    try:
        configure(args.elements, args.keep_reducible)
    except ValueError as e:
        p.error(str(e))
    build(args.output, args.max_elements)
