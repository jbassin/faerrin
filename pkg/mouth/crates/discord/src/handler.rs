use crate::control::Control;
use crate::db::DB;
use crate::db::campaign::GameEdition;
use crate::env::Env;
use crate::goodness::RollGoodness;
use crate::host::{Host, SendArgs, Thumbnail, host_says};
use crate::http::{HttpState, speak};
use crate::roster::{Profile, Roster};
use crate::seed_info::SeedInfo;
use axum::Router;
use chart::{Chart, Data, Dataset};
use color_eyre::Result;
use color_eyre::eyre::{ContextCompat, OptionExt, WrapErr, bail, eyre};
use rand::SeedableRng;
use rand::seq::SliceRandom;
use regex::Regex;
use roller::{Res, Roll, RollDie, RollNumber, Rollable, Save};
use serenity::all::{
    ActivityData, ChannelId, ChannelType, CreateWebhook, GuildId, Http, Message, Ready,
    ResumedEvent, Webhook,
};
use serenity::async_trait;
use serenity::futures::future;
use serenity::json::json;
use serenity::prelude::*;
use std::cell::RefCell;
use std::collections::HashMap;
use std::num::NonZero;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, LazyLock};
use tracing::{error, info, instrument};

// Dice-feed Discord webhook + the roll-broadcast websocket endpoint, both
// environment-driven (see pkg/mouth/.env.example). The webhook token is a
// secret — it must NEVER be hardcoded in source. Read once, lazily, after
// dotenv / systemd EnvironmentFile have populated the environment.
static DICE_FEED_URL: LazyLock<String> =
    LazyLock::new(|| std::env::var("DICE_FEED_URL").expect("DICE_FEED_URL must be set"));
static FEED_WS_URL: LazyLock<String> =
    LazyLock::new(|| std::env::var("FEED_WS_URL").expect("FEED_WS_URL must be set"));
// Optional shared secret sent as the `X-Eerie-Token` header to the eerie overlay's
// ingest endpoint. Absent/empty = no header (eerie must then run unauthenticated).
static EERIE_TOKEN: LazyLock<Option<String>> =
    LazyLock::new(|| std::env::var("EERIE_TOKEN").ok().filter(|s| !s.is_empty()));

static FUNC_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"^\s*(?<name>.+)\((?<args>.*)\)\s*$"#).unwrap());

pub(crate) struct Handler {
    pub db: Arc<DB>,
    pub roster: Roster,
    pub state: Arc<Mutex<HandlerState>>,

    pub is_initialized: AtomicBool,
}

pub(crate) struct HandlerState {
    pub webhooks: Mutex<HashMap<GuildId, HashMap<ChannelId, Arc<Webhook>>>>,
    pub feed: Mutex<RefCell<Option<Arc<Webhook>>>>,
    pub env: Mutex<Vec<(String, String)>>,
    pub seed: Mutex<SeedInfo>,
    pub http: Mutex<RefCell<Option<Arc<Http>>>>,
}

impl Handler {
    #[instrument(level = "trace")]
    pub(crate) async fn new_client(env: &Env) -> Result<Client> {
        let db = Arc::new(DB::new(&env.database_url).await?);
        let roster = Roster::load(&env.players_path)?;

        let intents = GatewayIntents::non_privileged()
            | GatewayIntents::GUILD_MESSAGES
            | GatewayIntents::DIRECT_MESSAGES
            | GatewayIntents::MESSAGE_CONTENT;

        Client::builder(&env.discord_token, intents)
            .event_handler(Self {
                db,
                roster,
                state: Arc::new(Mutex::new(HandlerState {
                    webhooks: Mutex::new(HashMap::new()),
                    feed: Mutex::new(RefCell::new(None)),
                    env: Mutex::new(Vec::new()),
                    seed: Mutex::new(SeedInfo {
                        seed: rand::random(),
                        blame_id: 1,
                        blame: "Josh".to_string(),
                    }),
                    http: Mutex::new(RefCell::new(None)),
                })),

                is_initialized: AtomicBool::new(false),
            })
            .await
            .wrap_err("failed to create discord client")
    }

