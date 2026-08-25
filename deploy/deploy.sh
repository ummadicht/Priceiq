#!/usr/bin/env bash
# Deploy PriceIQ to the denovo-erp VM as a subpath of wholecellmarket.com:
#
#     https://wholecellmarket.com/priceiq        (behind the SuperIQ ERP login)
#
# WHY THIS BOX. wholecellmarket.com already resolves here (35.254.29.102), and
# this is the roomiest VM in the estate — 2 GB with ~770 MB free, versus ~230 MB
# on the swapmore box. It already runs the ERP (:3000), the marketplace (:4200),
# Carpoolio (:3500) and CivicSense (:4000) under pm2, so PriceIQ joins a pattern
# rather than inventing one.
#
# AUTH. PriceIQ has no login. It verifies the ERP's `denovo_session` cookie
# using the ERP's own session secret, copied into /etc/priceiq.env at deploy
# time. See lib/superiqAuth.ts for the contract and the coupling this creates.
#
# OOM-SAFE: build LOCALLY and ship .next. Even on the 2 GB box, a `next build`
# beside four running apps is not worth the risk.
#
#   bash deploy/deploy.sh
set -euo pipefail

VM=ammar@35.254.29.102
KEY=$HOME/.ssh/denovo_gcp
SSH="ssh -i $KEY -o StrictHostKeyChecking=accept-new"
APP=priceiq
DIR="\$HOME/$APP"
PORT=4300
BASE=/priceiq
ERP_DIR="\$HOME/denovo"

echo "[1/7] core suites must pass before anything ships"
bash run-tests.sh >/dev/null || { echo "ABORT: core tests failed" >&2; exit 1; }
echo "  all core suites passed"

echo "[2/7] LOCAL production build (basePath=$BASE)"
rm -rf .next
NEXT_PUBLIC_BASE_PATH=$BASE NODE_OPTIONS=--max-old-space-size=2048 npm run build >/dev/null
if ls .next/server/chunks/ 2>/dev/null | grep -q turbopack; then
  echo "ABORT: turbopack chunks present — refusing to deploy." >&2; exit 1
fi
echo "  built"

echo "[3/7] rsync (no node_modules, no local data, no local env)"
$SSH "$VM" "mkdir -p $DIR"
rsync -az --delete \
  --exclude node_modules --exclude .git --exclude '.DS_Store' --exclude '._*' \
  --exclude '*.tsbuildinfo' --exclude .claude --exclude data \
  --exclude '.env' --exclude '.env.local' \
  --exclude '.next/cache' --exclude '.next/dev' \
  -e "$SSH" ./ "$VM:$DIR/"

echo "[4/7] runtime deps"
$SSH "$VM" "cd $DIR && npm install --omit=dev --no-audit --no-fund 2>&1 | tail -2"

echo "[5/7] session secret — copied from the ERP, never printed"
# Read the ERP's own session secret out of its control database and write it to
# a root-only env file OUTSIDE the app directory, because step 3 rsyncs with
# --delete and a secret inside the app dir would vanish on the next deploy.
$SSH "$VM" "
  SECRET=\$(cd $ERP_DIR && node -e '
    const D=require(\"better-sqlite3\");
    const db=new D(require(\"path\").join(process.cwd(),\"data\",\"control.db\"),{readonly:true});
    const r=db.prepare(\"SELECT data FROM kv WHERE key = ?\").get(\"session-secret\");
    if(!r){process.stderr.write(\"no session-secret in control.db\\n\");process.exit(1);}
    process.stdout.write(JSON.parse(r.data));
  ')
  if [ -z \"\$SECRET\" ]; then echo '  ERROR: could not read the ERP session secret' >&2; exit 1; fi
  sudo sh -c \"umask 077; { printf 'SUPERIQ_SESSION_SECRET=%s\n' '\$SECRET'; \
     printf 'SUPERIQ_LOGIN_URL=https://wholecellmarket.com/login\n'; \
     printf 'NEXT_PUBLIC_BASE_PATH=$BASE\n'; \
     printf 'NODE_ENV=production\n'; \
     printf 'PORT=$PORT\n'; } > /etc/priceiq.env\"
  sudo chown root:ammar /etc/priceiq.env; sudo chmod 640 /etc/priceiq.env
  echo \"  secret installed (\$(sudo wc -c < /etc/priceiq.env) bytes, mode \$(sudo stat -c %a /etc/priceiq.env))\"
"

echo "[6/7] pm2 restart on :$PORT"
$SSH "$VM" "cd $DIR && \
  (pm2 delete $APP >/dev/null 2>&1 || true) && \
  pm2 start ./start.sh --name $APP --max-memory-restart 400M >/dev/null && \
  pm2 save >/dev/null 2>&1; sleep 5; pm2 describe $APP | grep -E 'status|memory' | head -2"
$SSH "$VM" "sleep 3; curl -s -o /dev/null -w '  origin: HTTP %{http_code}\n' --max-time 10 http://localhost:$PORT$BASE"

echo "[7/7] Caddy routes (validate first, restore on failure)"
# Two separate patch SCRIPTS, copied over and run as files.
#
# The first version of this step inlined python in a heredoc nested inside the
# ssh command string. The nesting ate its own quotes, the python never ran, and
# the step still printed "caddy reloaded" — a deploy that reports success and
# changes nothing is worse than one that fails.
scp -q -i "$KEY" deploy/patch-caddy.py deploy/patch-caddy-case.py "$VM:/tmp/"
$SSH "$VM" '
  set -e
  CF=/etc/caddy/Caddyfile
  sudo cp $CF $CF.bak
  sudo python3 /tmp/patch-caddy.py $CF
  sudo python3 /tmp/patch-caddy-case.py $CF
  if sudo caddy validate --config $CF --adapter caddyfile >/dev/null 2>&1; then
    sudo systemctl reload caddy && echo "  caddy reloaded"
  else
    echo "  ERROR: Caddyfile invalid - restoring backup" >&2
    sudo cp $CF.bak $CF; sudo systemctl reload caddy; exit 1
  fi
  grep -q priceiq $CF || { echo "  ERROR: route missing after patch" >&2; exit 1; }
  echo "  /priceiq route present"
'

echo
echo "Done → https://wholecellmarket.com$BASE"
