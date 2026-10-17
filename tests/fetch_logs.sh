#!/bin/bash
# Pull the field log from the live hub: ./tests/fetch_logs.sh [room=test] [n=200] > runtime/p094/field-log.jsonl
# Needs DRONE_EAR_PIN in /Users/mj/code/the-template/.env (the demo's own PIN gate sets a cookie).
set -e
ROOM="${1:-test}"; N="${2:-200}"; BASE="https://demo.maciejjankowski.com/drone-ear"
PIN=$(grep -E '^DRONE_EAR_PIN=' /Users/mj/code/the-template/.env | cut -d= -f2 | tr -d '"'"'"' ')
JAR=$(mktemp); trap 'rm -f "$JAR"' EXIT
curl -s -c "$JAR" -o /dev/null "$BASE/pin.php?pin=$PIN"
curl -s -b "$JAR" "$BASE/party.php?a=logs&room=$ROOM&n=$N"