    #[instrument(level = "trace", skip(self, ctx))]
    pub(crate) async fn init_webhooks(&self, ctx: Context, guilds: Vec<GuildId>) -> Result<()> {
        let channels = guilds
            .iter()
            .filter_map(|g| ctx.cache.guild(g))
            .flat_map(|g| g.channels.values().cloned().collect::<Vec<_>>())
            .filter(|c| c.kind == ChannelType::Text)
            .map(async |c| {
                let w = c.webhooks(&ctx.http).await?;
                Ok::<_, serenity::Error>((c.clone(), w))
            })
            .collect::<Vec<_>>();

        let webhooks =
            future::join_all(channels).await.into_iter().collect::<Result<Vec<_>, _>>()?;

        for (c, ws) in webhooks {
            let w = match ws.into_iter().find(|ws| ws.token.is_some()) {
                Some(w) => w,
                None => {
                    match c.create_webhook(&ctx.http, CreateWebhook::new("faceless-host")).await {
                        Ok(w) => w,
                        Err(e) => {
                            error!("failed to create webhook: {e}");
                            continue;
                        }
                    }
                }
            };

            let guild_id = w.guild_id.unwrap();
            let channel_id = w.channel_id.unwrap();

            self.state
                .lock()
                .await
                .webhooks
                .lock()
                .await
                .entry(guild_id)
                .and_modify(|m| {
                    m.insert(channel_id, Arc::new(w.clone()));
                })
                .or_insert_with(|| HashMap::from([(channel_id, Arc::new(w.clone()))]));
        }

        info!(
            "websockets are ready for {:?} guilds",
            self.state.lock().await.webhooks.lock().await.len()
        );
        Ok(())
    }

    #[instrument(level = "trace", skip(self))]
    pub(crate) async fn init_funcs(&self) -> Result<()> {
        let funcs = self
            .db
            .get_all_funcs()
            .await?
            .into_iter()
            .map(|f| (f.name, f.payload))
            .collect::<Vec<_>>();

        self.state.lock().await.env.lock().await.extend(funcs);

        info!("loaded {} functions", self.state.lock().await.env.lock().await.len());
        Ok(())
    }

    #[instrument(level = "trace", skip(self))]
    pub(crate) async fn init_http(&self) -> Result<()> {
        info!("initializing http client");

        let app = Router::new()
            .route("/api/v1/speak", axum::routing::post(speak))
            .with_state(HttpState { handler: self.state.clone() });

        // Internal-only by default (Discord dials outbound; these endpoints are a
        // local control plane). Override with MOUTH_BIND_ADDR only behind a proxy —
        // never bind all interfaces by default.
        let bind = std::env::var("MOUTH_BIND_ADDR").unwrap_or_else(|_| "127.0.0.1:10203".into());
        let listener = tokio::net::TcpListener::bind(&bind).await?;
        tokio::spawn(async { axum::serve(listener, app).await });

        info!("listening http client");

        Ok(())
    }

    #[instrument(level = "trace", skip(self))]
    pub(crate) async fn get_webhook(
        &self,
        guild_id: &GuildId,
        channel_id: &ChannelId,
    ) -> Result<Arc<Webhook>> {
        Ok(self
            .state
            .lock()
            .await
            .webhooks
            .lock()
            .await
            .get(guild_id)
            .wrap_err("no webhooks for guild found")?
            .get(channel_id)
            .wrap_err("no webhooks for channel")?
            .clone())
    }

    async fn get_feed(&self, ctx: &Context) -> Result<Arc<Webhook>> {
        let state = self.state.lock().await;
        let cell = state.feed.lock().await;
        if let Some(feed) = cell.borrow().clone() {
            return Ok(feed);
        }

        let webhook = Arc::new(Webhook::from_url(&ctx.http, DICE_FEED_URL.as_str()).await?);
        cell.replace(Some(webhook.clone()));

        Ok(webhook)
    }

    pub(crate) fn trim<S: AsRef<str>>(&self, s: S) -> String {
        s.as_ref()
            .trim()
            .trim_start_matches("```")
            .trim_start_matches("ocaml")
            .trim_end_matches("```")
            .trim()
            .to_owned()
    }

    #[instrument(level = "trace", skip(self, ctx, webhook))]
    pub(crate) async fn handle_message(
        &self,
        ctx: &Context,
        webhook: Arc<Webhook>,
        profile: Profile,
        contents: String,
    ) -> Result<()> {
        let func = self.parse_func(&contents);
        match func {
            Ok((name, args)) => match (name.as_str(), args) {
                ("reseed", _) => self.reseed(ctx, webhook, profile).await,
                ("plot", args) => {
                    if args.len() != 2 {
                        bail!("plot takes 2 arguments")
                    }

                    let base = args[0].parse::<usize>()?;
                    self.dyn_plot(ctx, base, args[1].as_str(), webhook, profile).await
                }
                _ => self.try_message(ctx, webhook, profile, contents).await,
            },
            Err(_) => self.try_message(ctx, webhook, profile, contents).await,
        }
    }

