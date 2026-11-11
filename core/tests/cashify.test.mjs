import assert from "node:assert/strict";
import { PROGRAM_SEEDS } from "../markets.ts";
import { checkClearance, cashifyDbAdapter } from "../collection.ts";
import { CASHIFY_INDIA_LADDER } from "../ladders/cashifyIndia.ts";
import { ingest, ingestHealth } from "../ingest.ts";
import { validateLadder, mapCondition } from "../condition.ts";
import { resolveDevice } from "../device.ts";

let pass = 0, fail = 0;
const queue = [];
const t = (n, f) => {
  queue.push({ n, f });
};

const SAMPLE_CATALOGUE = [
  { id: "apple-iphone-15-pro-max-256", brand: "Apple", model: "iPhone 15 Pro Max", storageGb: 256, releaseYear: 2023, aliases: ["A2849"] },
  { id: "apple-iphone-13-128gb", brand: "Apple", model: "iPhone 13", storageGb: 128, releaseYear: 2021, aliases: [] },
  { id: "apple-iphone-13-256gb", brand: "Apple", model: "iPhone 13", storageGb: 256, releaseYear: 2021, aliases: [] },
  { id: "samsung-galaxy-s24-256", brand: "Samsung", model: "Galaxy S24", storageGb: 256, releaseYear: 2024, aliases: [] },
];

console.log("compliance and clearance");
t("Cashify India is defined as a cleared market source in markets.ts", () => {
  const p = PROGRAM_SEEDS.find((x) => x.id === "cashify-in");
  assert.ok(p, "Cashify India program seed exists");
  assert.equal(p.cleared, true, "Cashify India must be cleared for collection");
  assert.equal(p.market, "IN");
  assert.equal(p.kind, "recycler");
});

t("cashifyDbAdapter records documented authority and passes clearance check", () => {
  const p = PROGRAM_SEEDS.find((x) => x.id === "cashify-in");
  const c = cashifyDbAdapter();
  assert.equal(c.programId, "cashify-in");
  assert.equal(c.method, "partner_feed");
  assert.ok(c.authority && c.authority.length >= 8);

  const check = checkClearance(p, new Map([[p.id, c]]));
  assert.equal(check.allowed, true, `Clearance check failed: ${check.why}`);
  assert.match(check.why, /partner_feed/);
});

console.log("\ncondition ladder");
t("CASHIFY_INDIA_LADDER covers all canonical rungs and validates cleanly", () => {
  const v = validateLadder(CASHIFY_INDIA_LADDER);
  assert.equal(v.ok, true, `Ladder validation failed: ${v.gaps.join(", ")}`);
  assert.equal(v.gaps.length, 0);

  const spanA = mapCondition(CASHIFY_INDIA_LADDER, "Grade A");
  assert.deepEqual(spanA, { lo: "flawless", hi: "flawless" });

  const spanB = mapCondition(CASHIFY_INDIA_LADDER, "Grade B");
  assert.deepEqual(spanB, { lo: "good", hi: "good" });

  const spanGood = mapCondition(CASHIFY_INDIA_LADDER, "Good");
  assert.deepEqual(spanGood, { lo: "good", hi: "good" });
});

console.log("\ndatabase bridge adapter");
t("cashifyDbAdapter queries raw rows or provides baseline feed without HTTP calls", async () => {
  const c = cashifyDbAdapter();
  const rows = await c.collect({ deviceIds: ["apple-iphone-13-128gb"], timeoutMs: 5000 });
  assert.ok(Array.isArray(rows));
  assert.ok(rows.length >= 5);
  for (const r of rows) {
    assert.ok(r.deviceText.length > 0);
    assert.ok(r.conditionText.length > 0);
    assert.equal(r.currency, "INR");
    assert.ok(r.sourceUrl.includes("cashify.in"));
  }
});

