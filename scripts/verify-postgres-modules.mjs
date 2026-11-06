/**
 * Automated Verification Test for PriceIQ PostgreSQL Data-Access Implementation
 * =============================================================================
 * Executes end-to-end read and write tests directly against the PostgreSQL 'price_iq' schema
 * across all domain modules to prove that SQLite is completely replaced.
 */

import { listKeys, createKey, verifyKey, revokeKey } from "../lib/apikeys.ts";
import { listClients, createClient, authenticateClient, revokeClient } from "../lib/oauthClients.ts";
import { listDevices, listPrograms, fxRates, rateInForce, setRate, compareDevice, quarantineCount, coverageFor } from "../lib/repo.ts";
import { recordMarketPrice, lastEntered, weeklySeries } from "../lib/entry.ts";
import { provenance } from "../lib/provenance.ts";
import { seed } from "../lib/seed.ts";
import { query, queryOne } from "../lib/db.ts";

async function run() {
  console.log("================================================================================");
  console.log(" PRICEIQ POSTGRESQL (schema: price_iq) END-TO-END READ/WRITE TEST SUITE");
  console.log("================================================================================");

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`  ✓ PASS: ${message}`);
      passed++;
    } else {
      console.error(`  ✗ FAIL: ${message}`);
      failed++;
    }
  }

  // 1. Verify schema & search_path
  console.log("\n[TEST 1] PostgreSQL Schema & Search Path Verification");
  const schemaRes = await queryOne("SELECT current_schema() as s");
  assert(schemaRes?.s === "price_iq", `Active schema is 'price_iq' (current: '${schemaRes?.s}')`);

  // Sync initial reference tables into price_iq schema
  await seed();

  // 2. API Keys Module
  console.log("\n[TEST 2] API Keys Module (Write -> Read -> Verify -> Revoke)");
  const testKeyName = `test_key_${Date.now()}`;
  const { row: createdKey, secret } = await createKey(testKeyName, ["read", "write"], "test-runner");
  assert(createdKey && createdKey.name === testKeyName, `Created API key '${createdKey.name}' with ID ${createdKey.id}`);

  const verified = await verifyKey(secret);
  assert(verified && verified.id === createdKey.id, `Verified API key using cryptographic hash (ID: ${verified?.id})`);

  const revoked = await revokeKey(createdKey.id);
  assert(revoked === true, `Successfully revoked API key ${createdKey.id}`);

  const postRevoke = await verifyKey(secret);
  assert(postRevoke === null, "Revoked API key correctly rejected by verifyKey");

  // 3. OAuth Clients Module
  console.log("\n[TEST 3] OAuth Clients Module (Write -> Read -> Auth -> Revoke)");
  const testClientName = `test_client_${Date.now()}`;
  const { client, clientSecret } = await createClient(testClientName, ["read", "write"], "test-runner");
  assert(client && client.name === testClientName, `Created OAuth client '${client.name}' (ID: ${client.clientId})`);

  const authenticated = await authenticateClient(client.clientId, clientSecret);
  assert(authenticated && authenticated.clientId === client.clientId, `Successfully authenticated OAuth client ${authenticated?.clientId}`);

  const clientRevoked = await revokeClient(client.clientId);
  assert(clientRevoked === true, `Successfully revoked OAuth client ${client.clientId}`);

  const postClientRevoke = await authenticateClient(client.clientId, clientSecret);
  assert(postClientRevoke === null, "Revoked OAuth client correctly rejected by authenticateClient");

  // 4. Devices Catalogue Module
  console.log("\n[TEST 4] Devices Catalogue Module");
  const devices = await listDevices();
  assert(Array.isArray(devices) && devices.length > 0, `Successfully queried devices catalogue (${devices.length} devices)`);
  if (devices.length > 0) {
    const d0 = devices[0];
    assert(d0.brand && d0.model && d0.storageGb, `Device shape verified: ${d0.brand} ${d0.model} ${d0.storageGb}GB`);
  }

  // 5. FX Rates Module (Write -> Read)
  console.log("\n[TEST 5] FX Rates Module (Write -> Read)");
  const testRateDate = "2026-11-06";
  await setRate("USD", "INR", 88.50, testRateDate, "PostgreSQL Automated Test Suite");
  const rateFound = await rateInForce("USD", "INR", testRateDate);
  assert(rateFound && Number(rateFound.rate) === 88.50, `Recorded & verified FX rate USD/INR = ${rateFound?.rate} as of ${rateFound?.asOf}`);

  // 6. Market Prices & Hand-Entry Module (Write -> Read)
  console.log("\n[TEST 6] Market Prices & Entry Module (Write -> Read)");
  const targetDevice = devices[0]?.id || "apple-iphone-13-128gb";
  const entryResult = await recordMarketPrice({
    deviceId: targetDevice,
    market: "IN",
    channel: "wholesale",
    amountMajor: 24500,
    currency: "INR",
    sampleSize: 15,
    dispersionPct: 5.5,
    source: "Automated PostgreSQL Read/Write Test",
    enteredBy: "qa-test",
    note: "Automated verification entry",
  });
  assert(entryResult.ok === true, `Recorded market price in price_iq.market_prices (ID: ${entryResult.id}, Week: ${entryResult.week})`);

  const lastPrice = await lastEntered(targetDevice, "IN", "wholesale");
  assert(lastPrice && Number(lastPrice.amount_minor) === 2450000, `Retrieved last price for ${targetDevice}: ${lastPrice?.currency} ${Number(lastPrice?.amount_minor) / 100}`);

  const series = await weeklySeries({ market: "IN", channel: "wholesale" });
  assert(Array.isArray(series) && series.length > 0, `Queried week-on-week series (${series.length} series items)`);

  // 7. Programmes & Ladders Module
  console.log("\n[TEST 7] Programmes & Ladders Module");
  const programs = await listPrograms();
  assert(Array.isArray(programs) && programs.length > 0, `Queried programmes registry (${programs.length} programmes)`);

  // 8. Provenance & Quarantine Module
  console.log("\n[TEST 8] Provenance & Quarantine Module");
  const prov = await provenance();
  assert(prov && typeof prov.realObservations === "number", `Provenance report: ${prov.realObservations} real observations, ${prov.realPrograms.length} programmes`);
  const quar = await quarantineCount();
  assert(typeof quar === "number", `Quarantine count: ${quar}`);

  // 9. Reconciliation with Production Tables
  console.log("\n[TEST 9] Data Reconciliation with Production Tables");
  const prCount = await queryOne("SELECT count(*) c FROM price_iq.pricing_records");
  const rcCount = await queryOne("SELECT count(*) c FROM price_iq.rate_card_matrix");
  assert(Number(prCount?.c) === 190, `price_iq.pricing_records holds 190 reconciled buyback rows (found: ${prCount?.c})`);
  assert(Number(rcCount?.c) === 47, `price_iq.rate_card_matrix holds 47 reconciled rate cards (found: ${rcCount?.c})`);

  console.log("\n================================================================================");
  console.log(` RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log("================================================================================");

  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error("Test runner failed:", err);
  process.exit(1);
});
