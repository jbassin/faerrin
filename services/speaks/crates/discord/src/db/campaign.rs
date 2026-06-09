use crate::db::DB;
use color_eyre::eyre::{Result, WrapErr};
use sqlx::query_file_as;
use tracing::instrument;

#[allow(non_camel_case_types)]
#[derive(Clone, Debug, sqlx::Type)]
pub(crate) enum GameEdition {
    pathfinder_2e,
    dnd_5e,
    one_dnd,
}

#[derive(Debug)]
pub(crate) struct Campaign {
    pub id: i32,
    pub name: String,
    pub edition: GameEdition,
    pub is_one_shot: bool,
}

impl DB {
    #[instrument(level = "trace", skip(self))]
    pub(crate) async fn get_active_campaign(&self) -> Result<Campaign> {
        query_file_as!(Campaign, "src/db/queries/get_active_campaign.sql")
            .fetch_one(&self.pool)
            .await
            .wrap_err("failed to get active campaign")
    }
}
