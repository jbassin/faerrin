# Builds the Astro site and serves the static output. (Production on heart.iridi.cc
# is served by a reverse proxy pointing at public/; this image is a self-contained
# alternative.) The content pipeline (scripts/) is run separately, not at image build.
FROM node:22-slim AS builder
WORKDIR /usr/src/app
COPY . .
RUN npm ci && npm run build

FROM node:22-slim
WORKDIR /usr/src/app
COPY --from=builder /usr/src/app/ /usr/src/app/
EXPOSE 4321
CMD ["npx", "astro", "preview", "--host", "--port", "4321"]