    #[instrument(level = "trace", skip(self))]
    pub(crate) fn parse_func(&self, contents: &str) -> Result<(String, Vec<String>)> {
        let res = FUNC_RE.captures(contents).ok_or_eyre("no capture found")?;

        let name = res.name("name").ok_or_eyre("no name found")?.as_str().to_string();
        let args = res
            .name("args")
            .ok_or_eyre("no args found")?
            .as_str()
            .split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();

        Ok((name, args))
    }

    #[instrument(level = "trace", skip(self, ctx, webhook))]
    pub(crate) async fn reseed(
        &self,
        ctx: &Context,
        webhook: Arc<Webhook>,
        profile: Profile,
    ) -> Result<()> {
        let seed_info = SeedInfo::new(&profile);
        info!("new seed info: {:?}", seed_info);

        Host::KnifeThatTeaches
            .send(
                ctx.http(),
                webhook,
                SendArgs {
                    title: Some(format!("{} reseeded!", seed_info.blame)),
                    contents: Some(
                        [
                            "(∩ᵔ ᵕ ᵔ )⊃━☆ﾟ.*+.".to_owned(),
                            "gots a new number. totes wont help tho!".to_owned(),
                            "lol".to_owned(),
                        ]
                        .choose(&mut rand::rngs::StdRng::from_entropy())
                        .unwrap()
                        .clone(),
                    ),
                    fields: vec![("New Seed".to_owned(), format!("{}", seed_info.seed))],
                    ..Default::default()
                },
            )
            .await?;

        *self.state.lock().await.seed.lock().await = seed_info;
        Ok(())
    }

    #[instrument(level = "trace", skip(self, ctx, webhook))]
    pub(crate) async fn dyn_plot(
        &self,
        ctx: &Context,
        base: usize,
        interval: &str,
        webhook: Arc<Webhook>,
        profile: Profile,
    ) -> Result<()> {
        let dice = self.db.get_dice(base, interval).await?;
        let mut len: i32 = 0;

        let datasets = dice
            .into_iter()
            .map(|(player_id, data)| {
                len = data.len() as i32;

                let total = data.iter().sum::<i32>();
                let avg =
                    data.iter().enumerate().map(|(i, v)| (i + 1) as f64 * *v as f64).sum::<f64>()
                        / total as f64;

                let mut normalized = vec![0; data.len()];
                for (idx, val) in data.iter().enumerate() {
                    normalized[idx] = (((*val as f64) / (total as f64)) * 100.) as i32;
                }

                let label = self.roster.name_for(player_id).unwrap_or("unknown");
                Dataset { label: format!("{label} ({avg:.1} • {total})"), data: normalized }
            })
            .collect();

        let chart =
            Chart::new(format!("{interval} plot"), Data { y_axis: (1..=len).collect(), datasets });

        let chart_url = chart.url()?;

        Host::KnifeThatTeaches
            .send(
                ctx.http(),
                webhook,
                SendArgs {
                    title: Some(format!(
                        "i drew u a pic of evry d{base} uv rlled in the past {interval}!"
                    )),
                    file: Some(chart_url),
                    img: Thumbnail::None,
                    footer: Some(format!(
                        "generated for {}.",
                        profile.player_name.to_ascii_lowercase()
                    )),
                    ..Default::default()
                },
            )
            .await?;

        Ok(())
    }

    #[instrument(level = "trace", skip(self, ctx, webhook))]
    pub(crate) async fn try_message(
        &self,
        ctx: &Context,
        webhook: Arc<Webhook>,
        profile: Profile,
        contents: String,
    ) -> Result<()> {
        info!("attempt process as roll");
        if let Control::Stop = self.roll(ctx, webhook, profile, contents.as_str()).await {
            return Ok(());
        }

        Ok(())
    }

