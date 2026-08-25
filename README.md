# PriceIQ — price & channel intelligence

**A SuperIQ engine.** Buy and sell against live market data.

> ⚠ **Naming.** thesuperiq.com already ships this engine as **PricingIQ** at
> `/pricingiq` — "Price & channel · Buy and sell against live market data" — which
> is precisely this product. It is built here as **PriceIQ** as requested
> (PricingIQ is the only gerund beside GradeIQ, CoreIQ, RefurbIQ, ProcureIQ), but
> the two names must converge: either rename the marketing page, or change
> `PRODUCT` in `lib/brand.ts`. It is one constant so the switch is free.

## Core

Monitors what trade-in programmes pay for a given handset, across **the United
States, the UAE and India**, and makes those prices comparable.

    bash run-tests.sh      # 85 assertions, no install, node only

## Why the core came first

The product looks like a dashboard, so it is tempting to build one. But the
dashboard is the easy half. The hard half is that a table like this is a lie
unless four separate problems are solved first:

| Programme | Device string | Condition | Price |
|---|---|---|---|
| Programme A | `iPhone 15 Pro Max 512GB` | Excellent | AED 3,270 |
| Programme B | `Apple iPhone 15 Pro Max (512 GB)` | Flawless | ₹84,000 |
| Programme C | `IPHONE 15 PRO MAX 512` | Good | $890 |

Are those the same phone? In the same condition? Is $890 better than ₹84,000?
Every one of those questions has a wrong answer that renders beautifully.

So `core/` is the whole product, and it is built and tested before a single
screen exists. Each module owns one of the four problems.

### `device.ts` — is it the same phone?

Resolves a programme's messy listing string to a canonical device. The rule that
makes it trustworthy is that it returns **three** outcomes — matched, ambiguous,
unresolved — and never a best guess. A resolver that always returns its closest
candidate will file a Pro Max under the base model, and nobody finds out until a
customer disputes a number.

### `condition.ts` — is it the same condition?

A programme grade maps to a **span** of the canonical ladder, not a point. A
two-rung programme cannot express five-rung precision, so comparing its "Good"
to a carrier's "Excellent" is *approximate*, and the system says so. Non-
overlapping grades are reported as **incomparable**, which is a real answer the
UI has to be willing to show.

### `money.ts` — is it more money?

Amounts are integers in minor units, and **not every currency has hundredths** —
a market with zero-decimal currency shown at two decimals looks like an
incredible arbitrage. Conversion uses the rate **from the observation date**, and
stores it: converting history at today's rate produces a currency history
wearing a price history's clothes, one that rewrites itself overnight.

### `observation.ts` — did it actually change?

Most polls find the price the last poll found. Those are *confirmations*. Treat
them as changes and "last change: 3mo" — the most useful column on the
dashboard — collapses to "just now" for every programme. Delisting is also
distinguished from a price of zero: "we stopped buying this" and "we will pay
you nothing for this" are different commercial facts.

### `ingest.ts` — the gate

Where the four meet, enforcing one rule: **a row that cannot be resolved is
quarantined, never approximated.** Quarantined rows keep the raw strings, the
reason, the run and the source URL, so clearing the queue is a catalogue edit
rather than a re-scrape.

`ingestHealth().matchRate` is the number to watch. A collector can return 200s
and thousands of rows while the catalogue silently fails to recognise a new
model launch — that ratio sliding is the only visible symptom.

## Collection is gated, not written

`collection.ts` defines the adapter shape and **contains no collector.** How a
programme's prices may be obtained is a legal and commercial question before it
is a technical one, and the answer differs per programme and per country: a
public API, a partner feed, a licensed export, a permitted crawl, or a human
with an account and no automated access at all.

So every programme in `markets.ts` ships `cleared: false`, and `checkClearance`
refuses to run it. A cleared programme with no recorded **authority** is also
refused — a compliance decision that lives only in someone's memory is lost the
moment they leave.

`manualCollector` is a first-class path, not a placeholder. A person reading a
public quote page and typing the number in exercises the entire pipeline against
real prices on day one, while the licensing conversations happen. Nothing
downstream can tell the difference.

## Scope

Three markets, not forty. Coverage is the easy axis to grow and the expensive
one to fake — forty half-working programmes produce a dashboard full of stale
numbers, which is worse than nine that are right. USD, AED and INR between them
already stress the comparison layer properly.

## Market pricing and channels

A trade-in price on its own answers nothing. "Programme A pays $890" is a fact;
whether it is a *good* fact depends on what the handset actually sells for — and
that depends on **who is buying**. Retail, online, wholesale, enterprise and
auction are five different businesses, and averaging them into one "market
price" describes none of them.

`channel.ts` holds the market price (with its **sample size** and **dispersion**,
because a median from two listings is an anecdote), and `spread.ts` does the
subtraction that matters:

    trade-in   $394.16     what the programme pays
    market     $662.35     wholesale, Flawless–Good, 18 comparables
    spread     $268.19     40.5% margin — firm

### Confidence propagates from the weakest input

A spread is `firm` only if **every** input was firm. Any of these makes it
`indicative` — still shown, because a rough number beats none at a counter, but
never dressed as precision it does not have:

- the condition match is approximate rather than exact
- the market price came from fewer than five comparables
- the comparables are scattered
- an FX rate was used from outside the observation window
- the two legs were observed more than a fortnight apart

Where conditions genuinely do not overlap, **no number is produced at all**.

And `rankByChannel` sorts firm above indicative *whatever the margins say*. In
the worked example a 48.4% indicative row sits below a 40.5% firm one —
sorting on margin alone sends a buyer at exactly the row the system is least
sure about, which quietly discards the entire confidence model.

## The app

    npm install && npm run dev     # localhost:4100

Four screens, all server-rendered, all computing every number through `core/`:

| | |
|---|---|
| **Overview** | coverage per market, clearance status, quarantine depth |
| **Programmes** | each with its own condition ladder rendered — you can see why comparison takes work |
| **Devices** | the canonical catalogue every listing string resolves against |
| **Compare** | trade-in quotes vs market price, per channel, with confidence |

The repository layer does **no arithmetic**. "Last change" is derived from the
observation series on read rather than stored, so the column on screen and the
data underneath cannot disagree.

Every screen carries a permanent banner saying the data is a worked example.
Nothing is cleared for collection, so nothing here was observed — and a
price-intelligence product whose demo data is indistinguishable from its real
data is one screenshot away from somebody trading on a figure nobody measured.

## Not built yet

- Any collector. See above — that is a clearance question first.
- FX rate sourcing. `convert()` takes rates; the seed fabricates them.
- Alerts, run scheduling, the quarantine resolution UI, multi-org auth.