t("cashifyDbAdapter queries custom Postgres queryFn when provided", async () => {
  let queryExecuted = false;
  const mockQueryFn = async (sql) => {
    queryExecuted = true;
    return [
      {
        model_string: "Cashify Grade B iPhone 13 128GB",
        condition: "Grade B",
        price: 29000,
        currency: "INR",
        source_url: "https://www.cashify.in/test",
      },
    ];
  };

  const c = cashifyDbAdapter({ queryFn: mockQueryFn });
  const rows = await c.collect({ deviceIds: [], timeoutMs: 5000 });
  assert.equal(queryExecuted, true);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].deviceText, "Cashify Grade B iPhone 13 128GB");
  assert.equal(rows[0].priceMajor, 29000);
});

t("cashifyDbAdapter queries scraper.cashify_buy_prices with full column mapping", async () => {
  let executedSql = "";
  const mockScraperRows = [
    {
      id: 101,
      brand: "Apple",
      model: "iPhone 13",
      model_series: "iPhone",
      variant: "128 GB",
      storage: "128 GB",
      ram: "4 GB",
      condition: "Flawless",
      defects: "No defects",
      buyback_price: "29500.00",
      currency: "INR",
      source_url: "https://www.cashify.in/sell-old-mobile-phone/sell-used-apple-iphone-13",
      scraped_at: new Date("2026-11-10T10:00:00Z"),
    },
    {
      id: 102,
      brand: "Samsung",
      model: "Galaxy S24",
      model_series: "Galaxy S",
      variant: "8 GB / 256 GB",
      storage: "256 GB",
      ram: "8 GB",
      condition: "Good",
      defects: "Minor scratches",
      buyback_price: 36000,
      currency: "INR",
      source_url: "https://www.cashify.in/sell-old-mobile-phone/sell-used-samsung-galaxy-s24",
      scraped_at: new Date("2026-11-10T10:00:00Z"),
    },
  ];

  const mockQueryFn = async (sql) => {
    executedSql = sql;
    return mockScraperRows;
  };

  const adapter = cashifyDbAdapter({
    schema: "scraper",
    tableName: "cashify_buy_prices",
    queryFn: mockQueryFn,
  });

  const collected = await adapter.collect({ deviceIds: [], timeoutMs: 5000 });
  assert.match(executedSql, /FROM scraper\.cashify_buy_prices/);
  assert.equal(collected.length, 2);

  // Check Apple row formatting
  assert.equal(collected[0].deviceText, "Apple iPhone 13 128 GB");
  assert.equal(collected[0].conditionText, "Flawless");
  assert.equal(collected[0].priceMajor, 29500);
  assert.equal(collected[0].currency, "INR");
  assert.equal(collected[0].observedAt, "2026-11-10T10:00:00.000Z");

  // Check Samsung row formatting
  assert.equal(collected[1].deviceText, "Samsung Galaxy S24 8 GB / 256 GB");
  assert.equal(collected[1].conditionText, "Good");
  assert.equal(collected[1].priceMajor, 36000);
  assert.equal(collected[1].currency, "INR");
});


console.log("\ningestion gate");
t("messy Cashify strings resolve into canonical devices and condition spans", () => {
  const rawRows = [
    {
      deviceText: "Cashify Grade A Apple iPhone 15 Pro Max 256GB",
      conditionText: "Grade A",
      priceMajor: 84000,
      currency: "INR",
      sourceUrl: "https://www.cashify.in/test1",
    },
    {
      deviceText: "Cashify Grade B iPhone 13 128GB",
      conditionText: "Grade B",
      priceMajor: 28500,
      currency: "INR",
      sourceUrl: "https://www.cashify.in/test2",
    },
  ];

  const ctx = {
    programId: "cashify-in",
    runId: "run-test-1",
    observedAt: "2026-11-11T00:00:00Z",
    catalogue: SAMPLE_CATALOGUE,
    ladder: CASHIFY_INDIA_LADDER,
  };

  const res = ingest(rawRows, ctx);
  assert.equal(res.observations.length, 2);
  assert.equal(res.quarantined.length, 0);

  assert.equal(res.observations[0].deviceId, "apple-iphone-15-pro-max-256");
  assert.equal(res.observations[0].conditionLabel, "Grade A");
  assert.equal(res.observations[0].price.amountMinor, 8400000);

  assert.equal(res.observations[1].deviceId, "apple-iphone-13-128gb");
  assert.equal(res.observations[1].conditionLabel, "Grade B");
  assert.equal(res.observations[1].price.amountMinor, 2850000);
});

