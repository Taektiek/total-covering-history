#!/usr/bin/env python3
"""
Minimum-person total covering solver for total-covering-history.

Finds the minimum number of historical people whose combined lifespans
cover the timeline [START, END] with no gaps, then exports the solution in
the format the website can load:

    { "version": 1, "ids": ["Q...", ...] }

Dataset: humans on Wikidata with birth date (P569) and at least
--min-sitelinks sitelinks (a broad notability filter, not a hand-picked
list). People without a death date are treated as alive until END, exactly
like the website does.

Algorithm: the minimum number of overlapping intervals needed to cover a
segment is found greedily (pick the interval that starts at or before the
current covered point and reaches furthest right). This is provably optimal
for this problem, so the result is the true minimum over the dataset.

The website always preloads Socrates (Q913, -470..-399), so the solver
anchors its coverage at Socrates' death and only selects people the website
would accept (dying after -399, each strictly extending coverage).

Usage:
    python3 solve.py                    # fetch (cached) + solve + verify + export
    python3 solve.py --offline          # solve only, from cache
    python3 solve.py --refresh         # re-download the dataset
    python3 solve.py --start 1500 --end 1800   # solve a custom interval
    python3 solve.py --min-sitelinks 10        # stricter notability filter
"""

import argparse
import datetime
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

WDQS = "https://query.wikidata.org/sparql"
WDAPI = "https://www.wikidata.org/w/api.php"
UA = "total-covering-history-solver/1.0 (https://github.com/Taektiek/total-covering-history)"

SOCRATES = ("Q913", -470, -399)
TIMELINE_START = -470

HERE = Path(__file__).resolve().parent
CACHE_DIR = HERE / "cache"

# Window widths (years) per birth-year era: sparse eras can use wide windows,
# dense modern decades need narrow ones to stay under the 60s query timeout.
WINDOW_PLAN = [(1500, 100), (1850, 25), (float("inf"), 10)]


def window_width(year):
    for bound, width in WINDOW_PLAN:
        if year < bound:
            return width
    return 10


def log(msg):
    print(msg, flush=True)


# ---------------------------------------------------------------- fetching

QUERY_TEMPLATE = """SELECT ?item ?birth ?death WHERE {{
  ?item wdt:P31 wd:Q5 .
  ?item wdt:P569 ?birth .
  ?item wikibase:sitelinks ?sl .
  OPTIONAL {{ ?item wdt:P570 ?death . }}
  FILTER(?sl >= {sl})
  FILTER(?birth >= "{w0}-01-01T00:00:00Z"^^xsd:dateTime &&
          ?birth <  "{w1}-01-01T00:00:00Z"^^xsd:dateTime)
}}"""


def run_query(w0, w1, sl, timeout=90):
    query = QUERY_TEMPLATE.format(sl=sl, w0=w0, w1=w1)
    url = WDQS + "?" + urllib.parse.urlencode({"format": "json", "query": query})
    req = urllib.request.Request(
        url,
        headers={"User-Agent": UA, "Accept": "application/sparql-results+json"},
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        data = json.load(resp)
    return data["results"]["bindings"]


def fetch_window(w0, w1, sl, retries=3):
    """Fetch one birth-year window with retries; raise on persistent failure."""
    last_err = None
    for attempt in range(retries):
        try:
            return run_query(w0, w1, sl)
        except Exception as err:  # noqa: BLE001 - want to retry any failure
            last_err = err
            wait = 5 * (attempt + 1)
            log(f"  ! window {w0}..{w1} failed ({err}); retry in {wait}s")
            time.sleep(wait)
    raise RuntimeError(f"window {w0}..{w1}: {last_err}")


def fetch_range(w0, w1, sl, cache_file, done, depth=0):
    """Fetch [w0, w1) splitting it in half on failure. Returns row count."""
    key = f"{w0}:{w1}:{sl}"
    if key in done:
        return 0
    width = w1 - w0
    t0 = time.time()
    try:
        rows = fetch_window(w0, w1, sl)
    except Exception:
        if width <= 1 or depth > 8:
            raise
        mid = w0 + width // 2
        n = fetch_range(w0, mid, sl, cache_file, done, depth + 1)
        n += fetch_range(mid, w1, sl, cache_file, done, depth + 1)
        return n
    with cache_file.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps({"window": [w0, w1], "sl": sl, "rows": rows}) + "\n")
    done.add(key)
    log(f"  window {w0}..{w1}: {len(rows)} rows in {time.time() - t0:.0f}s")
    return len(rows)


def iter_windows(lo, hi):
    y = lo
    while y < hi:
        w = window_width(y)
        yield y, min(y + w, hi)
        y += w


