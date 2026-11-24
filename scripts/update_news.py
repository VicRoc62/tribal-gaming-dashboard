#!/usr/bin/env python3
"""Refresh the Tribes In The News data from Pechanga.net.

Reads data/news_stories.json, fetches story pages newer than the highest story ID already
stored (https://pechanga.net/story-p{ID}-1.htm), tags tribes and issues, keeps the last
30 days, and rewrites data/news_stories.json, data/news_mentions.json and data/meta.json.

Usage:
  python3 scripts/update_news.py                 # daily: fetch new stories
  python3 scripts/update_news.py --start 83300   # backfill from a story ID
  python3 scripts/update_news.py --retag         # re-tag stored stories (after editing tribes.py)

Pechanga.net limits requests to roughly 35 pages a minute, so pages are fetched one at a
time with a pause, and the script backs off when the site answers HTTP 429.
"""
import argparse
import datetime as dt
import html
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from tribes import TRIBES, ISSUES, TRIBAL_TERMS  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
STORY_URL = "https://pechanga.net/story-p{id}-1.htm"
UA = "PechangaNetDashboardBot/1.0 (+https://pechanga.net/)"
DELAY = 1.8          # seconds between requests (about 33 a minute)
KEEP_DAYS = 30
MAX_MISSES = 25      # stop after this many consecutive missing IDs

MONTHS = {m: i for i, m in enumerate(["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"], 1)}


def load(name, default):
    p = os.path.join(DATA, name)
    if not os.path.exists(p):
        return default
    with open(p, encoding="utf-8") as f:
        return json.load(f)


def save(name, obj):
    with open(os.path.join(DATA, name), "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=0, separators=(",", ":"))
        f.write("\n")


def fetch(url):
    """Return (status, text). Retries politely on 429 and transient errors."""
    wait = 30
    for attempt in range(6):
        req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "text/html"})
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                raw = r.read()
                enc = r.headers.get_content_charset() or "utf-8"
                return r.status, raw.decode(enc, errors="replace")
        except urllib.error.HTTPError as e:
            if e.code == 429 or e.code >= 500:
                retry = e.headers.get("Retry-After")
                time.sleep(int(retry) if retry and retry.isdigit() else wait)
                wait = min(wait * 2, 300)
                continue
            return e.code, ""
        except (urllib.error.URLError, TimeoutError):
            time.sleep(wait)
            wait = min(wait * 2, 300)
    return 0, ""


def meta(page, prop):
    m = re.search(r'<meta[^>]+(?:property|name|itemprop)=["\']%s["\'][^>]*content=["\']([^"\']*)["\']' % re.escape(prop), page, re.I)
    if not m:
        m = re.search(r'<meta[^>]+content=["\']([^"\']*)["\'][^>]*(?:property|name|itemprop)=["\']%s["\']' % re.escape(prop), page, re.I)
    return html.unescape(m.group(1)).strip() if m else ""


def strip_tags(s):
    s = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", s, flags=re.S | re.I)
    s = re.sub(r"<[^>]+>", " ", s)
    return re.sub(r"\s+", " ", html.unescape(s)).strip()


def parse_date(page, text):
    for prop in ("article:published_time", "datePublished", "pubdate", "date", "DC.date.issued"):
        v = meta(page, prop)
        m = re.match(r"(\d{4})-(\d{2})-(\d{2})", v)
        if m:
            return "%s-%s-%s" % m.groups()
    m = re.search(r'<time[^>]+datetime=["\'](\d{4})-(\d{2})-(\d{2})', page)
    if m:
        return "%s-%s-%s" % m.groups()
    m = re.search(r"\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(20\d\d)\b", text)
    if m:
        return "%04d-%02d-%02d" % (int(m.group(3)), MONTHS[m.group(1).lower()], int(m.group(2)))
    m = re.search(r"\b(\d{1,2})/(\d{1,2})/(20\d\d)\b", text)
    if m:
        return "%04d-%02d-%02d" % (int(m.group(3)), int(m.group(1)), int(m.group(2)))
    return ""


def parse_story(sid, page):
    title = meta(page, "og:title")
    if not title:
        m = re.search(r"<h1[^>]*>(.*?)</h1>", page, re.S | re.I)
        title = strip_tags(m.group(1)) if m else ""
    if not title:
        m = re.search(r"<title>(.*?)</title>", page, re.S | re.I)
        title = strip_tags(m.group(1)) if m else ""
    title = re.sub(r"\s*[|\-–—]\s*Pechanga\.net.*$", "", title, flags=re.I).strip()
    if not title or re.search(r"not found|page cannot|error", title, re.I):
        return None
    summary = meta(page, "og:description") or meta(page, "description")
    body = strip_tags(page)
    date = parse_date(page, body[:4000])
    url = meta(page, "og:url")
    m = re.search(r'<link[^>]+rel=["\']canonical["\'][^>]*href=["\']([^"\']+)', page, re.I)
    if m:
        url = m.group(1)
    if not url or not url.startswith("http"):
        url = STORY_URL.format(id=sid)
    return {"story_id": sid, "date": date, "headline": title, "url": url, "summary": summary[:600]}


def compile_rules():
    tribes = []
    for name, state, aliases, ctx in TRIBES:
        pats = [re.compile(r"(?<![\w-])" + (a if any(c in a for c in "()?\\[") else re.escape(a)) + r"(?![\w-])") for a in aliases]
        tribes.append((name, state, pats, ctx))
    issues = [(n, [re.compile(p, re.I) for p in ps]) for n, ps in ISSUES]
    tribal = [re.compile(p) for p in TRIBAL_TERMS]
    return tribes, issues, tribal


