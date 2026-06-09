use crate::db::DB;
use crate::db::campaign::GameEdition;
use color_eyre::eyre::{Result, WrapErr};
use sqlx::query_file_as;
use tracing::instrument;

#[derive(Clone, Debug)]
pub(crate) struct Profile {
    pub discord_name: String,
    pub discord_snowflake: String,
    pub discord_is_admin: bool,

    pub player_id: i32,
    pub player_name: String,

    pub campaign_name: String,
    pub campaign_edition: GameEdition,
    pub campaign_is_one_shot: bool,

    pub character_name: String,
    pub character_class: String,
    pub character_is_dm: bool,
}

impl DB {
    #[instrument(level = "trace", skip(self))]
    pub(crate) async fn get_profile(&self, snowflake: &str) -> Result<Profile> {
        query_file_as!(Profile, "src/db/queries/get_player_profile.sql", snowflake)
            .fetch_one(&self.pool)
            .await
            .wrap_err("failed to get player profile")
    }
}
