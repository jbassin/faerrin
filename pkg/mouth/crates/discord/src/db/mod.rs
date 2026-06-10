pub(crate) mod campaign;
mod die;
pub(crate) mod funcs;

use color_eyre::eyre::Result;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::{Pool, Sqlite};
use std::str::FromStr;
use tracing::instrument;

#[derive(Debug)]
pub(crate) struct DB {
    pool: Pool<Sqlite>,
}

impl DB {
    #[instrument(level = "trace")]
    pub async fn new(conn_url: &str) -> Result<Self> {
        // SQLite file, created on first run. The bot now holds only its own
        // runtime state (dice history + macros) — identity lives in players.toml.
        let opts = SqliteConnectOptions::from_str(conn_url)?.create_if_missing(true);
        let pool = SqlitePoolOptions::new().max_connections(5).connect_with(opts).await?;

        // Self-initialize the schema (idempotent) so a fresh file just works.
        sqlx::migrate!("./migrations").run(&pool).await?;

        Ok(Self { pool })
    }
}
