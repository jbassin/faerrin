#!/usr/bin/bash

UPSTREAM=/emerald/data/experiments/quartz/scripts/script
DOWNSTREAM=/emerald/data/experiments/heartwood/transcripts

rm -r "${DOWNSTREAM}"
mkdir "${DOWNSTREAM}"

cd "${UPSTREAM}"
for file in *; do
  cat "${file}" | tail -n +38 | cut -c 3- | nl -n rz > "${DOWNSTREAM}/${file}"
done