def fetch_dataset(lo, hi, sl, refresh=False):
    """Download all humans born in [lo, hi) with >= sl sitelinks."""
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cache_file = CACHE_DIR / f"windows_{sl}.jsonl"
    done = set()
    people = {}
    if cache_file.exists() and not refresh:
        with cache_file.open(encoding="utf-8") as fh:
            for line in fh:
                rec = json.loads(line)
                done.add(f"{rec['window'][0]}:{rec['window'][1]}:{rec['sl']}")
                ingest_rows(rec["rows"], people)
        log(f"cache: {len(people)} people from {len(done)} windows")
    total = 0
    for w0, w1 in iter_windows(lo, hi):
        total += fetch_range(w0, w1, sl, cache_file, done)
        time.sleep(0.5)
    if total:
        # re-load everything so `people` includes the new windows too
        people = {}
        with cache_file.open(encoding="utf-8") as fh:
            for line in fh:
                rec = json.loads(line)
                ingest_rows(rec["rows"], people)
    return people


YEAR_RE = re.compile(r"^([+-]?\d{4,})")


def year_of(dt):
    m = YEAR_RE.match(dt)
    return int(m.group(1)) if m else None


def ingest_rows(rows, people):
    """Merge SPARQL rows into {qid: [birth, death_or_None]} (widest interval)."""
    for row in rows:
        qid = row["item"]["value"].rsplit("/", 1)[-1]
        birth = year_of(row["birth"]["value"])
        if birth is None:
            continue
        death_raw = row.get("death", {}).get("value")
        death = year_of(death_raw) if death_raw else None
        cur = people.get(qid)
        if cur is None:
            people[qid] = [birth, death]
        else:
            cur[0] = min(cur[0], birth)
            if death is not None:
                cur[1] = death if cur[1] is None else max(cur[1], death)


# ---------------------------------------------------------------- solving

def solve(people, start, end):
    """
    Greedy minimum interval cover of [start, end].

    `people` maps qid -> [birth, death_or_None]. The website always
    preloads Socrates, so coverage starts at his death (he covers
    [TIMELINE_START, -399] and the website rejects anyone dying earlier).
    Returns (selected, reach) where reach is the right end of coverage;
    reach < end means there is an unavoidable gap at [reach, end].
    """
    intervals = []
    for qid, (birth, death) in people.items():
        death = end if death is None else death
        # the website refuses people who died before Socrates
        if death <= SOCRATES[2]:
            continue
        intervals.append((birth, death, qid))
    intervals.sort(key=lambda t: (t[0], t[1]))

    reach = max(start, SOCRATES[2])
    selected = []
    i = 0
    n = len(intervals)
    best_end = -10**9
    while reach < end:
        while i < n and intervals[i][0] <= reach:
            if intervals[i][1] > best_end:
                best_end = intervals[i][1]
            i += 1
        if best_end <= reach:
            return selected, reach  # gap from `reach` to `end`
        # find the actual person achieving best_end among scanned ones
        cand = max(
            (p for p in intervals[:i] if p[1] == best_end),
            key=lambda t: t[0],
            default=None,
        )
        selected.append(cand)
        reach = best_end
    return selected, reach


def merged_coverage(intervals):
    out = []
    for s, e in sorted(intervals):
        if not out or s > out[-1][1]:
            out.append([s, e])
        elif e > out[-1][1]:
            out[-1][1] = e
    return out


def verify(selected, start, end):
    """Re-check the solution exactly the way the website computes it."""
    ivs = [[SOCRATES[1], SOCRATES[2]]]
    for _, _, qid in selected:
        birth, death = qid_dates[qid]
        ivs.append([birth, end if death is None else death])
    merged = merged_coverage(ivs)
    gaps = []
    prev = start
    for s, e in merged:
        if s > prev:
            gaps.append((prev, s))
        prev = max(prev, e)
    if prev < end:
        gaps.append((prev, end))
    return gaps


# ---------------------------------------------------------------- labels

def fetch_labels(qids):
    labels = {}
    qids = list(qids)
    for j in range(0, len(qids), 50):
        batch = qids[j : j + 50]
        url = (
            WDAPI
            + "?"
            + urllib.parse.urlencode(
                {
                    "action": "wbgetentities",
                    "ids": "|".join(batch),
                    "props": "labels",
                    "languages": "en",
                    "format": "json",
                }
            )
        )
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                data = json.load(resp)
            for qid, ent in data.get("entities", {}).items():
                labels[qid] = ent.get("labels", {}).get("en", {}).get("value", qid)
        except Exception as err:  # noqa: BLE001 - labels are best-effort
            log(f"  ! label fetch failed: {err}")
    return labels


# ---------------------------------------------------------------- main

