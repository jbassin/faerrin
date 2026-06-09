use crate::db::DB;
use color_eyre::eyre::{Result, WrapErr, eyre};
use sqlx::{query_file, query_file_as};
use std::collections::HashMap;
use tracing::instrument;

pub(crate) struct Die {
    pub value: i32,
    pub count: i32,
    pub player_name: String,
}

impl DB {
    #[instrument(level = "trace", skip(self))]
    pub(crate) async fn insert_die(
        &self,
        base: i32,
        value: i32,
        player_id: i32,
        blame_id: i32,
    ) -> Result<()> {
        query_file!("src/db/queries/insert_die.sql", base, value, player_id, blame_id)
            .execute(&self.pool)
            .await
            .map_err(|e| eyre!(e))
            .map(|_| ())
    }

    #[instrument(level = "trace", skip(self))]
    pub(crate) async fn get_dice(
        &self,
        base: usize,
        interval: &str,
    ) -> Result<HashMap<String, Vec<i32>>> {
        let dice = query_file_as!(Die, "src/db/queries/get_dice_query.sql", base as i32, interval)
            .fetch_all(&self.pool)
            .await
            .wrap_err("failed to get dice")?;

        let mut res = HashMap::new();
        for die in dice {
            let arr = res.entry(die.player_name).or_insert_with(|| vec![0; base]);
            arr[die.value as usize - 1] = die.count;
        }

        Ok(res)
    }
}
