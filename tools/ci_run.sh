#!/usr/bin/env bash
# Preserve the command's exit status and expose the end of failures as GitHub
# check annotations, even when the full Actions log is unavailable.
set -o pipefail
log=$(mktemp "${RUNNER_TEMP:-/tmp}/tanuki-ci.XXXXXX")
"$@" 2>&1 | tee "$log"
status=${PIPESTATUS[0]}
if [ "$status" -ne 0 ]; then
  printf '::error::Command failed with exit code %s\n' "$status"
  while IFS= read -r line; do
    line=${line//'%'/'%25'}
    line=${line//$'\r'/'%0D'}
    printf '::error::%s\n' "$line"
  done < <(tail -n 35 "$log")
fi
exit "$status"
