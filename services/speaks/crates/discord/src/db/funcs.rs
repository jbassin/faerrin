use crate::db::DB;
use color_eyre::eyre::{Result, WrapErr, eyre};
use sqlx::query_file_as;
use tracing::instrument;

#[derive(Debug)]
pub(crate) struct Func {
    pub name: String,
    pub payload: String,
}

impl DB {
    #[instrument(level = "trace", skip(self))]
    pub(crate) async fn get_all_funcs(&self) -> Result<Vec<Func>> {
        query_file_as!(Func, "src/db/queries/get_all_funcs.sql")
            .fetch_all(&self.pool)
            .await
            .wrap_err("failed to get all funcs")
    }

    #[instrument(level = "trace", skip(self))]
    pub(crate) async fn insert_func(&self, name: &str, payload: &str) -> Result<()> {
        query_file_as!(Func, "src/db/queries/insert_func.sql", name, payload)
            .execute(&self.pool)
            .await
            .map_err(|e| eyre!(e))
            .map(|_| ())
    }
}
