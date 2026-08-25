"""Redirect non-canonical capitalisations of /priceiq to the canonical path.

TWO Caddy behaviours make this fiddly, and both were learned the hard way:

1. Caddy's `path` matcher is CASE-INSENSITIVE. So `not path /priceiq` also
   excludes /priceIQ, which silently disabled this redirect entirely — the
   request fell through to `handle /priceiq*` (also case-insensitive), reached
   the app, and 404'd there because Next's basePath *is* case-sensitive.
   The exclusion therefore uses `not path_regexp`, which is case-SENSITIVE.

2. Go's RE2 has no lookahead, so "case-insensitive except when already
   lowercase" cannot be one pattern. It is two conditions the matcher ANDs.

Without the exclusion the canonical /priceiq matches itself and redirects
forever — that outage is why the exclusion exists at all.
"""
import sys

REDIR = (
    "\t# People type the product's own capitalisation, and Next's basePath is\n"
    "\t# case-sensitive, so /priceIQ reaches the app and 404s there. Send every\n"
    "\t# non-canonical spelling to the canonical path first.\n"
    "\t#\n"
    "\t# `not path_regexp` rather than `not path`: Caddy's path matcher is\n"
    "\t# case-INSENSITIVE, so `not path /priceiq` would exclude /priceIQ too and\n"
    "\t# disable this rule. The exclusion is also what stops /priceiq matching\n"
    "\t# itself and redirecting in an infinite loop.\n"
    "\t@priceiq_case {\n"
    "\t\tpath_regexp pcase ^/[Pp][Rr][Ii][Cc][Ee][Ii][Qq](/.*)?$\n"
    "\t\tnot path_regexp pexact ^/priceiq(/.*)?$\n"
    "\t}\n"
    "\tredir @priceiq_case /priceiq{re.pcase.1} permanent\n\n"
)
ANCHOR = "\thandle /priceiq* {"

path = sys.argv[1]
src = open(path).read()
if "priceiq_case" in src:
    print("  case redirect already present")
    sys.exit(0)
if ANCHOR not in src:
    sys.exit("  ERROR: /priceiq handle not found")
open(path, "w").write(src.replace(ANCHOR, REDIR + ANCHOR, 1))
print("  inserted case redirect (case-sensitive exclusion)")
