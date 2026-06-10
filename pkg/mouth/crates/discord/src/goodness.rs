use roller::Rollable;

#[derive(Debug)]
pub(crate) enum RollGoodness {
    Crit,
    Good,
    Okay,
    Bad,
    Fumble,
}

impl RollGoodness {
    pub(crate) fn invert(&self) -> Self {
        match self {
            RollGoodness::Crit => RollGoodness::Fumble,
            RollGoodness::Good => RollGoodness::Bad,
            RollGoodness::Okay => RollGoodness::Okay,
            RollGoodness::Bad => RollGoodness::Good,
            RollGoodness::Fumble => RollGoodness::Crit,
        }
    }
}

impl<T: Rollable> From<&T> for RollGoodness {
    fn from(roll: &T) -> Self {
        if roll.value() == roll.min() {
            return RollGoodness::Fumble;
        }

        if roll.value() == roll.max() {
            return RollGoodness::Crit;
        }

        let norm_value = roll.value() - roll.min();
        let norm_max = roll.max() - roll.min();

        if norm_value < (norm_max / 3) {
            return RollGoodness::Bad;
        }

        if norm_value > (norm_max / 3 * 2) {
            return RollGoodness::Good;
        }

        RollGoodness::Okay
    }
}
