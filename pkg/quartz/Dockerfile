# Builds the Astro site and serves the static output. (Production on heart.iridi.cc
# is served by a reverse proxy pointing at public/; this image is a self-contained
# alternative.) The content pipeline (scripts/) is run separately, not at image build.
#
# MONOREPO NOTE: under bun workspaces the lockfile lives at the repo ROOT, so this
# image must be built with the build context set to the monorepo root (not pkg/quartz),
# e.g. `docker build -f pkg/quartz/Dockerfile .` from the repo root. This artifact is
# NOT on the deploy path (the proxy serves public/) and is unvalidated post-migration —
# confirm intended use before relying on it.
FROM oven/bun:1 AS builder
WORKDIR /usr/src/app
COPY . .
RUN bun install --frozen-lockfile && bun run --filter quartz build

FROM oven/bun:1
WORKDIR /usr/src/app
COPY --from=builder /usr/src/app/ /usr/src/app/
EXPOSE 4321
CMD ["bunx", "astro", "preview", "--host", "--port", "4321"]
