#!/usr/bin/env bash
# Run each named npm script if package.json defines it, and say plainly when it
# doesn't — so a missing test suite is reported as "not configured", not "passed".
# Usage (inside a package dir): bash run-optional-scripts.sh lint test
set -euo pipefail

pkg="$(node -p "require('./package.json').name")"
for script in "$@"; do
  if node -e "process.exit(require('./package.json').scripts?.['$script'] ? 0 : 1)"; then
    echo "• $pkg: running npm run $script"
    npm run "$script"
  else
    echo "::notice title=$pkg::no \"$script\" script configured in package.json — skipped (nothing was run)"
  fi
done
