"""Insert the PriceIQ route ahead of the ERP catch-all.

Run ON the VM with the Caddyfile path as argv[1]. A standalone file rather than
a heredoc nested inside an ssh command string: the nesting ate its own quotes on
the first attempt, the python never ran, and the deploy still reported success.
Exits non-zero on anything unexpected so the caller can restore the backup.
"""
import sys

ROUTE = (
    "\t# PriceIQ - price & channel intelligence. Same shape as the marketplace:\n"
    "\t# `handle` (not handle_path) because the app is BUILT with basePath=/priceiq\n"
    "\t# and expects to receive the prefix. Access is enforced by the app, which\n"
    "\t# verifies the ERP's denovo_session cookie - there is no second login.\n"
    "\thandle /priceiq* {\n"
    "\t\treverse_proxy localhost:4300\n"
    "\t}\n\n"
)
ANCHOR = "\thandle /marketplace* {"

path = sys.argv[1]
src = open(path).read()

if "/priceiq" in src:
    print("  route already present")
    sys.exit(0)
if ANCHOR not in src:
    sys.exit("  ERROR: marketplace handle not found - refusing to guess where to insert")

out = src.replace(ANCHOR, ROUTE + ANCHOR, 1)
if out == src:
    sys.exit("  ERROR: insertion produced no change")
open(path, "w").write(out)
print("  inserted /priceiq route ahead of the catch-all")
