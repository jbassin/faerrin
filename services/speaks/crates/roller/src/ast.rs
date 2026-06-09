use crate::{die::Die, eval::Cmd, utils::res_to_disp};
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, fmt};

#[derive(Clone, Debug, Deserialize, Serialize)]
pub enum Atom {
    Number(isize),
    Ident(String),
    Sigil(String),
    Die(Die),
    List(Vec<Expr>),
    FuncCall(Box<Expr>, Vec<Expr>),
    Func(Option<String>, Vec<String>, Box<Expr>),
}

#[derive(Copy, Clone, Debug, Deserialize, Serialize)]
pub enum BinOpr {
    Add,
    Sub,
    Mul,
    Div,
    Semi,
    Dot,
}

impl BinOpr {
    pub fn modify(&self, lhs: isize, rhs: isize) -> isize {
        match self {
            Self::Add => lhs + rhs,
            Self::Sub => lhs - rhs,
            Self::Mul => lhs * rhs,
            Self::Div => lhs / rhs,
            Self::Semi => rhs,
            Self::Dot => lhs,
        }
    }
}

impl fmt::Display for BinOpr {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        match self {
            Self::Add => write!(f, "+"),
            Self::Sub => write!(f, "-"),
            Self::Mul => write!(f, "×"),
            Self::Div => write!(f, "÷"),
            Self::Semi => write!(f, ";"),
            Self::Dot => write!(f, "."),
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub enum UnOpr {
    Neg,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub enum Expr {
    Atom(Atom),
    UnOp(UnOpr, Box<Expr>),
    BinOp(Box<Expr>, BinOpr, Box<Expr>),
    Assign(String, Box<Expr>, Box<Expr>),
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub enum Res {
    Unit,
    Number(isize),
    Sigil(String),
    List(Vec<Res>),
    Die(Die),
    Func(Option<String>, Context, Vec<String>, Box<Expr>),
    Builtin(String),
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub enum Display {
    Number(isize),
    List(Vec<Display>),
    Die(Die),
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Context {
    env: HashMap<String, Res>,
}

impl Context {
    pub fn new(init: Vec<(String, String)>) -> Self {
        let init = init.into_iter().map(|(name, payload)| {
            let payload = serde_json::from_str(payload.as_str()).unwrap();
            (name, payload)
        });
        let builtins = vec![
            "d",
            "id",
            "take-highest",
            "take-lowest",
            "roll",
            "plot",
            "lazy-roll",
            "save",
            "max",
            "min",
        ]
        .into_iter()
        .map(|builtin: &str| (builtin.to_owned(), Res::Builtin(builtin.to_owned())));
        Self { env: init.chain(builtins).collect() }
    }

    pub fn prune(self, idents: Vec<String>) -> Self {
        Self { env: self.env.into_iter().filter(|(ident, _)| idents.contains(ident)).collect() }
    }

    pub fn combine(self, Self { env: rhs }: Self) -> Self {
        let mut env = self.env;
        for (key, value) in rhs.into_iter() {
            env.insert(key, value);
        }

        Self { env }
    }

    pub fn get(&self, key: String) -> Option<Res> {
        self.env.get(&key).cloned()
    }

    pub fn set(self, key: String, value: Res) -> Self {
        let mut env = self.env;
        env.insert(key, value);

        Self { env }
    }

    pub fn dispatch_builtin(
        self,
        func: String,
        args: Vec<Res>,
        cmd: &mut Cmd,
    ) -> Result<Res, String> {
        match func.as_str() {
            "id" => self.id(args),
            "d" => self.d(args),
            "take-highest" => self.take_highest(args),
            "take-lowest" => self.take_lowest(args),
            "roll" => self.roll(args, cmd),
            "plot" => self.plot(args, cmd),
            "lazy-roll" => self.lazy_roll(args, cmd),
            "save" => self.save(args, cmd),
            "max" => self.max(args),
            "min" => self.min(args),
            _ => Err("Builtin doesn't exist!".to_owned()),
        }
    }

    fn id(self, args: Vec<Res>) -> Result<Res, String> {
        if !args.is_empty() {
            return Ok(args[0].clone());
        }

        Err("Expected at least 1 argument".to_owned())
    }

    fn d(self, args: Vec<Res>) -> Result<Res, String> {
        if args.len() == 1 {
            return match args[0].clone() {
                Res::Number(n) => Ok(Res::Die(Die::from_base(1, n))),
                Res::List(l) => {
                    let l = l
                        .iter()
                        .map(|x| match x {
                            Res::Number(n) => Ok(*n),
                            _ => Err("Can only use list of numbers!".to_owned()),
                        })
                        .collect::<Result<Vec<_>, _>>()?;
                    Ok(Res::Die(Die::from_sequence(1, l)))
                }
                _ => Err("Can only make die from number or list of numbers".to_owned()),
            };
        }

        if args.len() == 2 {
            return match (args[0].clone(), args[1].clone()) {
                (Res::Number(count), Res::Number(base)) => {
                    if count < 1 {
                        return Err("Cannot have negative count".to_owned());
                    }

                    Ok(Res::Die(Die::from_base(count as usize, base)))
                }
                (Res::Number(count), Res::List(l)) => {
                    if count < 1 {
                        return Err("Cannot have negative count".to_owned());
                    }

                    let l = l
                        .iter()
                        .map(|x| match x {
                            Res::Number(n) => Ok(*n),
                            _ => Err("Can only use list of numbers!".to_owned()),
                        })
                        .collect::<Result<Vec<_>, _>>()?;
                    Ok(Res::Die(Die::from_sequence(count as usize, l)))
                }
                _ => Err("Can only make die from number or list of numbers".to_owned()),
            };
        }

        Err("Expected 1 or 2 arguments".to_owned())
    }

    fn roll(self, args: Vec<Res>, cmd: &mut Cmd) -> Result<Res, String> {
        args.into_iter().filter_map(res_to_disp).for_each(|x| cmd.add_display(x));

        Ok(Res::Unit)
    }

    fn plot(self, args: Vec<Res>, cmd: &mut Cmd) -> Result<Res, String> {
        args.into_iter().filter_map(res_to_disp).for_each(|x| {
            if let Display::Die(d) = x {
                cmd.add_plot(d)
            }
        });

        Ok(Res::Unit)
    }

    fn save(self, mut args: Vec<Res>, cmd: &mut Cmd) -> Result<Res, String> {
        if args.len() != 2 {
            return Err("Expected exactly 2 arguments!".to_owned());
        }

        let sigil = if let Res::Sigil(sigil) = args.remove(0) {
            sigil
        } else {
            return Err("First argument must be a sigil!".to_owned());
        };

        let payload = args.remove(0);
        cmd.add_save(sigil, serde_json::to_string(&payload).unwrap());

        Ok(Res::Unit)
    }

    fn take_highest(self, mut args: Vec<Res>) -> Result<Res, String> {
        if args.len() != 2 {
            return Err("Expected exactly 2 arguments".to_owned());
        }

        let collect = args.remove(0);
        let collect = if let Res::Number(n) = collect {
            if n < 1 {
                return Err("Collection count must be greater than 0".to_owned());
            }
            n as usize
        } else {
            return Err("First argument must be a number".to_owned());
        };

        let die = args.remove(0);
        if let Res::Die(die) = die {
            return Die::take_highest(collect, die).map(Res::Die);
        }

        Err("Second argument must be a die".to_owned())
    }

    fn max(self, args: Vec<Res>) -> Result<Res, String> {
        if args.is_empty() {
            return Err("Expected multiple arguments".to_owned());
        }

        let nums = args.into_iter().filter_map(|x| match x {
            Res::Number(n) => Some(n),
            _ => None,
        });

        match nums.max() {
            Some(n) => Ok(Res::Number(n)),
            None => Err("max() must be called on numbers".to_owned()),
        }
    }

    fn take_lowest(self, mut args: Vec<Res>) -> Result<Res, String> {
        if args.len() != 2 {
            return Err("Expected exactly 2 arguments".to_owned());
        }

        let collect = args.remove(0);
        let collect = if let Res::Number(n) = collect {
            if n < 1 {
                return Err("Collection count must be greater than 0".to_owned());
            }
            n as usize
        } else {
            return Err("First argument must be a number".to_owned());
        };

        let die = args.remove(0);
        if let Res::Die(die) = die {
            return Die::take_lowest(collect, die).map(Res::Die);
        }

        Err("Second argument must be a die".to_owned())
    }

    fn min(self, args: Vec<Res>) -> Result<Res, String> {
        if args.is_empty() {
            return Err("Expected multiple arguments".to_owned());
        }

        let nums = args.into_iter().filter_map(|x| match x {
            Res::Number(n) => Some(n),
            _ => None,
        });

        match nums.min() {
            Some(n) => Ok(Res::Number(n)),
            None => Err("max() must be called on numbers".to_owned()),
        }
    }

    fn lazy_roll(self, args: Vec<Res>, cmd: &mut Cmd) -> Result<Res, String> {
        args.into_iter().for_each(|x| {
            if let Res::List(mut l) = x {
                if l.len() <= 1 {
                    return;
                }

                let name = l.remove(0);
                let die = l.remove(0);

                if let (Res::Sigil(sigil), Res::Die(die)) = (name, die) {
                    cmd.add_lazy(sigil, die)
                }
            }
        });

        Ok(Res::Unit)
    }
}
