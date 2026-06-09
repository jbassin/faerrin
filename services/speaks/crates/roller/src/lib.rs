#![feature(binary_heap_into_iter_sorted)]
#![feature(type_alias_impl_trait)]
#![feature(iter_intersperse)]
#![feature(box_patterns)]

mod ast;
mod die;
mod eval;
mod parser;
mod pratt_parser;
mod utils;

use std::{fmt, sync::Arc};

use crate::eval::interpret;
use ast::Display;
use die::{Die, DieRes};
use eval::Cmd;
use rand::rngs::StdRng;
use utils::{counter_to_iter, counter_to_prob};

#[derive(Clone, Debug)]
pub struct Plot {
    pub text: String,
    pub prob: Vec<(isize, f64)>,
    pub avg: f64,
    pub std: f64,
}

#[derive(Clone)]
pub struct Reroll {
    callback_fn: Arc<dyn Fn() -> Roll + Sync + Send>,
}

impl Reroll {
    pub fn run(&self) -> Roll {
        (self.callback_fn)()
    }
}

impl fmt::Debug for Reroll {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Reroll").finish()
    }
}

pub enum RollKind {
    Number,
    Eager,
    Lazy(String),
}

pub trait Rollable {
    fn text(&self) -> String;
    fn value(&self) -> isize;
    fn max(&self) -> isize;
    fn min(&self) -> isize;
    fn dice(&self) -> Vec<(isize, isize)>;
    fn reroll(&self) -> Roll;
    fn kind(&self) -> RollKind;
}

#[derive(Clone, Debug)]
pub struct RollNumber {
    pub text: String,
    pub value: isize,
}

#[derive(Clone, Debug)]
pub struct RollDie {
    pub text: String,
    pub value: isize,
    pub max: isize,
    pub min: isize,
    pub dice: Vec<(isize, isize)>,
    pub reroll: Reroll,
}

#[derive(Clone, Debug)]
pub enum Roll {
    Number(RollNumber),
    Die(RollDie),
}

impl Rollable for Roll {
    fn text(&self) -> String {
        match self {
            Roll::Number(RollNumber { text, .. }) => text.to_owned(),
            Roll::Die(RollDie { text, .. }) => text.to_owned(),
        }
    }

    fn value(&self) -> isize {
        match self {
            Roll::Number(RollNumber { value, .. }) => *value,
            Roll::Die(RollDie { value, .. }) => *value,
        }
    }

    fn max(&self) -> isize {
        match self {
            Roll::Number(RollNumber { value, .. }) => *value,
            Roll::Die(RollDie { max, .. }) => *max,
        }
    }

    fn min(&self) -> isize {
        match self {
            Roll::Number(RollNumber { value, .. }) => *value,
            Roll::Die(RollDie { min, .. }) => *min,
        }
    }

    fn dice(&self) -> Vec<(isize, isize)> {
        match self {
            Roll::Number(_) => Vec::new(),
            Roll::Die(RollDie { dice, .. }) => dice.clone(),
        }
    }

    fn reroll(&self) -> Roll {
        match self {
            Roll::Number(_) => self.clone(),
            Roll::Die(RollDie { reroll, .. }) => reroll.run(),
        }
    }

    fn kind(&self) -> RollKind {
        match self {
            Roll::Number(_) => RollKind::Number,
            Roll::Die(_) => RollKind::Eager,
        }
    }
}

#[derive(Clone, Debug)]
pub struct Lazy {
    pub name: String,
    pub roll: Roll,
}

impl Rollable for Lazy {
    fn text(&self) -> String {
        self.roll.text()
    }

    fn value(&self) -> isize {
        self.roll.value()
    }

    fn max(&self) -> isize {
        self.roll.max()
    }

    fn min(&self) -> isize {
        self.roll.min()
    }

    fn dice(&self) -> Vec<(isize, isize)> {
        self.roll.dice()
    }

    fn reroll(&self) -> Roll {
        self.roll.reroll()
    }

    fn kind(&self) -> RollKind {
        RollKind::Lazy(self.name.clone())
    }
}

#[derive(Clone, Debug)]
pub struct Save {
    pub name: String,
    pub payload: String,
}

#[derive(Clone, Debug)]
pub struct Res {
    pub to_plot: Vec<Plot>,
    pub to_roll: Vec<Roll>,
    pub to_roll_lazy: Vec<Lazy>,
    pub to_save: Vec<Save>,
}

fn display_to_roll(x: Display, mut rng: StdRng) -> Vec<Roll> {
    match x {
        Display::Number(n) => vec![Roll::Number(RollNumber { text: n.to_string(), value: n })],
        Display::Die(d) => {
            let DieRes { value, repr, dice, .. } = d.value(&mut rng);
            let min = d.min();
            let max = d.max();
            vec![Roll::Die(RollDie {
                text: repr,
                value,
                min,
                max,
                dice,
                reroll: Reroll {
                    callback_fn: Arc::new(move || {
                        display_to_roll(Display::Die(d.clone()), rng.clone()).remove(0)
                    }),
                },
            })]
        }
        Display::List(l) => l.into_iter().flat_map(|x| display_to_roll(x, rng.clone())).collect(),
    }
}

fn avg(data: &[isize]) -> f64 {
    let sum = data.iter().sum::<isize>() as f64;
    let count = data.len();
    sum / count as f64
}

fn std(data: &[isize]) -> f64 {
    let avg = avg(data);
    let count = data.len();

    let variance = data
        .iter()
        .map(|value| {
            let diff = avg - (*value as f64);

            diff * diff
        })
        .sum::<f64>()
        / count as f64;

    variance.sqrt()
}

fn die_to_plot(d: Die) -> Plot {
    let pos = d.possibilities();
    let prob = counter_to_prob(pos.clone());
    let iter = counter_to_iter(pos).collect::<Vec<isize>>();
    let avg = avg(&iter);
    let std = std(&iter);
    Plot { text: d.repr(), prob, avg, std }
}

pub fn roll(text: String, init: Vec<(String, String)>, rng: &mut StdRng) -> Result<Res, String> {
    match interpret(text, init) {
        Err(err) => Err(err),
        Ok(Cmd { display, plot, lazy, save }) => {
            let to_roll =
                display.into_iter().flat_map(|x| display_to_roll(x, rng.clone())).collect();
            let to_plot = plot.into_iter().map(die_to_plot).collect();
            let to_roll_lazy = lazy
                .into_iter()
                .map(|(name, die)| {
                    let roll = display_to_roll(Display::Die(die), rng.clone()).remove(0);
                    Lazy { name, roll }
                })
                .collect();
            let to_save = save.into_iter().map(|(name, payload)| Save { name, payload }).collect();

            Ok(Res { to_roll, to_plot, to_roll_lazy, to_save })
        }
    }
}
