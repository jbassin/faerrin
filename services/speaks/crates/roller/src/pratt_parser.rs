use crate::ast::{Atom, BinOpr, Expr, UnOpr};
use pratt::{Affix, Associativity, PrattParser, Precedence, Result};

#[derive(Clone, Debug)]
pub enum Pratt {
    Prefix(UnOpr),
    Infix(BinOpr),
    Atom(Atom),
    Group(Expr),
}

struct PrattParseImpl;

impl<I> PrattParser<I> for PrattParseImpl
where
    I: Iterator<Item = Pratt>,
{
    type Error = pratt::NoError;
    type Input = Pratt;
    type Output = Expr;

    fn query(&mut self, tree: &Pratt) -> Result<Affix> {
        let affix = match tree {
            Pratt::Prefix(UnOpr::Neg) => Affix::Prefix(Precedence(6)),
            Pratt::Infix(BinOpr::Semi) => Affix::Infix(Precedence(1), Associativity::Left),
            Pratt::Infix(BinOpr::Dot) => Affix::Infix(Precedence(5), Associativity::Right),
            Pratt::Infix(BinOpr::Add | BinOpr::Sub) => {
                Affix::Infix(Precedence(3), Associativity::Left)
            }
            Pratt::Infix(BinOpr::Mul | BinOpr::Div) => {
                Affix::Infix(Precedence(4), Associativity::Left)
            }
            Pratt::Atom(_) => Affix::Nilfix,
            Pratt::Group(_) => Affix::Nilfix,
        };
        Ok(affix)
    }

    fn primary(&mut self, tree: Pratt) -> Result<Expr> {
        let expr = match tree {
            Pratt::Atom(atom) => Expr::Atom(atom),
            Pratt::Group(expr) => expr,
            Pratt::Prefix(_) | Pratt::Infix(_) => unreachable!(),
        };
        Ok(expr)
    }

    fn infix(&mut self, lhs: Expr, tree: Pratt, rhs: Expr) -> Result<Expr> {
        let op = match tree {
            Pratt::Infix(opr) => opr,
            Pratt::Atom(_) | Pratt::Group(_) | Pratt::Prefix(_) => unreachable!(),
        };
        Ok(Expr::BinOp(Box::new(lhs), op, Box::new(rhs)))
    }

    fn prefix(&mut self, tree: Pratt, rhs: Expr) -> Result<Expr> {
        let op = match tree {
            Pratt::Prefix(opr) => opr,
            Pratt::Atom(_) | Pratt::Group(_) | Pratt::Infix(_) => unreachable!(),
        };
        Ok(Expr::UnOp(op, Box::new(rhs)))
    }

    fn postfix(&mut self, _lhs: Expr, _tree: Pratt) -> Result<Expr> {
        unreachable!()
    }
}

pub fn parse(p: Vec<Pratt>) -> std::result::Result<Expr, pratt::PrattError<Pratt, pratt::NoError>> {
    PrattParseImpl.parse(&mut p.into_iter())
}