    #[instrument(level = "trace", skip(self, ctx, webhook))]
    pub(crate) async fn roll(
        &self,
        ctx: &Context,
        webhook: Arc<Webhook>,
        profile: Profile,
        contents: &str,
    ) -> Control {
        let Res { to_roll, to_save, .. } = {
            let res = self.roll_contents(contents).await;
            match res {
                Ok(res) => res,
                Err(_) => {
                    return Control::Cont;
                }
            }
        };

        for roll in to_roll {
            if let Err(err) = self.handle_roll(ctx, webhook.clone(), &profile, roll, contents).await
            {
                error!("error handling roll: {err}");
            }
        }

        for save in to_save {
            if let Err(err) = self.handle_save(ctx, webhook.clone(), &profile, save).await {
                error!("error handling save: {err}");
            }
        }

        Control::Stop
    }

    #[instrument(level = "trace", skip(self, ctx, webhook))]
    pub(crate) async fn handle_roll(
        &self,
        ctx: &Context,
        webhook: Arc<Webhook>,
        profile: &Profile,
        roll: Roll,
        contents: &str,
    ) -> Result<()> {
        self.save_roll(profile, &roll).await?;
        self.send_roll(ctx, webhook, profile, roll, contents).await?;

        Ok(())
    }

    #[instrument(level = "trace", skip(self))]
    pub(crate) async fn save_roll(&self, profile: &Profile, roll: &Roll) -> Result<()> {
        match roll {
            Roll::Number(_) => Ok(()),
            Roll::Die(d) => self.save_die(profile, d).await,
        }
    }

    #[instrument(level = "trace", skip(self))]
    pub(crate) async fn save_die(&self, profile: &Profile, die: &RollDie) -> Result<()> {
        // Don't persist pathological pools/dice into the roll history. Each die in a
        // pool is one row (see the loop below), so a novelty roll like `10000d10000`
        // writes 10k rows and drowns out real gameplay. Skip pools larger than 30
        // dice (still well above any real high-level damage roll), and skip any die
        // whose base exceeds 100 (no real polyhedral die is bigger). The roll is still
        // rolled & shown to the channel — it's just not saved.
        const MAX_POOL: usize = 30;
        const MAX_BASE: isize = 100;

        if die.dice.len() > MAX_POOL {
            return Ok(());
        }

        for (base, value) in die.dice.iter() {
            if *base > MAX_BASE {
                continue;
            }
            self.db
                .insert_die(
                    *base as i32,
                    *value as i32,
                    profile.player_id,
                    self.state.lock().await.seed.lock().await.blame_id,
                )
                .await?;
        }

        Ok(())
    }

    #[instrument(level = "trace", skip(self, ctx, webhook))]
    pub(crate) async fn send_roll(
        &self,
        ctx: &Context,
        webhook: Arc<Webhook>,
        profile: &Profile,
        roll: Roll,
        contents: &str,
    ) -> Result<()> {
        match roll {
            Roll::Number(n) => self.send_number(ctx, webhook, profile, n, contents).await,
            roll @ Roll::Die(_) => self.send_die(ctx, webhook, profile, roll).await,
        }
    }

