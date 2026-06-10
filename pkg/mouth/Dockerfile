## Dependencies for image
FROM clux/muslrust:nightly AS chef
USER root
RUN cargo install cargo-chef
WORKDIR /app

## Planner for caching
FROM chef AS planner
COPY . .
RUN cargo chef prepare --recipe-path recipe.json

## Build executable
FROM chef AS builder
COPY --from=planner /app/recipe.json recipe.json

ENV SQLX_OFFLINE=true

RUN cargo chef cook --release --target x86_64-unknown-linux-musl --recipe-path recipe.json

COPY . .
RUN cargo build --release --target x86_64-unknown-linux-musl --bin discord

## Run without build dependencies
FROM alpine AS runtime

# create user
RUN addgroup -S discord && adduser -S discord -G discord

# copy binary
COPY --from=builder /app/target/x86_64-unknown-linux-musl/release/discord /usr/local/bin/

# setup env
COPY .env .env
USER discord
EXPOSE 3000

# run
ENTRYPOINT ["/usr/local/bin/discord"]
