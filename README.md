# monkleads: lead finder for The Monk Press

A command-line tool for **The Monk Press** (themonkpress.com), Jeremy Monk's one-person web design
studio in Rensselaer County, NY. It does four things:

1. **Finds** owner-run local businesses (restaurants, cafes, salons, barbers, contractors, auto shops,
   bakeries, retail, landscapers…) in Troy, Rensselaer, East Greenbush, North Greenbush, Brunswick,
   Schodack, Hoosick Falls, Sand Lake, Nassau and the rest of the county, with an optional radius
   into Albany and Saratoga counties. It uses the official Google Places API (New).
2. **Audits** each business's website: Google PageSpeed Insights (mobile), polite HTML checks, and a
   phone-sized screenshot for the free audit video.
3. **Scores** each lead 0–100. Every point has a written reason. The tool also suggests a plan
   (Starter / Standard / Online Store / Custom) with a one-line reason.
4. **Drafts** talking points: the top 3 problems in plain English, a short opener in Jeremy's voice
   that offers the free audit or free mockup, and a CAN-SPAM-compliant email draft.

> **Nothing is ever sent.** The tool only writes drafts to a local database, an HTML report, CSV, and
> Excel. Jeremy decides who to call, visit, or email, and sends everything himself.

---

## Contents

- [Quick start](#quick-start)
- [Getting the Google API keys](#getting-the-google-api-keys)
- [Commands](#commands)
- [A typical week](#a-typical-week)
- [Configuration](#configuration)
- [How scoring works](#how-scoring-works)
- [Example output](#example-output)
- [Compliance and safety](#compliance-and-safety)
- [Costs](#costs)
- [Project layout](#project-layout)
- [Development](#development)
- [Troubleshooting](#troubleshooting)

---

## Quick start

Requires **Python 3.11+**.

```bash
git clone <this repo> monkleads && cd monkleads
python -m venv .venv && source .venv/bin/activate      # Windows: .venv\Scripts\activate

pip install -e ".[all]"            # core + screenshots (Playwright) + Claude openers (anthropic)
playwright install chromium        # one-time browser download for screenshots

cp .env.example .env               # then paste your API keys into .env
# Edit config.yaml: at minimum fill in sender.physical_address, sender.email, sender.phone

monkleads run --dry-run            # shows the searches and the estimated cost; calls no APIs
monkleads run                      # discover → audit → score → report → export
```

Results go to `data/`:

| Path | What |
|---|---|
| `data/leads.db` | SQLite database (businesses, audits, scores, outreach status, notes, API cache) |
| `data/reports/leads-YYYYMMDD-HHMM.html` | HTML report of the top leads, with screenshots |
| `data/exports/leads-YYYYMMDD-HHMM.xlsx` / `.csv` | Ranked lead list |
| `data/screenshots/*.png` | Phone screenshots for audit videos |
| `data/monkleads.log` | JSON-lines log of every run |

Minimal install without screenshots or Claude: `pip install -e .` (then run with `--no-screenshots`).

## Getting the Google API keys

You need one Google Cloud API key. The same key can serve both APIs.

1. Go to <https://console.cloud.google.com/> and **create a project** (e.g. "Monk Press Leads").
2. **Enable billing** for the project (*Billing → Link a billing account*). The Places API needs a
   billing account even when your usage is covered by Google's monthly free allowance.
3. **Enable the APIs** (*APIs & Services → Library*):
   - **Places API (New)**: the "New" one, not the legacy "Places API".
   - **PageSpeed Insights API**.
4. **Create a key** (*APIs & Services → Credentials → Create credentials → API key*).
5. **Restrict the key** (click the key → *API restrictions → Restrict key*) to *Places API (New)*
   and *PageSpeed Insights API*. If you only run the tool from home, also add an IP restriction.
6. **Protect your wallet**:
   - *Billing → Budgets & alerts*: create a budget (e.g. $25/month) with email alerts.
   - *APIs & Services → Places API (New) → Quotas*: cap "SearchText requests per day" (e.g. 500).
7. Put the key in `.env`:

   ```dotenv
   GOOGLE_PLACES_API_KEY=AIza...
   # optional; falls back to GOOGLE_PLACES_API_KEY. PSI also works keyless at a low quota.
   GOOGLE_PAGESPEED_API_KEY=
   ```

**Optional, Claude-written openers.** Get a key at <https://console.anthropic.com/>, put
`ANTHROPIC_API_KEY=...` in `.env`, and pass `--llm` (or set `llm.enabled: true`). Without it, the
built-in templates write the openers, and they work fine.

Keys are only ever read from the environment or `.env` and never written to disk by the tool.
`.env` is in `.gitignore`.

## Commands

All commands accept `-c/--config PATH` (default `config.yaml`), `-v/--verbose`, and `--log-json`.

| Command | What it does |
|---|---|
| `monkleads discover` | Search Places by town × category, dedupe, drop chains/closed/out-of-area, store. Prints the estimated cost first. `--town/-t`, `--category/-k` (repeatable), `--extended` (Albany/Saratoga), `--dry-run`, `--yes`. |
| `monkleads audit` | Audit leads that were never audited, are older than `audit.stale_after_days`, or changed website. `--force`, `--limit N`, `--id N`, `--no-psi`, `--no-screenshots`, `--dry-run`. |
| `monkleads score` | Score, suggest a plan, write problems, opener, and email draft. `--llm/--no-llm`, `--dry-run`. |
| `monkleads report` | HTML report of the top N leads (`--top`, `--out`). |
| `monkleads export` | Ranked CSV + formatted Excel (`--format csv\|xlsx\|both`, `--top`, `--min-score`, `--out-dir`). |
| `monkleads leads` | Ranked table in the terminal (`--top`, `--status`). |
| `monkleads show ID` | Full call sheet for one lead: score breakdown, problems, plan, opener, email draft, notes. |
| `monkleads status ID STATUS` | Set `new / contacted / replied / meeting / won / lost / do_not_contact`, with `--note "..."`. `do_not_contact` also adds the business to the suppression list. |
| `monkleads suppress VALUE` | Add a place id / phone / domain / name to the suppression list. |
| `monkleads run` | The whole pipeline: discover → audit → score → report → export. `--skip-discover` reuses the database. |

`ID` is the number shown in the report, Excel, and `leads` table. A Google `place_id` also works.

## A typical week

```bash
monkleads run --town Troy --town Rensselaer -k restaurant -k cafe -k barber   # focused run
monkleads leads --top 15                    # who to contact this week
monkleads show 42                           # read the call sheet before calling
monkleads status 42 contacted --note "Talked to Maria; send audit video Friday"
monkleads status 42 meeting   --note "Coffee Tue 10am at the shop"
monkleads status 17 do_not_contact --note "Asked not to be contacted"
monkleads run --skip-discover               # a month later: re-audit stale leads, re-rank
```

Runs are incremental:

- **Discovery** re-uses cached Places responses for `cache.places_ttl_days`. Re-running the same
  searches inside that window costs nothing.
- **Audits** only re-check leads whose last audit is older than `audit.stale_after_days` (default 30),
  or whose website changed on Google.
- Leads marked **won** or **do_not_contact** are never re-audited, re-scored, reported, or exported.
  **lost** leads stay visible so you can revisit them later.

## Configuration

Everything that affects who gets found, how they're scored, and what it costs lives in
[`config.yaml`](config.yaml). Highlights:

```yaml
towns:
  - { name: Troy,          lat: 42.7284, lng: -73.6918, radius_km: 6 }
  - { name: Hoosick Falls, lat: 42.9006, lng: -73.3515, radius_km: 5 }
  - { name: Albany, county: Albany, lat: 42.6526, lng: -73.7562, radius_km: 6, extended: true }

categories:
  - { key: restaurant, query: restaurant,          group: food,   fit: high }
  - { key: barber,     query: barber shop,         group: beauty, fit: high }
  - { key: contractor, query: general contractor,  group: trades, fit: high }
  - { key: florist,    query: florist,             group: retail, fit: medium }

discovery:
  max_pages_per_query: 2        # 1–3 pages of 20 results, each page billed as one request
  include_extended_area: false  # or --extended
  max_distance_miles: 30        # from discovery.origin (Troy)

chains:
  min_locations: 3              # same name at 3+ addresses => chain
  blocklist: [McDonald's, Dunkin, Stewart's Shops, Great Clips, Jiffy Lube, ...]

audit:
  stale_after_days: 30
  per_host_min_interval_s: 1.5  # politeness delay between requests to the same site

scoring:
  weights: { no_website: 60, social_only: 45, broken_site: 55, poor_mobile_speed: 25, ... }
  reputation_min_rating: 4.3
  reputation_min_reviews: 25

sender:
  name: Jeremy Monk
  business: The Monk Press
  physical_address: ""          # REQUIRED for email drafts (CAN-SPAM)
```

Relative paths in the config (`data_dir`, `suppression_file`) resolve against the config file's folder.

## How scoring works

A score is the sum of the points below, capped to 0–100. Each line becomes a stored, human-readable
reason (`monkleads show ID` → "Why this score"). All weights are in `config.yaml → scoring.weights`.

| Factor | Default | When |
|---|---:|---|
| No website | +60 | No website on the Google listing |
| Broken site | +55 | DNS failure, 4xx/5xx, unreachable, parked / for sale, expired, "coming soon", dead `business.site` link |
| Social-only "website" | +45 | Listing points to Facebook / Instagram / Linktree… |
| Poor mobile speed | +25 | PageSpeed mobile performance < 50 (`mediocre`: +10 below 70) |
| SSL invalid / no HTTPS | +15 / +12 | Certificate errors / site served over plain http |
| No mobile viewport | +15 | Site isn't set up for phones |
| Stale copyright | +10 | Footer year older than `copyright_stale_age_years` (©2019 or earlier in 2026) |
| Dated platform / old WordPress / old markup | +10 / +8 / +10 | Weebly, Jimdo, Google Sites, FrontPage…; WordPress < 6; frames, Flash, `<font>` |
| Missing title/description, tap-to-call, contact form, hours, map | +5 / +6 / +4 / +4 / +2 | |
| **Reputation bonus** | +12 | Rating ≥ 4.3 **and** ≥ 25 reviews **and** a weak/missing site: a good business that can afford it and is missing customers |
| **Category fit** | +8 / +4 | `fit: high` / `fit: medium` categories |
| Distance | −0.5/mile | Beyond 5 miles from Troy, capped at −15 |
| Few reviews | −5 | Fewer than 3 reviews (may be inactive) |
| Temporarily closed | −15 | |

A site that blocks automated checks (HTTP 403, or `robots.txt` asks us not to fetch it) isn't
penalized for things that weren't checked.

**Plan suggestion** (first rule that matches):

| Plan | Rule |
|---|---|
| Online Store | Site already has a cart / shop, or a retail category ("sells products → Online Store") |
| Custom | Online booking or ordering to integrate and ≥ 200 reviews |
| Standard | Food business ("has a menu → Standard"), takes appointments, or an established trade/auto/beauty business (≥ 50 reviews) |
| Starter | Everything else ("simple local service → Starter (home, services, contact)") |

## Example output

`monkleads leads`:

```
┏━━━━┳━━━━━━━┳━━━━━━━━━━━━━━━━━━━━━━━┳━━━━━━━━━━━━━━━━┳━━━━━━━━━━━━━━━━━━━━━━━━━━━━┳━━━━━━━━━━┳━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┳━━━━━━━━━━━┓
┃ ID ┃ Score ┃ Business              ┃ Town           ┃ Site                       ┃ Plan     ┃ Top problem                                ┃ Status    ┃
┡━━━━╇━━━━━━━╇━━━━━━━━━━━━━━━━━━━━━━━╇━━━━━━━━━━━━━━━━╇━━━━━━━━━━━━━━━━━━━━━━━━━━━━╇━━━━━━━━━━╇━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╇━━━━━━━━━━━┩
│ 2  │ 94    │ Hudson Valley Auto    │ East Greenbush │ ok                         │ Standard │ Your site isn't set up for phones, so      │ new       │
│    │       │                       │                │                            │          │ visitors have to pinch and zoom to read it.│           │
│ 1  │ 80    │ Riverside Bakery      │ Troy           │ none                       │ Standard │ Your Google listing has no website link…   │ new       │
│ 4  │ 61    │ Sand Lake Landscaping │ Sand Lake      │ broken: under_construction │ Starter  │ Your website still says 'coming soon'…     │ contacted │
│ 3  │ 57    │ Main Street Barbers   │ Hoosick Falls  │ social_only                │ Starter  │ Your Google listing sends people to your   │ new       │
│    │       │                       │                │                            │          │ Facebook page instead of a website…        │           │
└────┴───────┴───────────────────────┴────────────────┴────────────────────────────┴──────────┴────────────────────────────────────────────┴───────────┘
```

`monkleads show 2` (example business):

```
───────────────────────── Hudson Valley Auto  ·  score 94  ·  ID 2 ─────────────────────────
5 Columbia Tpke, East Greenbush, NY 12061, USA
(518) 555-0101  http://hudsonvalleyauto.example
Google: 4.6★ from 88 reviews  ·  status: new

Why this score
     +12  No HTTPS (browser shows 'Not secure')
     +15  Not set up for phones (no viewport tag)
     +10  Footer copyright is 2017
      +8  Old WordPress version 4.9.8
     +10  Uses outdated markup: <font> tags
      +5  Missing page description
      +6  No tap-to-call phone link
      +4  No contact form
      +4  Hours not listed on the site
      +2  No map or directions link
     +12  Strong reputation (4.6★, 88 reviews) but weak web presence
      +8  Good-fit category (auto_repair, high)
      -2  8.9 miles from Troy
       =  94

Top problems
  1. Your site isn't set up for phones, so visitors have to pinch and zoom to read it.
  2. Your site isn't secure (no padlock), so Chrome labels it 'Not secure'.
  3. The footer says ©2017, which makes the site look like nobody's minding it.

Suggested plan: Standard: established business (88 reviews) with several services → Standard

Opener (template)
Hi, I'm Jeremy Monk. I run The Monk Press, a one-person web design shop here in Rensselaer
County. I pulled up Hudson Valley Auto's website on my phone and noticed your site isn't set up
for phones (lots of pinching and zooming). With 4.6 stars from 88 reviews, your customers clearly
love you. If it'd help, I'll do a free audit: I go through your site on a phone and send a short
video with the three things I'd fix first. No cost, no pressure. — Jeremy

Email draft (review before sending)
Subject: A quick idea for Hudson Valley Auto's website

Hi, I'm Jeremy Monk. … No cost, no pressure. — Jeremy

--
Jeremy Monk
The Monk Press
PO Box 123, Troy, NY 12180
https://themonkpress.com

This is a one-time note about my web design services.
If you'd rather not hear from me again, just reply "no thanks" and I won't contact you again.
```

For a business with **no website**, the opener offers the free mockup instead:

> Hi, I'm Jeremy Monk. I run The Monk Press, a one-person web design shop here in Rensselaer
> County. I came across Riverside Bakery on Google and noticed your Google listing doesn't have a
> website link. With 4.8 stars from 212 reviews, your customers clearly love you. If it'd help, I'd
> be glad to put together a free mockup of a simple site, just so you can see it. No cost, no
> pressure. — Jeremy

The **HTML report** shows one card per lead: phone screenshot, score badge, plan, top problems,
opener, and collapsible "Why this score" and email draft. The **Excel file** is ranked, with a
red→green color scale on Score, highlighted site problems, frozen headers, filters, clickable links
to the website, Google Maps listing, and screenshot, and a "How to read" sheet.

## Compliance and safety

- **Official APIs only.** Business data comes from the Google Places API (New). Nothing is scraped
  from Google Maps, LinkedIn, or any directory. Only public business-listing fields are requested
  (name, address, business phone, website, rating, review count, hours, status, categories).
  No reviews, reviewer names, photos, or personal data about owners or employees are collected.
- **Google terms.** Google's Maps Platform terms limit how long Places content (other than place
  IDs) may be stored, and require attribution when it is shown outside a Google map. The report and
  Excel file credit Google as the data source. Review the current
  [Maps Platform Service Specific Terms](https://cloud.google.com/maps-platform/terms) and set
  `cache.places_ttl_days` and how often you re-run discovery to match.
- **Polite site checks.** One homepage request per site (plus `robots.txt` and an http→https check),
  a clear User-Agent (`MonkPressSiteCheck/1.0 (+https://themonkpress.com …)`), `robots.txt`
  honored for that agent, at least `per_host_min_interval_s` between requests to the same host,
  timeouts, and capped retries with exponential backoff. Screenshots are only taken of pages
  `robots.txt` allows.
- **Never sends anything.** No email, SMS, or form submissions. Drafts only.
- **CAN-SPAM.** Email drafts include the sender's real name and business, a valid postal address
  (`sender.physical_address`; drafts are skipped with a warning until it's filled in), a
  non-deceptive subject, a line identifying the message as an ad, and a plain opt-out ("reply
  'no thanks'"). Honor opt-outs within 10 business days with `monkleads status ID do_not_contact`.
- **Suppression list.** [`suppression.txt`](suppression.txt) (place ids, phones, domains, or names)
  is checked before every export and report, and before audits and scoring. `do_not_contact`
  entries are written there automatically, so they survive even if the database is deleted.
- **Spreadsheet safety.** Text from the web is escaped so it can't run as a formula in Excel.

## Costs

The tool prints an estimate before spending money, and asks for confirmation above
`costs.confirm_over_usd` (default $5; skip with `--yes`). In `--dry-run` mode it calls no APIs.

| API | Price used for estimates | Notes |
|---|---|---|
| Places Text Search (Enterprise SKU) | $35 / 1,000 requests | Each page of up to 20 results is one request. Google gives a monthly free allowance per SKU that the estimate doesn't subtract. Check current prices: <https://developers.google.com/maps/billing-and-pricing/pricing>. |
| PageSpeed Insights | free | A key raises the daily quota. Results cached for `cache.pagespeed_ttl_days`. |
| Claude (optional `--llm`) | ~$0.016 per opener | `claude-opus-5-5`, low effort, ~900 input / ~600 output tokens. Cached per unchanged lead. |

Example: all 19 core towns × 18 categories × up to 2 pages = 342–684 requests ≈ $12–$24, once a
month. Re-runs inside the cache window are free. Start with a few towns and categories.

## Project layout

```
.
├── README.md
├── pyproject.toml              # package, dependencies, tool config (pytest, ruff, mypy)
├── config.yaml                 # towns, categories, weights, costs, sender identity
├── .env.example                # API key placeholders (copy to .env)
├── suppression.txt             # never-contact list, checked before every export
├── src/monkleads/
│   ├── cli.py                  # Typer CLI: discover, audit, score, report, export, status, run, ...
│   ├── config.py               # pydantic config models + .env secrets
│   ├── db.py                   # SQLAlchemy models: businesses, audits, scores, outreach, cache
│   ├── pipeline.py             # orchestration, incremental selection, cost estimates
│   ├── http.py                 # retries (tenacity), per-host rate limiting, robots.txt
│   ├── cache.py                # API response cache in SQLite
│   ├── geo.py                  # distance helper
│   ├── discovery/
│   │   ├── places.py           # Google Places API (New) client
│   │   └── normalize.py        # phone/domain/name normalization, dedupe, chain detection
│   ├── audit/
│   │   ├── site_checks.py      # httpx + BeautifulSoup checks
│   │   ├── pagespeed.py        # PageSpeed Insights (mobile)
│   │   └── screenshot.py       # Playwright mobile screenshots
│   ├── scoring.py              # transparent scoring + plan suggestion
│   ├── talking_points.py       # plain-English problems + template opener
│   ├── llm.py                  # optional Claude opener (behind --llm)
│   ├── compliance.py           # suppression list + CAN-SPAM email drafts
│   ├── export.py               # CSV + formatted Excel
│   ├── report.py               # HTML report
│   ├── logging_setup.py        # structured logging (rich console / JSON lines)
│   └── templates/report.html.j2
└── tests/                      # pytest, all HTTP mocked (respx)
```

## Development

```bash
pip install -e ".[all,dev]"
pytest                 # 97 tests, no network needed (HTTP mocked with respx)
ruff check src tests && ruff format --check src tests
mypy src               # strict
```

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Places API ... returned 403: ... not been used / disabled` | Enable **Places API (New)** for the key's project, and check the key's API restrictions. |
| `GOOGLE_PLACES_API_KEY is not set` | Create `.env` from `.env.example`, or export the variable. |
| "playwright not installed" / "could not start headless browser" | `pip install -e ".[screenshots]" && playwright install chromium`, or set `audit.chromium_executable` to an installed Chrome/Chromium. Use `--no-screenshots` to skip. |
| Email drafts missing, warning about `physical_address` | Fill in `sender.physical_address` in `config.yaml` (a street address or registered PO box). |
| A site shows "blocked" | It returned 401/403/429 or `robots.txt` disallows `MonkPressSiteCheck`. Check it by hand on your phone. |
| PageSpeed errors / slow | PSI can take 30–60 s per site. Lower `audit.pagespeed_concurrency` or add a key to raise the quota. |