    #[instrument(level = "trace", skip(self, ctx, webhook))]
    pub(crate) async fn send_die(
        &self,
        ctx: &Context,
        webhook: Arc<Webhook>,
        profile: &Profile,
        roll: Roll,
    ) -> Result<()> {
        let (host, line) = host_says(&profile.character_name, &roll);

        let title = match (&roll).into() {
            RollGoodness::Crit => format!("{}: {} [Crit!]", profile.character_name, roll.value()),
            RollGoodness::Fumble => {
                format!("{}: {} [Fumble!]", profile.character_name, roll.value())
            }
            _ => format!("{}: {}", profile.character_name, roll.value()),
        };

        let footer = {
            let state = self.state.lock().await;
            let seed = state.seed.lock().await;

            match (&roll).into() {
                RollGoodness::Crit => {
                    format!("very good • {} (from {}, with love)", seed.seed, seed.blame)
                }
                RollGoodness::Fumble => {
                    format!("very bad • {} (blame {})", seed.seed, seed.blame)
                }
                RollGoodness::Good => {
                    format!("good • {} (thank {})", seed.seed, seed.blame)
                }
                RollGoodness::Bad => {
                    format!("bad • {} ({} did this)", seed.seed, seed.blame)
                }
                RollGoodness::Okay => {
                    format!("okay • {} (by {})", seed.seed, seed.blame)
                }
            }
        };

        let thumbnail = match profile.campaign_edition {
            GameEdition::pathfinder_2e => {
                if profile.character_class.eq("dm") || profile.character_class.eq("gm") {
                    Thumbnail::Default
                } else {
                    Thumbnail::Url(format!(
                        "https://2e.aonprd.com/Images/Class/{}_Icon.png",
                        profile.character_class
                    ))
                }
            }
            GameEdition::dnd_5e | GameEdition::one_dnd => {
                match profile.character_class.to_lowercase().as_str() {
                    "artificer" => Thumbnail::Url("https://i.imgur.com/QXKeVeE.png".to_owned()),
                    "barbarian" => Thumbnail::Url("https://i.imgur.com/izeK1Py.png".to_owned()),
                    "bard" => Thumbnail::Url("https://i.imgur.com/SjD0TDy.png".to_owned()),
                    "cleric" => Thumbnail::Url("https://i.imgur.com/Ns4op2a.png".to_owned()),
                    "druid" => Thumbnail::Url("https://i.imgur.com/mVeBkwF.png".to_owned()),
                    "dm" | "gm" => Thumbnail::Url("https://i.imgur.com/bYriJqV.png".to_owned()),
                    "fighter" => Thumbnail::Url("https://i.imgur.com/VmOxMtI.png".to_owned()),
                    "monk" => Thumbnail::Url("https://i.imgur.com/1MzgkLc.png".to_owned()),
                    "paladin" => Thumbnail::Url("https://i.imgur.com/kBoheDD.png".to_owned()),
                    "ranger" => Thumbnail::Url("https://i.imgur.com/oaEAeoQ.png".to_owned()),
                    "rogue" => Thumbnail::Url("https://i.imgur.com/5Dy4qb5.png".to_owned()),
                    "sorcerer" => Thumbnail::Url("https://i.imgur.com/a6mkvD5.png".to_owned()),
                    "warlock" => Thumbnail::Url("https://i.imgur.com/z2BSBPm.png".to_owned()),
                    "wizard" => Thumbnail::Url("https://i.imgur.com/l3BqKMc.png".to_owned()),
                    _ => Thumbnail::Default,
                }
            }
        };

        host.send(
            &ctx.http,
            webhook,
            SendArgs {
                title: Some(title),
                contents: Some(line),
                fields: vec![(
                    "Results".to_owned(),
                    format!("{} = `{}`", roll.text(), roll.value()),
                )],
                img: thumbnail,
                footer: Some(footer),
                ..Default::default()
            },
        )
        .await?;

        // The dice-feed side-effects — the Discord feed webhook and the external
        // roll broadcast — are BEST-EFFORT. The roll itself is already posted and
        // saved by now, so a down feed (e.g. feed-ws returning 502) must NOT fail
        // the handler: log and continue instead of propagating.
        let broadcast: Result<()> = async {
            let feed = self.get_feed(ctx).await?;
            Host::Custom(profile.player_name.clone())
                .send_simple(&ctx.http, feed, format!("rolled a {}", roll.value()))
                .await?;

            let (is_crit, is_fumble) = match (&roll).into() {
                RollGoodness::Crit => (true, false),
                RollGoodness::Fumble => (false, true),
                _ => (false, false),
            };

            let client = reqwest::Client::new();
            // v1 payload for @faerrin/eerie. `total` is canonical; `value` is kept
            // as a legacy alias. eerie stamps `ts` on ingest, so we don't send one.
            // Individual die faces (`dice`) + `modifier` are a deferred stretch —
            // they need Roll traversal; the overlay degrades gracefully without them.
            let msg = json!({
                "v": 1,
                "user": profile.player_name,
                "expression": roll.text(),
                "total": roll.value(),
                "value": roll.value(),
                "is_crit": is_crit,
                "is_fumble": is_fumble,
            });
            let payload = serde_json::to_vec(&msg)?;

            let mut request = client
                .post(FEED_WS_URL.as_str())
                .header(reqwest::header::CONTENT_TYPE, "application/json");
            if let Some(token) = EERIE_TOKEN.as_ref() {
                request = request.header("X-Eerie-Token", token);
            }
            let res = request.body(reqwest::Body::from(payload)).send().await?;

            if !res.status().is_success() {
                bail!(
                    "eerie {}: {}",
                    res.status().as_str(),
                    res.status().canonical_reason().unwrap_or("")
                );
            }

            Ok(())
        }
        .await;

        if let Err(e) = broadcast {
            error!("dice-feed broadcast failed (non-fatal): {e}");
        }

        Ok(())
    }

