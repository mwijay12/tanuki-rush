#!/usr/bin/env bash
# Fetch the pinned Gradle wrapper distribution for a GitHub Actions runner.
# services.gradle.org redirects to GitHub release assets, which can return 504.
# Mirror bytes are never trusted without the official, pinned SHA-256 check.
set -euo pipefail

properties=mobile/android/gradle/wrapper/gradle-wrapper.properties
url=$(sed -n 's/^distributionUrl=//p' "$properties")
name=${url##*/}
version=${name#gradle-}
version=${version%-bin.zip}
sha=$(sed -n 's/^distributionSha256Sum=//p' "$properties")
if [[ ! "$version" =~ ^[0-9]+(\.[0-9]+)+$ || "$name" != "gradle-${version}-bin.zip" || ! "$sha" =~ ^[0-9a-f]{64}$ ]]; then
  echo 'Expected a pinned binary Gradle distribution and SHA-256 in the wrapper properties.' >&2
  exit 1
fi
archive="${RUNNER_TEMP:?RUNNER_TEMP must be set}/${name}"
sources=(
  "https://mirrors.aliyun.com/gradle/distributions/v${version}/${name}"
  "https://mirrors.huaweicloud.com/gradle/${name}"
  "https://mirrors.cloud.tencent.com/gradle/${name}"
  "https://services.gradle.org/distributions/${name}"
)
verified=false
for source in "${sources[@]}"; do
  echo "Trying $source"
  rm -f "$archive"
  if curl --fail --location --silent --show-error --connect-timeout 20 --max-time 180 --retry 1 --retry-delay 2 "$source" --output "$archive"; then
    if printf '%s  %s\n' "$sha" "$archive" | sha256sum --check --status; then
      verified=true
      echo "Gradle ${version} SHA-256 verified."
      break
    fi
    echo "Checksum mismatch; refusing to use this download." >&2
  fi
done
if [[ "$verified" != true ]]; then
  echo 'Could not download a verified Gradle distribution from any source.' >&2
  exit 1
fi

# Change only the ephemeral checkout on the runner. The wrapper still checks
# distributionSha256Sum again before extracting the verified local archive.
python3 - "$properties" "$archive" <<'PY'
import re
import sys
from pathlib import Path

properties = Path(sys.argv[1])
archive = Path(sys.argv[2]).resolve().as_uri()
text = properties.read_text(encoding='utf-8')
properties.write_text(re.sub(r'^distributionUrl=.*$', 'distributionUrl=' + archive, text, flags=re.M), encoding='utf-8')
PY
