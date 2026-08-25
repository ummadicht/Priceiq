// A paste is how a week's prices actually arrive. Every one of these tests is a
// way a naive parser silently changes a number rather than failing loudly.

import assert from "node:assert/strict";
import { parseDelimited, sniffDelimiter, mapHeaders, parseNumber, REQUIRED_FIELDS } from "../csv.ts";

let pass = 0, fail = 0;
const t = (n, f) => { try { f(); pass++; console.log("  pass  " + n); } catch (e) { fail++; console.log("  FAIL  " + n + "\n        " + e.message); } };

console.log("delimiters");
t("a spreadsheet paste is tabs; a file is commas", () => {
  assert.equal(sniffDelimiter("device\tprice\nX\t1"), "\t");
  assert.equal(sniffDelimiter("device,price\nX,1"), ",");
  assert.equal(sniffDelimiter("device;price"), ";");
  assert.equal(sniffDelimiter("single"), ",");   // no delimiter → harmless default
});

console.log("\nparsing");
t("A QUOTED DELIMITER IS ONE VALUE, not two", () => {
  // "1,299.00" split naively becomes 1 and 299.00 — a 99.9% price cut.
  const rows = parseDelimited('device,price\niPhone,"1,299.00"');
  assert.deepEqual(rows[1], ["iPhone", "1,299.00"]);
});
t("a doubled quote is a literal quote", () => {
  const rows = parseDelimited('note\n"he said ""fine"""');
  assert.deepEqual(rows[1], ['he said "fine"']);
});
t("CRLF and a UTF-8 BOM do not corrupt the first header", () => {
  const rows = parseDelimited('﻿device,price\r\niPhone,900\r\n');
  assert.deepEqual(rows[0], ["device", "price"]);
  assert.deepEqual(rows[1], ["iPhone", "900"]);
});
t("blank lines are dropped, ragged rows are kept for reporting", () => {
  const rows = parseDelimited("a,b\n\n1,2\n3\n");
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[2], ["3"]);   // short row survives so it can be reported
});
t("an empty paste is an empty result, not a crash", () => {
  assert.deepEqual(parseDelimited(""), []);
  assert.deepEqual(parseDelimited("   \n  \n"), []);
});
t("a newline inside a quoted field stays inside the field", () => {
  const rows = parseDelimited('note,price\n"line one\nline two",900');
  assert.equal(rows.length, 2);
  assert.equal(rows[1][0], "line one\nline two");
  assert.equal(rows[1][1], "900");
});

console.log("\nheader mapping");
t("obvious headers map", () => {
  const m = mapHeaders(["Device", "Price", "Currency", "Comps", "Source"]);
  assert.equal(m.index.device, 0);
  assert.equal(m.index.price, 1);
  assert.equal(m.index.currency, 2);
  assert.equal(m.index.comparables, 3);
  assert.equal(m.index.source, 4);
  assert.deepEqual(m.missing, []);
});
t("people's real header names map", () => {
  const m = mapHeaders(["Model", "Wholesale price (USD)", "Sample size", "Basis"]);
  assert.equal(m.index.device, 0);
  assert.equal(m.index.price, 1);
  assert.equal(m.index.comparables, 2);
  assert.equal(m.index.source, 3);
});
t("MISSING REQUIRED COLUMNS ARE NAMED, not silently defaulted", () => {
  const m = mapHeaders(["Colour", "Warehouse"]);
  assert.deepEqual(m.missing.sort(), [...REQUIRED_FIELDS].sort());
  assert.equal(m.unmapped.length, 2);
});
t("an unrecognised column is reported rather than guessed at", () => {
  const m = mapHeaders(["Device", "Price", "Bin location"]);
  assert.deepEqual(m.unmapped, ["Bin location"]);
  assert.deepEqual(m.missing, []);
});
t("A ONE-LETTER ALIAS NEVER MATCHES AS A SUBSTRING", () => {
  // "n" is a fair exact header for a sample count and a disastrous substring —
  // it appears in Bin, Condition, Channel, Note and most other column names.
  for (const h of ["Bin location", "Condition", "Serial", "Warranty"]) {
    const m = mapHeaders(["Device", "Price", h]);
    assert.deepEqual(m.unmapped, [h], `"${h}" was claimed by a short alias`);
  }
  // "Warehouse note" is a different case and SHOULD map — "note" is a real
  // alias and long enough to be meaningful as a substring.
  assert.equal(mapHeaders(["Device", "Price", "Warehouse note"]).index.note, 2);
  // ...but it still works when someone genuinely heads a column "n".
  assert.equal(mapHeaders(["Device", "Price", "n"]).index.comparables, 2);
});

console.log("\nnumbers out of spreadsheet cells");
t("currency marks, thousands and percent signs are stripped", () => {
  assert.equal(parseNumber("$1,299.00"), 1299);
  assert.equal(parseNumber("₹84,000"), 84000);
  assert.equal(parseNumber("12%"), 12);
  assert.equal(parseNumber(" 905.50 "), 905.5);
});
t("EUROPEAN DECIMALS are read as decimals, not thousands", () => {
  assert.equal(parseNumber("1.299,00"), 1299);     // dot thousands, comma decimal
  assert.equal(parseNumber("905,50"), 905.5);
  assert.equal(parseNumber("1,299.00"), 1299);     // the other way round
});
t("a bare thousands comma is not a decimal point", () => {
  assert.equal(parseNumber("84,000"), 84000);      // NOT 84.0
});
t("junk gives null rather than zero", () => {
  // Zero is a real price. Silently turning "n/a" into 0 would record a free phone.
  assert.equal(parseNumber(""), null);
  assert.equal(parseNumber("n/a"), null);
  assert.equal(parseNumber("—"), null);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
