use crate::roster::Profile;
use tracing::instrument;

#[derive(Debug)]
pub(crate) struct SeedInfo {
    pub seed: u64,

    pub blame_id: i32,
    pub blame: String,
}

impl SeedInfo {
    #[instrument(level = "trace")]
    pub(crate) fn new(profile: &Profile) -> Self {
        Self {
            seed: rand::random(),
            blame_id: profile.player_id,
            blame: profile.player_name.clone(),
        }
    }
}
