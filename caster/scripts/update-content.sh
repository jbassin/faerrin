#!/usr/bin/bash

UPSTREAM=/ruby/data/experiments/quartz
UPSTREAM_TRANSCRIPTS="${UPSTREAM}/scripts/script"
UPSTREAM_WIKI="${UPSTREAM}/content"
DOWNSTREAM=/ruby/data/experiments/caster/content

rm -r "${DOWNSTREAM}"
mkdir -p "${DOWNSTREAM}/transcripts"

cd "${UPSTREAM_TRANSCRIPTS}"
for file in *; do
  cat "${file}" | tail -n +38 | cut -c 3- | nl -n rz > "${DOWNSTREAM}/transcripts/${file}"
done

cd ..
cp shibboleth.json "${DOWNSTREAM}/shibboleth.json"

cp -r "${UPSTREAM_WIKI}" "${DOWNSTREAM}/wiki"
rm -r ${DOWNSTREAM}/wiki/{.obsidian,.trash,Script}
