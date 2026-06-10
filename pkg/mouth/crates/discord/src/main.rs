// The deeply-nested async event handlers (notably `message`) overflow the default
// type-layout recursion limit on current toolchains. Compiler directive only — no
// behavior change.
#![recursion_limit = "256"]

mod control;
mod db;
mod env;
mod goodness;
mod handler;
mod host;
pub mod http;
mod roster;
mod seed_info;

use crate::env::Env;
use crate::handler::Handler;
use color_eyre::Result;
use color_eyre::eyre::WrapErr;
use tracing::debug;
use tracing_subscriber::fmt::format::FmtSpan;

#[tokio::main(flavor = "multi_thread")]
async fn main() -> Result<()> {
    color_eyre::install()?;
    let env = Env::init()?;

    tracing_subscriber::fmt::fmt()
        .with_max_level(env.log_level)
        .with_span_events(FmtSpan::CLOSE)
        .with_env_filter(format!("discord={}", env.log_level))
        .init();

    debug!("loaded env vars: {env:?}");

    let mut client = Handler::new_client(&env).await?;
    client.start_autosharded().await.wrap_err("client error")
}
