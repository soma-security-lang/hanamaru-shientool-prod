#!/usr/bin/env bash
set -Eeuo pipefail
export LC_ALL=C LANG=C

version="1.7.12"
platform="$(uname -s)-$(uname -m)"
case "$platform" in
  Darwin-arm64)
    target="darwin_arm64"
    expected="aba9ced2dee8d27fecca3dc7feb1a7f9a52caefa1eb46f3271ea66b6e0e6953f"
    ;;
  Darwin-x86_64)
    target="darwin_amd64"
    expected="5b44c3bc2255115c9b69e30efc0fecdf498fdb63c5d58e17084fd5f16324c644"
    ;;
  Linux-x86_64)
    target="linux_amd64"
    expected="8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8"
    ;;
  Linux-aarch64|Linux-arm64)
    target="linux_arm64"
    expected="325e971b6ba9bfa504672e29be93c24981eeb1c07576d730e9f7c8805afff0c6"
    ;;
  *)
    echo "Unsupported actionlint platform: $platform" >&2
    exit 2
    ;;
esac

temp_dir="$(mktemp -d)"
cleanup(){
  find "$temp_dir" -type f -delete || true
  find "$temp_dir" -depth -type d -exec rmdir {} + || true
}
trap cleanup EXIT

archive="actionlint_${version}_${target}.tar.gz"
archive_path="$temp_dir/$archive"
curl --fail --silent --show-error --location \
  "https://github.com/rhysd/actionlint/releases/download/v${version}/${archive}" \
  --output "$archive_path"
actual="$(
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$archive_path" | awk '{print $1}'
  else
    shasum -a 256 "$archive_path" | awk '{print $1}'
  fi
)"
[[ "$actual" == "$expected" ]] || {
  echo "actionlint archive checksum mismatch" >&2
  exit 3
}
tar -xzf "$archive_path" -C "$temp_dir"
"$temp_dir/actionlint" .github/workflows/*.yml
echo "actionlint ${version}: PASS"
