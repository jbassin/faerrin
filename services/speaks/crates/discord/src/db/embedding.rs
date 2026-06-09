use crate::db::DB;
use color_eyre::eyre::{Result, eyre};
use sqlx::{Error, query, query_file, query_file_as};
use std::fmt::Debug;
use tracing::instrument;

pub(crate) struct EmbeddingListing {
    pub name: String,
    pub hash: i64,
}

impl DB {
    #[instrument(level = "trace", skip(self))]
    pub async fn embedding_already_exists<S: Into<String> + Debug>(
        &self,
        name: S,
        hash: usize,
    ) -> Result<bool> {
        let listing = query_file_as!(
            EmbeddingListing,
            "src/db/queries/get_embedding_listing.sql",
            name.into()
        )
        .fetch_one(&self.pool)
        .await;

        match listing {
            Err(Error::RowNotFound) => Ok(false),
            Err(e) => Err(eyre!("failed to get embedding listing: {}", e)),
            Ok(listing) => Ok(hash == listing.hash as usize),
        }
    }

    #[instrument(level = "trace", skip(self))]
    pub async fn delete_embedding<S: Into<String> + Debug>(&self, name: S) -> Result<()> {
        let name = name.into();

        query_file!("src/db/queries/delete_embedding_listing.sql", &name)
            .execute(&self.pool)
            .await
            .map_err(|e| eyre!(e))
            .map(|_| ())?;

        query_file!("src/db/queries/delete_embeddings.sql", name)
            .execute(&self.pool)
            .await
            .map_err(|e| eyre!(e))
            .map(|_| ())?;

        Ok(())
    }

    #[instrument(level = "trace", skip(self))]
    pub async fn insert_embedding<S: Into<String> + Debug>(
        &self,
        name: S,
        hash: usize,
        chunks: Vec<(usize, pgvector::Vector)>,
    ) -> Result<()> {
        let name = name.into();

        query_file!("src/db/queries/insert_embedding_listing.sql", &name, hash as i64)
            .execute(&self.pool)
            .await
            .map_err(|e| eyre!(e))
            .map(|_| ())?;

        for (idx, chunk) in chunks.into_iter() {
            query(
                r#"INSERT INTO embeddings(listing, idx, embedding)
                    VALUES ($1, $2, $3)"#,
            )
            .bind(&name)
            .bind(idx as i64)
            .bind(chunk)
            .execute(&self.pool)
            .await
            .map_err(|e| eyre!(e))
            .map(|_| ())?;
        }

        Ok(())
    }
}
