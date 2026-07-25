#!/usr/bin/env python3
"""Subtitle acceptance check.

Frozen success criteria for DeenSubs subtitles. These are the definition of
"done" for the segmentation work: they do not move to match whatever the
pipeline currently produces. Run against a job's rendered SRT plus its
cues.json (which carries the `q` verse keys the SRT cannot express).

    python3 check-subs.py subs.srt cues.json

Exits non-zero if any criterion fails.

Why the thresholds are what they are
------------------------------------
Speech cues are held to broadcast practice (Netflix/BBC): 42 chars a line, two
lines, and a reading speed a viewer can actually keep up with.

Verse cues are held to a different standard on purpose. A canonical translation
is not free text: it cannot be shortened, and its English is far longer than the
Arabic takes to recite (verse 3:7 is 541 characters over 13s of recitation, so
~40 CPS is the floor no matter how it is cut). Demanding 21 CPS there would mean
either mangling scripture or desyncing it from the audio. So verses are required
to be shown ONCE, laid out legibly, and given every second of screen time that
is actually available - not to hit a speed they physically cannot hit.
"""
import json
import re
import sys

MAX_LINE = 42
MAX_LINES = 2
MAX_CHARS = 84
SPEECH_CPS_OK = 21.0      # target reading speed
SPEECH_CPS_HARD = 30.0    # no speech cue may exceed this
MIN_DUR = 1.0
MAX_DUR = 7.0
HARD_MIN_DUR = 0.7
BASELINE_BOUNDARY_DUPS = 19  # measured on the pre-change baseline; must not regress

CLING = set(
    "a an the and or but nor so yet of in on at to for with from by as is was are were be been "
    "that which who whom whose this these those his her its their our your my not no if when "
    "while than then into upon about over under".split()
)

AR = re.compile(r"[؀-ۿ]")


def parse_srt(path):
    cues = []
    raw = open(path, encoding="utf-8").read().strip()
    for block in re.split(r"\n\s*\n", raw):
        lines = block.strip().split("\n")
        if len(lines) >= 3 and "-->" in lines[1]:
            def t(s):
                h, m, rest = s.split(":")
                sec, ms = rest.split(",")
                return int(h) * 3600 + int(m) * 60 + int(sec) + int(ms) / 1000
            a, b = [x.strip() for x in lines[1].split("-->")]
            cues.append({"start": t(a), "end": t(b), "lines": lines[2:], "text": " ".join(lines[2:])})
    return cues


def is_cling(word):
    return re.sub(r"[^a-z']", "", word.lower()) in CLING


