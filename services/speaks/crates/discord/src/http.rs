use crate::handler::HandlerState;
use crate::host::{Host, SendArgs, Thumbnail};
use axum::Json;
use axum::extract::State;
use serde::Deserialize;
use serenity::all::{ChannelId, GuildId};
use std::sync::Arc;
use tokio::sync::Mutex;
use tracing::instrument;

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
