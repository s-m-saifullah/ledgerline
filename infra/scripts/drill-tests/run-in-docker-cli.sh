#!/bin/sh
# usage: run.sh <script...>; runs inside docker:cli with bash installed
apk add --no-cache bash coreutils >/dev/null 2>&1
cd "$LEDGERLINE_DIR"
exec bash -c "$1"
