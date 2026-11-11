#!/usr/bin/env bash
# Write /etc/priceiq.env on the VM. Run ON the VM, as a real file rather than a
# string nested inside an ssh command — that nesting has eaten its own quotes
# here before, patched nothing, and still reported success.
#
#   provision-env.sh <erp_dir> <base_path> <port>
set -euo pipefail

ERP_DIR="$1"; BASE="$2"; PORT="$3"
ENVF=/etc/priceiq.env

# The ERP's session secret, so PriceIQ can verify the cookie it issues.
SECRET=$(cd "$ERP_DIR" && node -e '
  const D = require("better-sqlite3");
  const db = new D(require("path").join(process.cwd(), "data", "control.db"), { readonly: true });
  const r = db.prepare("SELECT data FROM kv WHERE key = ?").get("session-secret");
  if (!r) { process.stderr.write("no session-secret in control.db\n"); process.exit(1); }
  process.stdout.write(JSON.parse(r.data));
')
[ -n "$SECRET" ] || { echo "  ERROR: could not read the ERP session secret" >&2; exit 1; }

# The token signing key is PRESERVED across deploys.
#
# Regenerating it would invalidate every outstanding access token on every
# deploy — a bot mid-import would start getting 401s for no reason it could
# see. Generated once, kept thereafter.
TOKEN_SECRET=""
if sudo test -f "$ENVF"; then
  TOKEN_SECRET=$(sudo grep -E '^PRICEIQ_TOKEN_SECRET=' "$ENVF" | head -1 | cut -d= -f2- || true)
fi
if [ -z "$TOKEN_SECRET" ]; then
  TOKEN_SECRET=$(openssl rand -hex 32)
  MINTED="generated"
else
  MINTED="preserved"
fi

sudo sh -c "umask 077; cat > $ENVF" <<EOF
SUPERIQ_SESSION_SECRET=$SECRET
PRICEIQ_TOKEN_SECRET=$TOKEN_SECRET
SUPERIQ_LOGIN_URL=https://wholecellmarket.com/login
NEXT_PUBLIC_BASE_PATH=$BASE
NODE_ENV=production
PORT=$PORT
EOF

sudo chown root:ammar "$ENVF"
sudo chmod 640 "$ENVF"
echo "  env written · token signing key $MINTED · mode $(sudo stat -c %a $ENVF)"
