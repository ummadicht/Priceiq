#!/usr/bin/env bash
# pm2 starts this rather than `npm start` directly, so the root-owned env file
# (which carries the shared SuperIQ session secret) is sourced at launch and
# never has to live inside the app directory that deploy rsyncs with --delete.
set -a
[ -f /etc/priceiq.env ] && . /etc/priceiq.env
set +a
exec npx next start -p "${PORT:-4300}"
