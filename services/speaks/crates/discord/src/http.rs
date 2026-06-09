use crate::handler::HandlerState;
use crate::host::{Host, SendArgs, Thumbnail};
use axum::Json;
use axum::extract::State;
use serde::Deserialize;
use serenity::all::{ChannelId, GuildId};
use std::collections::HashMap;
use std::fmt::Debug;
use std::hash::{DefaultHasher, Hash, Hasher};
use std::sync::{Arc, LazyLock};
use tokio::sync::Mutex;
use tracing::{info, instrument};

// Embedding service endpoint — environment-driven (see .env.example). This whole
// subsystem is scheduled for removal in Phase 2; until then, keep the URL out of
// source.
static EMBED_URL: LazyLock<String> =
    LazyLock::new(|| std::env::var("EMBED_URL").expect("EMBED_URL must be set"));

const WATERMARK: usize = 32768;
const OVERLAP: usize = 40;

#[derive(Clone)]
pub(crate) struct HttpState {
    pub handler: Arc<Mutex<HandlerState>>,
}

#[derive(Deserialize)]
pub(crate) struct SpeakArgs {
    pub host: String,
    pub guild: GuildId,
    pub channel: ChannelId,
    pub message: String,
    pub img: Option<bool>,
}

#[derive(Deserialize)]
pub(crate) struct EmbedResp {
    pub embedding: Vec<Vec<f32>>,
}

#[derive(Deserialize)]
pub(crate) struct SaveArgs {
    pub api_key: String,
    pub name: String,
    pub contents: String,
    pub force: Option<bool>,
}

#[instrument(level = "trace", skip(handler))]
pub(crate) async fn speak(
    State(HttpState { handler }): State<HttpState>,
    Json(SpeakArgs { host, guild, channel, message, img }): Json<SpeakArgs>,
) -> Result<(), String> {
    let handler = handler.lock().await;

    let http = handler.http.lock().await.borrow().as_ref().ok_or("no initialized http")?.clone();
    let host = Host::get_host(host);

    let webhooks = handler.webhooks.lock().await;
    let guild = webhooks.get(&guild).ok_or("no known guild".to_owned())?;
    let channel = guild.get(&channel).ok_or("no known channel".to_owned())?.clone();

    host.send(
        &http,
        channel,
        SendArgs {
            title: None,
            contents: Some(message),
            img: img
                .map(|t| if t { Default::default() } else { Thumbnail::None })
                .unwrap_or(Default::default()),
            fields: vec![],
            file: None,
            raw_file: None,
            components: None,
            footer: None,
        },
    )
    .await
    .map(|_| ())
    .map_err(|e| e.to_string())?;

    Ok(())
}

#[instrument(level = "trace", skip(handler))]
pub(crate) async fn save(
    State(HttpState { handler }): State<HttpState>,
    Json(SaveArgs { api_key, name, contents, force }): Json<SaveArgs>,
) -> Result<(), String> {
    if api_key != "faerrin" {
        return Err("API key mismatch".to_string());
    }

    let hash = {
        let mut hasher = DefaultHasher::new();
        contents.hash(&mut hasher);

        hasher.finish()
    };
    info!("hash: {}", hash);

    {
        let handler = handler.lock().await;

        if !force.unwrap_or(false) {
            let already_exists = handler
                .db
                .embedding_already_exists(name.as_str(), hash as usize)
                .await
                .map_err(|e| e.to_string())?;

            if already_exists {
                return Ok(());
            }
        } else {
            handler.db.delete_embedding(name.as_str()).await.map_err(|e| e.to_string())?;
        }
    }

    let chunks = chunk(contents);
    info!("seen {} chunks", chunks.len());

    let mut embeddings = vec![];
    for (idx, chunk) in chunks.into_iter().enumerate() {
        let res = embed(chunk).await?;
        info!("embedding generated: {}, {}", idx, res.to_vec().len());

        embeddings.push((idx, res));
    }

    let handler = handler.lock().await;
    handler.db.insert_embedding(name, hash as usize, embeddings).await.map_err(|e| e.to_string())
}

#[instrument(level = "trace")]
pub(crate) fn chunk<S: Into<String> + Debug>(s: S) -> Vec<String> {
    let s = s.into();

    if s.len() < WATERMARK {
        return vec![s];
    }

    let s = s.lines().collect::<Vec<_>>();
    let mut builder = vec![];

    let mut min = s.len();
    for line in s.iter() {
        builder.push(line.to_string());

        if builder.iter().map(|s| s.len()).sum::<usize>() > WATERMARK {
            if builder.len() < min {
                min = builder.len();
            }

            builder.clear();
        }
    }

    let mut idx = 0;
    let mut res = vec![];
    while idx < s.len() {
        let next = idx + min;

        let lines = if next > s.len() { s[idx..s.len()].to_vec() } else { s[idx..next].to_vec() };

        res.push(lines.join("\n"));
        idx = next - OVERLAP;
    }

    res
}

#[instrument(level = "trace")]
pub(crate) async fn embed<S: Into<String> + Debug>(s: S) -> Result<pgvector::Vector, String> {
    let client = reqwest::Client::new();

    let body = HashMap::from([("content", s.into())]);
    let res = client
        .post(EMBED_URL.as_str())
        .header("Content-Type", "application/json")
        .header("Authorization", "Bearer faerrin")
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json::<Vec<EmbedResp>>()
        .await
        .map_err(|e| e.to_string())?
        .first()
        .ok_or_else(|| "no embeddings".to_owned())?
        .embedding
        .first()
        .ok_or_else(|| "no embeddings".to_owned())?
        .clone();

    if res.len() != 2048 {
        return Err(format!("embeddings size: {}", res.len()));
    }

    Ok(pgvector::Vector::from(res))
}
