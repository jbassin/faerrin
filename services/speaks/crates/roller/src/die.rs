use crate::ast::BinOpr;
use crate::utils::{
    cartesian_product_single, combine_two_possibilities, counter_to_iter, indices_of_k_greatest,
    indices_of_k_least, list_to_string,
};
use counter::Counter;
use itertools::{Itertools, iproduct};
use pipe_trait::Pipe;
use rand::{Rng, seq::SliceRandom};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Serialize)]
pub enum Die {
    Constant(isize),
    Base(usize, isize),
    Seq(usize, Vec<isize>),
    BinOp(Box<Die>, BinOpr, Box<Die>),
    TakeHighest(usize, Box<Die>),
    TakeLowest(usize, Box<Die>),
}

#[derive(Clone, Debug)]
pub struct DieRes {
    pub value: isize,
    pub repr: String,
    pub dice: Vec<(isize, isize)>,
}

impl Die {
    pub fn from_const(const_: isize) -> Self {
        Self::Constant(const_)
    }

    pub fn from_base(count: usize, base: isize) -> Self {
        Self::Base(count, base)
    }

    pub fn from_sequence(count: usize, sequence: Vec<isize>) -> Self {
        Self::Seq(count, sequence.into_iter().collect())
    }

    pub fn from_bin_op(lhs: Die, opr: BinOpr, rhs: Die) -> Self {
        Self::BinOp(Box::new(lhs), opr, Box::new(rhs))
    }

    pub fn take_highest(collect: usize, die: Die) -> Result<Self, String> {
        match die.count() {
            None => return Err("Die must have a valid quantity!".to_owned()),
            Some(c) if c <= collect => {
                return Err("Requested take count must be less than quantity of die!".to_owned());
            }
            Some(_) => (),
        };

        Ok(Self::TakeHighest(collect, Box::new(die)))
    }

    pub fn take_lowest(collect: usize, die: Die) -> Result<Self, String> {
        match die.count() {
            None => return Err("Die must have a valid quantity!".to_owned()),
            Some(c) if c <= collect => {
                return Err("Requested take count must be less than quantity of die!".to_owned());
            }
            Some(_) => (),
        };

        Ok(Self::TakeLowest(collect, Box::new(die)))
    }

    pub fn as_single(&self) -> Option<Self> {
        match self {
            Self::Constant(c) => Some(Self::Constant(*c)),
            Self::Base(_, base) => Some(Self::Base(1, *base)),
            Self::Seq(_, seq) => Some(Self::Seq(1, seq.clone())),
            Self::TakeHighest(..) | Self::TakeLowest(..) | Self::BinOp(..) => None,
        }
    }

    pub fn possibilities(&self) -> Counter<isize> {
        match self {
            Self::Constant(c) => vec![*c].into_iter().collect(),
            Self::Base(1, base) => (1..=*base).collect(),
            Self::Base(count, base) => (1..=*count)
                .map(|_| (1..=*base).collect::<Vec<_>>())
                .reduce(|lhs, rhs| combine_two_possibilities(lhs, &BinOpr::Add, rhs).collect())
                .unwrap()
                .into_iter()
                .collect(),
            Self::Seq(1, values) => values.clone().into_iter().collect(),
            Self::Seq(count, values) => (1..=*count)
                .map(|_| values.clone())
                .reduce(|lhs, rhs| combine_two_possibilities(lhs, &BinOpr::Add, rhs).collect())
                .unwrap()
                .into_iter()
                .collect(),
            Self::BinOp(lhs, opr, rhs) => {
                let lhs = lhs.possibilities().pipe(counter_to_iter).collect::<Vec<_>>();
                let rhs = rhs.possibilities().pipe(counter_to_iter).collect::<Vec<_>>();
                iproduct!(lhs.into_iter(), rhs.into_iter())
                    .map(|(lhs, rhs)| opr.modify(lhs, rhs))
                    .collect()
            }
            Self::TakeHighest(collect, die) => {
                let count = die.count().unwrap();
                let die = die.as_single().unwrap().possibilities().pipe(counter_to_iter).collect();
                cartesian_product_single(die, count)
                    .into_iter()
                    .map(|x| {
                        x.into_iter().sorted_by(|l, r| Ord::cmp(r, l)).take(*collect).sum::<isize>()
                    })
                    .collect()
            }
            Self::TakeLowest(collect, die) => {
                let count = die.count().unwrap();
                let die = die.as_single().unwrap().possibilities().pipe(counter_to_iter).collect();
                cartesian_product_single(die, count)
                    .into_iter()
                    .map(|x| x.into_iter().sorted().take(*collect).sum::<isize>())
                    .collect()
            }
        }
    }