    #[instrument(level = "trace", skip(self, ctx, webhook))]
    pub(crate) async fn send_number(
        &self,
        ctx: &Context,
        webhook: Arc<Webhook>,
        profile: &Profile,
        number: RollNumber,
        contents: &str,
    ) -> Result<()> {
        Host::KnifeThatTeaches
            .send(
                &ctx.http,
                webhook,
                SendArgs {
                    title: Some(format!("i invented the number {}", number.value)),
                    contents: Some(
                        [
                            "mmm makin me do ur math is rude".to_owned(),
                            "wowwwww this was so easy i did it with my eyes closed".to_owned(),
                            "did u a math just for funsies".to_owned(),
                        ]
                        .choose(&mut rand::rngs::StdRng::from_entropy())
                        .unwrap()
                        .to_owned(),
                    ),
                    fields: vec![(
                        "Result".to_owned(),
                        format!("{} = `{}`", contents, number.value),
                    )],
                    footer: Some(format!(":P for {}", profile.player_name.to_ascii_lowercase())),
                    ..Default::default()
                },
            )
            .await?;

        Ok(())
    }

    #[instrument(level = "trace", skip(self, ctx, webhook))]
    pub(crate) async fn handle_save(
        &self,
        ctx: &Context,
        webhook: Arc<Webhook>,
        profile: &Profile,
        save: Save,
    ) -> Result<()> {
        info!("new save: {:?}", save);

        self.db.insert_func(&save.name, &save.payload).await?;
        Host::KnifeThatTeaches
            .send(
                ctx.http(),
                webhook,
                SendArgs {
                    title: Some(format!("{} saved!", save.name)),
                    contents: Some(format!(
                        "hmm.... okay {}, ill remember that\n```json\n{}\n```",
                        profile.player_name.to_ascii_lowercase(),
                        save.payload
                    )),
                    ..Default::default()
                },
            )
            .await?;

        Ok(())
    }

    #[instrument(level = "trace", skip(self))]
    async fn roll_contents(&self, input: &str) -> Result<Res> {
        roller::roll(
            input.into(),
            self.state.lock().await.env.lock().await.clone(),
            &mut rand::rngs::StdRng::from_entropy(),
        )
        .map_err(|e| eyre!(e))
    }
}

#[async_trait]
impl EventHandler for Handler {
    #[instrument(level = "trace", skip(self, ctx))]
    async fn cache_ready(&self, ctx: Context, guilds: Vec<GuildId>) {
        if self.is_initialized.load(Ordering::Relaxed) {
            return;
        }

        self.state.lock().await.http.get_mut().replace(Some(ctx.http.clone()));

        if let Err(e) = self.init_webhooks(ctx, guilds).await {
            error!("failed to init webhooks: {e}");
        };

        if let Err(e) = self.init_funcs().await {
            error!("failed to init functions: {e}");
        };

        if let Err(e) = self.init_http().await {
            error!("failed to init http: {e}");
        }
    }

    async fn message(&self, ctx: Context, msg: Message) {
        if msg.author.bot || msg.author.id == ctx.cache.current_user().id {
            return;
        }

        let content = self.trim(msg.content);
        if content.is_empty() {
            return;
        }

        let webhook = {
            let webhook: Result<_> = async {
                let guild_id = msg.guild_id.wrap_err("could not get guild id")?;
                let channel_id = msg.channel_id;

                let webhook = self.get_webhook(&guild_id, &channel_id).await?;

                Ok(webhook)
            }
            .await;

            if let Err(e) = webhook {
                error!("failed to get webhook: {e}");
                return;
            }

            webhook.unwrap().clone()
        };

        let profile = match self.roster.get(msg.author.id.to_string().as_str()) {
            Some(p) => p,
            None => {
                info!("no roster entry for author {}", msg.author.id);
                return;
            }
        };

        info!("received message from {}: {}", profile.player_name, content);

        if let Err(e) = self.handle_message(&ctx, webhook, profile, content).await {
            error!("failed to handle message: {e}");
            return;
        }
    }

    #[instrument(level = "trace", skip(self, ctx))]
    async fn ready(&self, ctx: Context, trivia: Ready) {
        info!(
            "connected to discord as {}#{}",
            trivia.user.name,
            trivia.user.discriminator.unwrap_or_else(|| NonZero::new(1).unwrap())
        );

        ctx.set_activity(Some(ActivityData::watching("the infinite horizon")));
    }

    #[instrument(level = "trace", skip(self))]
    async fn resume(&self, _: Context, _: ResumedEvent) {
        info!("my vision, once clouded, is restored.")
    }
}
