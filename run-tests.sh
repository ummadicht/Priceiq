#!/usr/bin/env bash
# Every core suite. No framework, no install — the domain must be verifiable
# with nothing but node, on any machine, before any app is built around it.
#
#   bash run-tests.sh
set -uo pipefail
cd "$(dirname "$0")"

fail=0
for suite in device condition money observation ingest markets spread week csv apikey search export oauth; do
  echo
  echo "== $suite ============================================================"
  node --experimental-strip-types --no-warnings "core/tests/$suite.test.mjs" || fail=1
done

echo
echo "======================================================================"
if [ "$fail" -ne 0 ]; then echo "RESULT: FAILED"; exit 1; fi
echo "RESULT: all core suites passed."