def tag(story, rules):
    tribes, issues, tribal = rules
    text = story["headline"] + ". " + (story.get("summary") or "")
    found = []
    for name, state, pats, ctx in tribes:
        if any(p.search(text) for p in pats) and (not ctx or any(c in text for c in ctx)):
            found.append((name, state))
    # A specific tribe beats a generic match on the same word (e.g. Seminole Nation vs. Seminole Tribe).
    names = [n for n, _ in found]
    if "Seminole Nation of Oklahoma" in names and "Seminole Tribe of Florida" in names and "Florida" not in text:
        found = [f for f in found if f[0] != "Seminole Tribe of Florida"]
    if "Eastern Band of Cherokee Indians" in names and "Cherokee Nation" in names and "Cherokee Nation" not in text:
        found = [f for f in found if f[0] != "Cherokee Nation"]
    is_tribal = bool(found) or any(p.search(text) for p in tribal)
    if not is_tribal:
        return None
    scores = []
    for i, (name, pats) in enumerate(issues):
        hits = sum(len(p.findall(text)) for p in pats)
        if hits:
            scores.append((-hits, i, name))
    scores.sort()
    story = dict(story)
    story["tribes"] = "; ".join(n for n, _ in found)
    story["issues"] = "; ".join(n for _, _, n in scores[:2])
    story["_states"] = {n: s for n, s in found}
    return story


def build_mentions(stories):
    rows = []
    for s in stories:
        states = s.get("_states") or {}
        for t in [x for x in s.get("tribes", "").split("; ") if x]:
            rows.append({"story_id": s["story_id"], "date": s["date"], "kind": "Tribe", "name": t, "state": states.get(t, "")})
        for i in [x for x in s.get("issues", "").split("; ") if x]:
            rows.append({"story_id": s["story_id"], "date": s["date"], "kind": "Issue", "name": i, "state": ""})
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--start", type=int, help="first story ID to fetch (backfill)")
    ap.add_argument("--max", type=int, default=2000, help="most IDs to try this run")
    ap.add_argument("--retag", action="store_true", help="re-tag stored stories without fetching")
    ap.add_argument("--cache", default=os.path.join(ROOT, ".cache", "stories.json"), help="raw story cache (not published)")
    args = ap.parse_args()

    rules = compile_rules()
    state_of = {n: s for n, s, _, _ in TRIBES}
    os.makedirs(os.path.dirname(args.cache), exist_ok=True)
    cache = {}
    if os.path.exists(args.cache):
        with open(args.cache, encoding="utf-8") as f:
            cache = {int(k): v for k, v in json.load(f).items()}

    stories = load("news_stories.json", [])
    known = {s["story_id"] for s in stories}
    raw = {sid: v for sid, v in cache.items()}
    for s in stories:
        raw.setdefault(s["story_id"], {k: s[k] for k in ("story_id", "date", "headline", "url") if k in s} | {"summary": s.get("summary", "")})

    fetched = 0
    if not args.retag:
        sid = args.start or (max(raw) + 1 if raw else None)
        if sid is None:
            sys.exit("No stored stories: pass --start with a recent Pechanga.net story ID.")
        misses = 0
        while misses < MAX_MISSES and fetched < args.max:
            if sid not in raw:
                status, page = fetch(STORY_URL.format(id=sid))
                time.sleep(DELAY)
                st = parse_story(sid, page) if status == 200 and page else None
                if st:
                    raw[sid] = st
                    misses = 0
                    fetched += 1
                    if fetched % 50 == 0:
                        print("fetched", fetched, "through ID", sid, st.get("date"), flush=True)
                        with open(args.cache, "w", encoding="utf-8") as f:
                            json.dump(raw, f, ensure_ascii=False)
                else:
                    misses += 1
            sid += 1
        with open(args.cache, "w", encoding="utf-8") as f:
            json.dump(raw, f, ensure_ascii=False)

    dated = [v for v in raw.values() if v.get("date")]
    if not dated:
        sys.exit("No dated stories found; check the page parser.")
    end = max(dt.date.fromisoformat(v["date"]) for v in dated)
    start = end - dt.timedelta(days=KEEP_DAYS - 1)
    window = [v for v in dated if dt.date.fromisoformat(v["date"]) >= start]
    seen_headlines = set()
    out = []
    for v in sorted(window, key=lambda x: (x["date"], x["story_id"])):
        key = re.sub(r"\W+", " ", v["headline"].lower()).strip()
        if key in seen_headlines:
            continue
        seen_headlines.add(key)
        t = tag(v, rules)
        if t:
            out.append(t)
    mentions = build_mentions(out)
    for s in out:
        s.pop("_states", None)
    # keep raw cache trimmed to a little more than the window
    cutoff = (start - dt.timedelta(days=7)).isoformat()
    with open(args.cache, "w", encoding="utf-8") as f:
        json.dump({k: v for k, v in raw.items() if not v.get("date") or v["date"] >= cutoff}, f, ensure_ascii=False)

    save("news_stories.json", out)
    save("news_mentions.json", mentions)
    meta_doc = load("meta.json", {})
    meta_doc["news_through"] = end.isoformat()
    meta_doc["news_from"] = start.isoformat()
    meta_doc["updated"] = max(meta_doc.get("updated") or "", end.isoformat())
    save("meta.json", meta_doc)
    total_raw = len(window)
    print(json.dumps({"fetched_new": fetched, "stories_in_window": total_raw, "tribal_stories": len(out),
                      "tribes_named": len({m['name'] for m in mentions if m['kind'] == 'Tribe'}),
                      "from": start.isoformat(), "through": end.isoformat(), "unknown_state_tribes": sorted({m['name'] for m in mentions if m['kind'] == 'Tribe' and m['name'] not in state_of})}))


if __name__ == "__main__":
    main()
