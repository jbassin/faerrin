use color_eyre::eyre::Result;
use std::env;
use std::str::FromStr;
use tracing::{Level, instrument};

#[derive(Debug)]
pub(crate) struct Env {
    pub log_level: Level,
    pub discord_token: String,
    pub database_url: String,
}

impl Env {
    #[instrument(level = "trace")]
    pub(crate) fn init() -> Result<Self> {
        // Optional: load a local .env if present, but don't fail when it's absent —
        // under systemd the environment is supplied via EnvironmentFile, with no
        // .env file in the working directory.
        let _ = dotenvy::dotenv();

        let log_level =
            env::var("RUST_LOG").map_or(Level::INFO, |t| Level::from_str(t.as_str()).unwrap());
        let discord_token = env::var("DISCORD_TOKEN")?;
        let database_url = env::var("DATABASE_URL")?;

        Ok(Self { log_level, discord_token, database_url })
    }
}