def parse_args(argv):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--start", type=int, default=TIMELINE_START, help="first year to cover (default: Socrates' birth, -470; >= -470)")
    p.add_argument("--end", type=int, default=datetime.date.today().year, help="last year to cover (default: current year)")
    p.add_argument("--min-sitelinks", type=int, default=5, help="notability filter: minimum Wikidata sitelinks (default: 5)")
    p.add_argument("--out", type=Path, default=HERE / "solution.json", help="output solution file (website-compatible)")
    p.add_argument("--report", type=Path, default=HERE / "solution-report.json", help="human-readable report next to the solution")
    p.add_argument("--refresh", action="store_true", help="ignore and re-download cached dataset windows")
    p.add_argument("--offline", action="store_true", help="only solve from cache; do not fetch anything")
    return p.parse_args(argv)


def main(argv=None):
    global qid_dates
    args = parse_args(argv)

    start = max(args.start, TIMELINE_START)
    end = args.end
    if end <= start:
        log("error: --end must be after --start")
        return 2
    # anyone who could cover `start` was born at most ~130 years before it
    fetch_lo = start - 130
    fetch_hi = end + 1

    log(f"solving [{start}, {end}] with min-sitelinks >= {args.min_sitelinks}")

    people = fetch_dataset(fetch_lo, fetch_hi, args.min_sitelinks, refresh=args.refresh) \
        if not args.offline else {}
    if args.offline:
        cache_file = CACHE_DIR / f"windows_{args.min_sitelinks}.jsonl"
        if not cache_file.exists():
            log(f"error: no cache at {cache_file}; run without --offline first")
            return 2
        people = {}
        with cache_file.open(encoding="utf-8") as fh:
            for line in fh:
                ingest_rows(json.loads(line)["rows"], people)
    # restrict to people that can matter for [start, end]
    people = {
        qid: bd for qid, bd in people.items()
        if bd[1] is None or bd[1] > start
    }
    log(f"dataset: {len(people)} usable people")

    qid_dates = people
    selected, reach = solve(people, start, end)
    gaps = verify(selected, start, end)

    # If the dataset leaves a gap, widen the net: refetch just the gap's
    # birth range at a much lower notability threshold and try again.
    attempts = 0
    while gaps and not args.offline and attempts < 2:
        attempts += 1
        g0, g1 = gaps[0]
        low_sl = max(1, args.min_sitelinks - 4) if attempts == 1 else 1
        log(f"gap at [{g0}, {g1}] - refetching births {g0 - 130}..{g1} with sitelinks >= {low_sl}")
        low_people = fetch_dataset(g0 - 130, g1 + 1, low_sl, refresh=False)
        # union of both datasets, keeping the widest interval per person
        for qid, bd in low_people.items():
            cur = people.get(qid)
            people[qid] = bd if cur is None else [
                min(cur[0], bd[0]),
                bd[1] if cur[1] is None else (cur[1] if bd[1] is None else max(cur[1], bd[1])),
            ]
        qid_dates = people
        selected, reach = solve(people, start, end)
        gaps = verify(selected, start, end)

    log(f"\nselected {len(selected)} people:")
    labels = fetch_labels(qid for _, _, qid in selected)
    for birth, death, qid in selected:
        label = labels.get(qid, qid)
        d = "alive" if death >= end and people[qid][1] is None else str(death)
        log(f"  {label:32s} {birth:>5} .. {d:>5}  (https://www.wikidata.org/wiki/{qid})")

    if gaps:
        log(f"\nFAILED: no person in the dataset can bridge {gaps[0][0]}..{gaps[0][1]}")
        log("Try a lower --min-sitelinks (e.g. 1) or a narrower --start/--end.")
        return 1

    assert not gaps
    # website-compatibility checks
    for birth, death, qid in selected:
        assert death > SOCRATES[2], f"{qid} would be rejected by the website"
        assert birth is not None
    if start <= SOCRATES[2]:
        assert selected and selected[0][0] <= SOCRATES[2], "first pick must overlap Socrates"

    ids = [qid for _, _, qid in selected]
    args.out.write_text(json.dumps({"version": 1, "ids": ids}, indent=2) + "\n", encoding="utf-8")
    report = {
        "start": start,
        "end": end,
        "people": len(ids),
        "min_sitelinks": args.min_sitelinks,
        "chain": [
            {
                "id": qid,
                "label": labels.get(qid, qid),
                "birth": b,
                "death": ("alive" if people[qid][1] is None else people[qid][1]),
                "wikidata": f"https://www.wikidata.org/wiki/{qid}",
            }
            for b, d, qid in selected
        ],
    }
    args.report.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    log(f"\nOK: {start}..{end} covered gap-free with {len(ids)} people")
    log(f"solution: {args.out}")
    log(f"report:   {args.report}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