    pub fn count(&self) -> Option<usize> {
        match self {
            Self::Base(count, _) | Self::Seq(count, _) => Some(*count),
            _ => None,
        }
    }

    pub fn repr(&self) -> String {
        match self {
            Self::Constant(c) => c.to_string(),
            Self::Base(1, base) => format!("d{base}"),
            Self::Base(count, base) => format!("{count}d{base}"),
            Self::Seq(1, seq) => format!("d{{{}}}", list_to_string(seq.to_vec())),
            Self::Seq(count, seq) => format!("{count}d{{{}}}", list_to_string(seq.to_vec())),
            Self::BinOp(lhs, opr, rhs) => format!("{} {opr} {}", lhs.repr(), rhs.repr()),
            Self::TakeHighest(collect, die) => format!("max({collect},{})", die.repr()),
            Self::TakeLowest(collect, die) => format!("min({collect},{})", die.repr()),
        }
    }

    pub fn value<R>(&self, rng: &mut R) -> DieRes
    where
        R: Rng,
    {
        match self {
            Self::Constant(c) => DieRes { value: *c, repr: c.to_string(), dice: vec![] },
            Self::Base(1, base) => {
                let value = rng.gen_range(1..=*base);
                DieRes {
                    value,
                    repr: format!("{} ⟪{value}⟫", self.repr()),
                    dice: vec![(*base, value)],
                }
            }
            Self::Base(count, base) => {
                let values = (1..=*count).map(|_| rng.gen_range(1..=*base)).collect::<Vec<_>>();
                let value = values.iter().sum();
                DieRes {
                    value,
                    repr: format!("{} ⟪{}={value}⟫", self.repr(), list_to_string(values.clone())),
                    dice: values.into_iter().map(|x| (*base, x)).collect(),
                }
            }
            Self::Seq(1, values) => {
                let value = *values.choose(rng).unwrap();
                DieRes { value, repr: format!("{} ⟪{value}⟫", self.repr()), dice: vec![] }
            }
            Self::Seq(count, values) => {
                let values = (1..=*count).map(|_| *values.choose(rng).unwrap()).collect::<Vec<_>>();
                let value = values.iter().sum();
                DieRes {
                    value,
                    repr: format!("{} ⟪{}={value}⟫", self.repr(), list_to_string(values)),
                    dice: vec![],
                }
            }
            Self::BinOp(box Self::Constant(lhs), opr, box Self::Constant(rhs)) => DieRes {
                value: opr.modify(*lhs, *rhs),
                repr: format!("{lhs} {opr} {rhs}"),
                dice: vec![],
            },
            Self::BinOp(box lhs, opr, box Self::Constant(rhs)) => {
                let DieRes { value, repr, dice } = lhs.value(rng);
                DieRes { value: opr.modify(value, *rhs), repr: format!("{repr} {opr} {rhs}"), dice }
            }
            Self::BinOp(box Self::Constant(lhs), opr, box rhs) => {
                let DieRes { value, repr, dice } = rhs.value(rng);
                DieRes { value: opr.modify(*lhs, value), repr: format!("{lhs} {opr} {repr}"), dice }
            }
            Self::BinOp(box lhs, opr, box rhs) => {
                let DieRes { value: lhs_value, repr: lhs_repr, dice: lhs_dice } = lhs.value(rng);
                let DieRes { value: rhs_value, repr: rhs_repr, dice: rhs_dice } = rhs.value(rng);
                DieRes {
                    value: opr.modify(lhs_value, rhs_value),
                    repr: format!("{lhs_repr} {opr} {rhs_repr}"),
                    dice: lhs_dice.into_iter().chain(rhs_dice).collect(),
                }
            }
            Self::TakeHighest(collect, box die) => {
                let count = die.count().unwrap();
                let single_die = die.as_single().unwrap();
                let (values, dice): (Vec<_>, Vec<Vec<_>>) = (0..count)
                    .map(|_| {
                        let DieRes { value, dice, .. } = single_die.value(rng);
                        (value, dice)
                    })
                    .unzip();

                let indices = indices_of_k_greatest(&values, *collect);
                let value = values
                    .iter()
                    .enumerate()
                    .filter_map(|(i, v)| match indices.contains(&i) {
                        true => Some(v),
                        false => None,
                    })
                    .sum();
                let values: String = values
                    .iter()
                    .enumerate()
                    .map(|(i, v)| match indices.contains(&i) {
                        true => format!("__**{v}**__"),
                        false => v.to_string(),
                    })
                    .pipe(|x| std::iter::Iterator::intersperse(x, ",".to_owned()))
                    .collect();

                DieRes {
                    value,
                    repr: format!("{} ⟪{values}={value}⟫", self.repr()),
                    dice: dice.into_iter().flatten().collect(),
                }
            }
            Self::TakeLowest(collect, box die) => {
                let count = die.count().unwrap();
                let single_die = die.as_single().unwrap();
                let (values, dice): (Vec<_>, Vec<Vec<_>>) = (0..count)
                    .map(|_| {
                        let DieRes { value, dice, .. } = single_die.value(rng);
                        (value, dice)
                    })
                    .unzip();

                let indices = indices_of_k_least(&values, *collect);
                let value = values
                    .iter()
                    .enumerate()
                    .filter_map(|(i, v)| match indices.contains(&i) {
                        true => Some(v),
                        false => None,
                    })
                    .sum();
                let values: String = values
                    .iter()
                    .enumerate()
                    .map(|(i, v)| match indices.contains(&i) {
                        true => format!("__**{v}**__"),
                        false => v.to_string(),
                    })
                    .pipe(|x| std::iter::Iterator::intersperse(x, ",".to_owned()))
                    .collect();

                DieRes {
                    value,
                    repr: format!("{} ⟪{values}={value}⟫", self.repr()),
                    dice: dice.into_iter().flatten().collect(),
                }
            }
        }
    }

    pub fn max(&self) -> isize {
        match self {
            Self::Constant(c) => *c,
            Self::Base(count, base) => (*count as isize) * base,
            Self::Seq(count, values) => (*count as isize) * *values.iter().max().unwrap(),
            Self::BinOp(box lhs, opr, box rhs) => opr.modify(lhs.max(), rhs.max()),
            Self::TakeHighest(collect, box die) | Self::TakeLowest(collect, box die) => {
                let single_die = die.as_single().unwrap();
                (*collect as isize) * single_die.max()
            }
        }
    }

    pub fn min(&self) -> isize {
        match self {
            Self::Constant(c) => *c,
            Self::Base(count, _) => *count as isize,
            Self::Seq(count, values) => (*count as isize) * *values.iter().min().unwrap(),
            Self::BinOp(box lhs, opr, box rhs) => opr.modify(lhs.min(), rhs.min()),
            Self::TakeHighest(collect, box die) | Self::TakeLowest(collect, box die) => {
                let single_die = die.as_single().unwrap();
                (*collect as isize) * single_die.min()
            }
        }
    }
}
