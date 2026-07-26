#!/usr/bin/env python3
"""Subtitle acceptance check.

Frozen success criteria for DeenSubs subtitles. These are the definition of
"done" for the segmentation work: they do not move to match whatever the
pipeline currently produces. Run against a job's rendered SRT plus its
cues.json (which carries the `q` verse keys the SRT cannot express).

    python3 check-subs.py subs.srt cues.json asr.json

Exits non-zero if any criterion fails.

Sync is checked against the ASR, not against the pipeline
-------------------------------------------------------
The first sixteen criteria are all about text: how wide a line is, how fast it
reads, whether a verse repeats. A file can satisfy every one of them and still
be unwatchable, and one did: 44% of its cues started somewhere other than the
word they belonged to, and 33 seconds of the lecture played with the speaker
audible and nothing on screen. Nobody noticed until someone watched it.

So sync is measured here directly against the word timings, independently of
whatever the pipeline believes. A cue must begin on a word start (T1), and no
stretch of speech may go uncovered (T2). asr.json is required rather than
optional, because "not checked" must never render as "passed".

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
import bisect
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
ANCHOR_TOL = 0.002        # a cue start must BE a word start, not sit near one
HOLE_TOL = 0.5            # speech on screen for nobody, in seconds
LOITER_MAX = 2.0          # how long a cue may sit on screen after its last word
OPENING_MAX = 8.0         # percent of cues allowed to open on a continuation
PAUSE_MIN = 0.15          # an inter-word gap this long is a real break in delivery
PAUSE_TARGET = 75.0       # percent of cues that must begin after one

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


def main(srt_path, cues_path, asr_path):
    srt = parse_srt(srt_path)
    cues = json.load(open(cues_path, encoding="utf-8"))
    asr = json.load(open(asr_path, encoding="utf-8"))
    words = [w for w in (asr.get("words") or asr) if (w.get("text") or "").strip()]
    word_starts = sorted({round(w["start"], 3) for w in words})

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

    # A cue is "too long" when it OVERSTAYS, not when the speaker simply keeps
    # talking. Capping raw duration is how a 7s display convention came to
    # truncate a 9.6s span of speech and leave a hole in the middle of a
    # sentence, so what is measured here is the silent tail: how long a line sits
    # on screen after its last word was said.
    ends = sorted(w["end"] for w in words)
    starts_only = [w["start"] for w in words]

    def silent_tail(c):
        i = bisect.bisect_left(starts_only, c["start"] - 1e-6)
        last = c["start"]
        while i < len(words) and words[i]["start"] < c["end"] - 1e-6:
            last = max(last, words[i]["end"])
            i += 1
        return max(0.0, c["end"] - last)

    tails = [(c, silent_tail(c)) for c in speech]
    dur = [(c, c["end"] - c["start"]) for c in speech]
    outside = [c for c, d in dur if d < MIN_DUR] + [c for c, t in tails if t > LOITER_MAX]
    tooshort = [c for c, d in dur if d < HARD_MIN_DUR]
    longest = max((d for _, d in dur), default=0)
    worst_tail = max((t for _, t in tails), default=0)
    check("S5a", f"speech: >=98% of cues >= {MIN_DUR}s and idle <= {LOITER_MAX}s after their last word",
          pct(len(speech) - len(outside), len(speech)) >= 98.0,
          f"{len(outside)} outside ({pct(len(outside), len(speech)):.1f}%), "
          f"worst idle {worst_tail:.2f}s, longest cue {longest:.1f}s")
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

    # A cue is read on its own for a few seconds, so it has to stand up on its
    # own. One that opens on a comma or a bare continuation ("and a sun in broad
    # daylight.") is a sentence sliced into boxes, not a subtitle. This is what
    # every other criterion here missed: a file could satisfy all of them with a
    # third of its cues opening mid-sentence.
    def opens_mid_sentence(c):
        t = c["text"].strip().lstrip("\u201c\u201d\"'-\u2013\u2014\u2026 ")
        if not t:
            return False
        if t[0] in ",;:":
            return True
        first = re.split(r"\s+", t)[0].strip(".,;:!?")
        # Lowercase opening is the signal, but a handful of words legitimately
        # begin an English sentence in lowercase after a name or transliteration.
        return bool(re.match(r"^[a-z]", first))

    mid = [c for c in speech if opens_mid_sentence(c)]
    check("N1", f"speech: <={OPENING_MAX}% of cues open mid-sentence",
          pct(len(mid), len(speech)) <= OPENING_MAX,
          f"{len(mid)} ({pct(len(mid), len(speech)):.1f}%)")

    # Did the model cut where the speaker actually broke? The audio is attached
    # to every translation window precisely so it can hear that, and this is the
    # only way to tell from the outside whether it used it. Only 18% of the
    # inter-word gaps in a lecture are real pauses, so landing cue boundaries on
    # them is a deliberate act, not chance. Published baseline was 58%.
    pause_before = {}
    for i in range(1, len(words)):
        pause_before[round(words[i]["start"], 3)] = words[i]["start"] - words[i - 1]["end"]
    onpause = 0
    counted = 0
    for c in speech:
        g = pause_before.get(round(c["start"], 3))
        if g is None:
            continue          # first word of the talk: nothing to pause after
        counted += 1
        if g >= PAUSE_MIN:
            onpause += 1
    check("A1", f">={PAUSE_TARGET:.0f}% of cues begin after a pause of {PAUSE_MIN}s",
          pct(onpause, counted) >= PAUSE_TARGET,
          f"{onpause}/{counted} ({pct(onpause, counted):.1f}%)")

    # ---- sync, measured against the ASR ----------------------------------
    starts = word_starts

    def nearest(vals, x):
        i = bisect.bisect_left(vals, x)
        return min((abs(vals[j] - x) for j in (i - 1, i, i + 1) if 0 <= j < len(vals)), default=1e9)

    off = [(c, nearest(starts, c["start"])) for c in srt]
    drifted = [(d, c) for c, d in off if d > ANCHOR_TOL]
    worst_off = max((d for _, d in off), default=0)
    check("T1", "every cue starts on a spoken word", not drifted,
          f"{len(drifted)} off-anchor ({pct(len(drifted), len(srt)):.1f}%), worst {worst_off:.3f}s")

    # Uncovered speech: a word said while no cue is on screen.
    spans = []
    for c in sorted(srt, key=lambda c: c["start"]):
        if spans and c["start"] <= spans[-1][1] + 1e-6:
            spans[-1][1] = max(spans[-1][1], c["end"])
        else:
            spans.append([c["start"], c["end"]])
    heads = [s[0] for s in spans]

    def on_screen(t):
        i = bisect.bisect_right(heads, t) - 1
        return i >= 0 and spans[i][0] - 1e-6 <= t <= spans[i][1] + 1e-6

    holes = []
    for w in words:
        if on_screen(w["start"]) or on_screen(w["end"]):
            continue
        if holes and w["start"] - holes[-1][1] < 0.4:
            holes[-1][1] = w["end"]
        else:
            holes.append([w["start"], w["end"]])
    holes = [h for h in holes if h[1] - h[0] >= HOLE_TOL]
    lost = sum(h[1] - h[0] for h in holes)
    worst_hole = max((h[1] - h[0] for h in holes), default=0)
    check("T2", f"no speech left uncovered for {HOLE_TOL}s or more", not holes,
          f"{len(holes)} holes, {lost:.1f}s lost, worst {worst_hole:.2f}s"
          + (f" at {int(max(holes, key=lambda h: h[1]-h[0])[0])//60}:"
             f"{int(max(holes, key=lambda h: h[1]-h[0])[0])%60:02d}" if holes else ""))

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
    if len(sys.argv) != 4:
        print(__doc__)
        sys.exit(2)
    sys.exit(main(sys.argv[1], sys.argv[2], sys.argv[3]))
