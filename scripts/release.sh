#!/usr/bin/env bash
set -euo pipefail

version="${1:?usage: scripts/release.sh <version>}"
if [[ ! "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "not a version: $version" >&2
    exit 1
fi

packed="$(mktemp -d)"
for package in contracts server; do
    (cd "packages/$package" && npm pkg set version="$version" && pnpm build && pnpm pack --pack-destination "$packed")
done

publish(){
    if npm view "$1@$version" version > /dev/null 2>&1; then
        echo "$1@$version is already on npm"
        return
    fi
    npm publish "$packed/$2-$version.tgz" --access public
}

publish @pollium/readable-contracts pollium-readable-contracts
publish @pollium/readable pollium-readable
