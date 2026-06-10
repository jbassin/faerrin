use serde::Deserialize;

/// Game edition — drives the PF2e-vs-D&D roll thumbnail logic. Deserialized from
/// `players.toml`'s `edition` string (variant names match the values there).
#[allow(non_camel_case_types)]
#[derive(Clone, Debug, Deserialize)]
pub(crate) enum GameEdition {
    pathfinder_2e,
    dnd_5e,
    one_dnd,
}
