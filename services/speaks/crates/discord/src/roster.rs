//! Player identity, read from `players.toml` at startup instead of the Postgres
//! identity tables. This is the bot-owned half of the identity boundary: the
//! `snowflake → player` binding plus the Discord-runtime / mechanical fields
//! (`character`, `class`, `edition`) that `@faerrin/content` doesn't track. The
//! player `name`s are the SSOT join key with content's `campaigns.yaml`.

use crate::db::campaign::GameEdition;
use color_eyre::eyre::{Result, WrapErr};
use serde::Deserialize;
use std::collections::HashMap;

/// The resolved identity for one Discord author. Only the fields the bot actually
/// uses (roll display + thumbnail + dice key) — the former DB `Profile` carried
/// several columns that were never read.
#[derive(Clone, Debug)]
pub(crate) struct Profile {
    /// Stable integer id, kept as the key for the existing `dice` history.
    pub player_id: i32,
    pub player_name: String,
    pub campaign_edition: GameEdition,
    pub character_name: String,
    pub character_class: String,
}

#[derive(Deserialize)]
struct PlayersFile {
    campaign: CampaignCfg,
    players: Vec<PlayerCfg>,
}

#[derive(Deserialize)]
struct CampaignCfg {
    // `name` is intentionally not read (cosmetic) — serde ignores it.
    edition: GameEdition,
}

#[derive(Deserialize)]
struct PlayerCfg {
    name: String,
    snowflakes: Vec<String>,
    player_id: i32,
    character: String,
    class: String,
    // `is_dm` / `is_admin` are present in the file but unused by the bot — ignored.
}

/// Snowflake → `Profile`, plus a `player_id → name` map for the dice-plot labels.
pub(crate) struct Roster {
    by_snowflake: HashMap<String, Profile>,
    names: HashMap<i32, String>,
}

impl Roster {
    /// Load and index `players.toml` from `path`.
    pub(crate) fn load(path: &str) -> Result<Self> {
        let raw = std::fs::read_to_string(path)
            .wrap_err_with(|| format!("failed to read players file at {path}"))?;
        let file: PlayersFile =
            toml::from_str(&raw).wrap_err_with(|| format!("failed to parse {path}"))?;

        let mut by_snowflake = HashMap::new();
        let mut names = HashMap::new();
        for p in &file.players {
            names.insert(p.player_id, p.name.clone());
            for sf in &p.snowflakes {
                by_snowflake.insert(
                    sf.clone(),
                    Profile {
                        player_id: p.player_id,
                        player_name: p.name.clone(),
                        campaign_edition: file.campaign.edition.clone(),
                        character_name: p.character.clone(),
                        character_class: p.class.clone(),
                    },
                );
            }
        }

        Ok(Self { by_snowflake, names })
    }

    /// Resolve a Discord author snowflake to their profile, if known.
    pub(crate) fn get(&self, snowflake: &str) -> Option<Profile> {
        self.by_snowflake.get(snowflake).cloned()
    }

    /// The display name for a `player_id` (used to label dice-history plots).
    pub(crate) fn name_for(&self, player_id: i32) -> Option<&str> {
        self.names.get(&player_id).map(String::as_str)
    }

    #[cfg(test)]
    fn parse(raw: &str) -> Result<Self> {
        let file: PlayersFile = toml::from_str(raw)?;
        let mut by_snowflake = HashMap::new();
        let mut names = HashMap::new();
        for p in &file.players {
            names.insert(p.player_id, p.name.clone());
            for sf in &p.snowflakes {
                by_snowflake.insert(
                    sf.clone(),
                    Profile {
                        player_id: p.player_id,
                        player_name: p.name.clone(),
                        campaign_edition: file.campaign.edition.clone(),
                        character_name: p.character.clone(),
                        character_class: p.class.clone(),
                    },
                );
            }
        }
        Ok(Self { by_snowflake, names })
    }
}

#[cfg(test)]
mod test {
    use super::*;

    const FIXTURE: &str = r#"
        schema_version = 1
        [campaign]
        name = "Through a Song, Darkly"
        edition = "pathfinder_2e"

        [[players]]
        name = "Josh"
        snowflakes = ["111"]
        player_id = 1
        character = "Gamemaster"
        class = "gm"
        is_dm = true
        is_admin = true

        [[players]]
        name = "Jorge"
        snowflakes = ["222", "333"]
        player_id = 2
        character = "Argyle"
        class = "champion"
        is_dm = false
        is_admin = false
    "#;

    #[test]
    fn resolves_snowflakes_and_ignores_unused_fields() {
        let roster = Roster::parse(FIXTURE).unwrap();

        let josh = roster.get("111").expect("josh by snowflake");
        assert_eq!(josh.player_name, "Josh");
        assert_eq!(josh.character_name, "Gamemaster");
        assert_eq!(josh.character_class, "gm");
        assert!(matches!(josh.campaign_edition, GameEdition::pathfinder_2e));

        // Both of Jorge's accounts resolve to the same player.
        assert_eq!(roster.get("222").unwrap().player_id, 2);
        assert_eq!(roster.get("333").unwrap().player_name, "Jorge");

        assert!(roster.get("999").is_none());
        assert_eq!(roster.name_for(2), Some("Jorge"));
    }
}