t("an ambiguous device string without storage is quarantined, not guessed", () => {
  const rawRows = [
    {
      deviceText: "Cashify Grade B iPhone 13", // Missing storage
      conditionText: "Grade B",
      priceMajor: 27000,
      currency: "INR",
      sourceUrl: "https://www.cashify.in/test3",
    },
  ];

  const ctx = {
    programId: "cashify-in",
    runId: "run-test-2",
    observedAt: "2026-11-11T00:00:00Z",
    catalogue: SAMPLE_CATALOGUE,
    ladder: CASHIFY_INDIA_LADDER,
  };

  const res = ingest(rawRows, ctx);
  assert.equal(res.observations.length, 0);
  assert.equal(res.quarantined.length, 1);
  assert.equal(res.quarantined[0].reason, "device_ambiguous");
  assert.ok(res.quarantined[0].candidateIds.length >= 2);
  assert.ok(res.quarantined[0].candidateIds.includes("apple-iphone-13-128gb"));
  assert.ok(res.quarantined[0].candidateIds.includes("apple-iphone-13-256gb"));
});

t("an uncatalogued model is quarantined for catalogue alias expansion", () => {
  const rawRows = [
    {
      deviceText: "Cashify Grade C OnePlus Nord CE 4 Lite 5G 128GB",
      conditionText: "Grade C",
      priceMajor: 11000,
      currency: "INR",
      sourceUrl: "https://www.cashify.in/test4",
    },
  ];

  const ctx = {
    programId: "cashify-in",
    runId: "run-test-3",
    observedAt: "2026-11-11T00:00:00Z",
    catalogue: SAMPLE_CATALOGUE,
    ladder: CASHIFY_INDIA_LADDER,
  };

  const res = ingest(rawRows, ctx);
  assert.equal(res.observations.length, 0);
  assert.equal(res.quarantined.length, 1);
  assert.equal(res.quarantined[0].reason, "device_unresolved");
  assert.equal(res.quarantined[0].row.deviceText, "Cashify Grade C OnePlus Nord CE 4 Lite 5G 128GB");
});

t("ingestHealth reflects captured and quarantined metrics correctly", () => {
  const rawRows = [
    { deviceText: "Cashify Grade B iPhone 13 128GB", conditionText: "Grade B", priceMajor: 28500, currency: "INR", sourceUrl: "" },
    { deviceText: "Cashify Grade B iPhone 13", conditionText: "Grade B", priceMajor: 27000, currency: "INR", sourceUrl: "" },
  ];

  const ctx = {
    programId: "cashify-in",
    runId: "run-test-4",
    observedAt: "2026-11-11T00:00:00Z",
    catalogue: SAMPLE_CATALOGUE,
    ladder: CASHIFY_INDIA_LADDER,
  };

  const res = ingest(rawRows, ctx);
  const health = ingestHealth(res);

  assert.equal(health.total, 2);
  assert.equal(health.captured, 1);
  assert.equal(health.quarantined, 1);
  assert.equal(health.matchRate, 0.5);
  assert.equal(health.byReason["device_ambiguous"], 1);
});

for (const item of queue) {
  try {
    await item.f();
    pass++;
    console.log("  pass  " + item.n);
  } catch (e) {
    fail++;
    console.log("  FAIL  " + item.n + "\n        " + e.message);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
