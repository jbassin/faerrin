pub(crate) mod campaign;
mod die;
pub(crate) mod funcs;
pub(crate) mod player;

use color_eyre::eyre::Result;
use sqlx::postgres::PgPoolOptions;
use sqlx::{Pool, Postgres};
use tracing::instrument;

#[derive(Debug)]
pub(crate) struct DB {
    pool: Pool<Postgres>,
}

impl DB {
    #[instrument(level = "trace")]
    pub async fn new(conn_url: &str) -> Result<Self> {
        let pool = PgPoolOptions::new().max_connections(5).connect(conn_url).await?;

        Ok(Self { pool })
    }
}
