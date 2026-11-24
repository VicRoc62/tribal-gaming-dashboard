# Tribal Gaming Dashboard · Pechanga.net

A free public dashboard from [Pechanga.net](https://pechanga.net/) that tracks prediction-market court cases, tribal gaming policy, NIGC revenue and which tribes are in the news.

Live site: https://vicroc62.github.io/tribal-gaming-dashboard/ (served by GitHub Pages from the `gh-pages` branch).

## How it works

The site is static: `index.html`, `style.css` and `app.js` draw everything in the browser from the JSON files in `data/`. Updating the dashboard means updating those files and pushing to `gh-pages`; GitHub Pages republishes within a few minutes.

| File | What it holds | How it is updated |
|---|---|---|
| `data/litigation.json` | Prediction-market case tracker | Daily review; a change is published only when confirmed by a court record or two independent reputable reports. Optional `source_url` per case. |
| `data/policy.json` | Bills, CFTC rulemakings, state actions | Daily review, same rule |
| `data/key_dates.json` | Upcoming hearings and deadlines | Daily; past dates drop off automatically in the page |
| `data/news_stories.json`, `data/news_mentions.json` | Pechanga.net stories on tribal topics, last 30 days, tagged by tribe and issue | `python3 scripts/update_news.py` |
| `data/ggr_*.json` | NIGC gross gaming revenue | Once a year, when NIGC publishes (usually July) |
| `data/meta.json` | "Data as of" dates | Each update |

## Tribes In The News

`scripts/update_news.py` fetches new Pechanga.net story pages by ID (`https://pechanga.net/story-p{ID}-1.htm`), one at a time and under the site's rate limit, tags each story with the tribes it names and up to two issues, and keeps the last 30 days. Tribe names, states, short names and casino brands live in `scripts/tribes.py`; edit that list to fix a missed or wrong match, then run `python3 scripts/update_news.py --retag`.

## Credits

- Charts: [D3](https://d3js.org/) (ISC license, `vendor/d3-LICENSE.txt`).
- Map outlines: U.S. Census Bureau boundaries via [us-atlas](https://github.com/topojson/us-atlas).