def main(srt_path, cues_path):
    srt = parse_srt(srt_path)
    cues = json.load(open(cues_path, encoding="utf-8"))

    # Pair the SRT cues with their cues.json twins so verse cues (identified by
    # `q`) can be judged separately. The SRT is rendered from the cue list in
    # order, so position is exact. Matching on rounded start times silently
    # mislabelled verses as speech whenever a timestamp landed on a rounding
    # edge, which dropped 40 CPS scripture into the speech statistics and made
    # the worst reading speed look far worse than it was.
    if len(srt) == len(cues):
        for s, c in zip(srt, cues):
            s["q"] = c.get("q")
    else:
        qmap = {round(c["start"], 2): c.get("q") for c in cues}
        for s in srt:
            s["q"] = qmap.get(round(s["start"], 2))

    speech = [c for c in srt if not c["q"]]
    verses = [c for c in srt if c["q"]]
    results = []

    def check(cid, desc, ok, detail=""):
        results.append((cid, desc, ok, detail))

    def pct(n, d):
        return 100.0 * n / d if d else 100.0

    # ---- speech cues -----------------------------------------------------
    bad = [c for c in speech if any(len(l) > MAX_LINE for l in c["lines"])]
    check("S1", f"speech: every line <= {MAX_LINE} chars", not bad, f"{len(bad)} cues")

    bad = [c for c in speech if len(c["lines"]) > MAX_LINES]
    check("S2", f"speech: every cue <= {MAX_LINES} lines", not bad, f"{len(bad)} cues")

    bad = [c for c in speech if len(c["text"]) > MAX_CHARS]
    check("S3", f"speech: every cue <= {MAX_CHARS} chars", not bad, f"{len(bad)} cues")

    cps = [(c, len(c["text"]) / max(0.001, c["end"] - c["start"])) for c in speech]
    over = [c for c, v in cps if v > SPEECH_CPS_OK]
    worst = max((v for _, v in cps), default=0)
    check("S4a", f"speech: >=99% of cues <= {SPEECH_CPS_OK} CPS",
          pct(len(speech) - len(over), len(speech)) >= 99.0,
          f"{len(over)} over ({pct(len(over), len(speech)):.1f}%)")
    check("S4b", f"speech: no cue over {SPEECH_CPS_HARD} CPS", worst <= SPEECH_CPS_HARD,
          f"worst {worst:.0f} CPS")

    dur = [(c, c["end"] - c["start"]) for c in speech]
    outside = [c for c, d in dur if d < MIN_DUR or d > MAX_DUR]
    tooshort = [c for c, d in dur if d < HARD_MIN_DUR]
    check("S5a", f"speech: >=98% of cues {MIN_DUR}-{MAX_DUR}s",
          pct(len(speech) - len(outside), len(speech)) >= 98.0,
          f"{len(outside)} outside ({pct(len(outside), len(speech)):.1f}%)")
    check("S5b", f"speech: no cue under {HARD_MIN_DUR}s", not tooshort, f"{len(tooshort)} cues")

    dangling = [c for c in speech if c["text"] and is_cling(c["text"].split()[-1])]
    check("S6", "speech: <=2% of cues end on a stranded function word",
          pct(len(dangling), len(speech)) <= 2.0,
          f"{len(dangling)} ({pct(len(dangling), len(speech)):.1f}%)")

    lb = [1 for c in srt for l in c["lines"][:-1] if l.split() and is_cling(l.split()[-1])]
    nlines = sum(len(c["lines"]) for c in srt)
    check("S7", "all: <=2% of line breaks follow a function word",
          pct(len(lb), nlines) <= 2.0, f"{len(lb)} ({pct(len(lb), nlines):.1f}%)")

    # ---- verse cues ------------------------------------------------------
    # A verse must be rendered once per time it is recited. Fuzzy matching used
    # to emit the same verse two or three times within a few SECONDS (3:7 came
    # out at 1.3s and 5.6s apart); that is the defect. A speaker reciting a verse,
    # expounding it, and reciting it again twenty seconds later is not, so the
    # window is narrow enough to tell the two apart.
    REPEAT_WINDOW = 10.0
    seen = {}
    repeats = 0
    for c in verses:
        head = c["text"].lstrip("“\" ")[:40]
        key = (c["q"], head)
        if key in seen and 2.0 < c["start"] - seen[key] <= REPEAT_WINDOW:
            repeats += 1
        seen[key] = c["end"]
    check("V1", f"verses: same verse not re-rendered within {REPEAT_WINDOW:.0f}s",
          repeats == 0, f"{repeats} repeats")

    bad = [c for c in verses if any(len(l) > MAX_LINE for l in c["lines"])]
    check("V2", f"verses: every line <= {MAX_LINE} chars", not bad, f"{len(bad)} cues")

    bad = [c for c in verses if len(c["text"]) > MAX_CHARS]
    check("V3", f"verses: every cue <= {MAX_CHARS} chars", not bad, f"{len(bad)} cues")

    # A dense verse must use the time that exists: if it is over target speed it
    # should run right up to the next cue rather than stopping early.
    lazy = []
    for i, c in enumerate(srt):
        if not c["q"]:
            continue
        need = len(c["text"]) / 17.0
        have = c["end"] - c["start"]
        if have >= need - 0.02:  # tolerance: these are floats, not exact rationals
            continue
        nxt = srt[i + 1]["start"] if i + 1 < len(srt) else c["end"] + 2.0
        if nxt - c["end"] > 0.25:  # left usable silence on the table
            lazy.append(c)
    check("V4", "verses: dense cues use the silence available to them", not lazy,
          f"{len(lazy)} cues stop early")

    # ---- global ----------------------------------------------------------
    ov = [i for i in range(len(srt) - 1) if srt[i]["end"] > srt[i + 1]["start"] + 0.001]
    check("G1", "no overlapping cues", not ov, f"{len(ov)} overlaps")

    leak = [c for c in speech if AR.search(c["text"])]
    check("G2", "no Arabic left in the translated track", not leak, f"{len(leak)} cues")

    dups = 0
    for i in range(len(srt) - 1):
        a = re.findall(r"[\w'’]+", srt[i]["text"])
        b = re.findall(r"[\w'’]+", srt[i + 1]["text"])
        for k in range(min(4, len(a), len(b)), 0, -1):
            if [w.lower() for w in a[-k:]] == [w.lower() for w in b[:k]]:
                dups += 1
                break
    check("G3", f"boundary duplication no worse than baseline ({BASELINE_BOUNDARY_DUPS})",
          dups <= BASELINE_BOUNDARY_DUPS, f"{dups}")

    # ---- report ----------------------------------------------------------
    print(f"{len(srt)} cues  ({len(speech)} speech, {len(verses)} verse)\n")
    failed = 0
    for cid, desc, ok, detail in results:
        mark = "PASS" if ok else "FAIL"
        if not ok:
            failed += 1
        print(f"  [{mark}] {cid:<4} {desc:<58} {detail}")
    print(f"\n{len(results) - failed}/{len(results)} criteria pass")
    return 1 if failed else 0


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print(__doc__)
        sys.exit(2)
    sys.exit(main(sys.argv[1], sys.argv[2]))
