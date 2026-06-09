use crate::{
    ast::{Atom, BinOpr, Context, Display, Expr, Res, UnOpr},
    die::Die,
    parser::parse,
    utils::res_to_disp,
};
use serde::Serialize;
use std::vec;

#[derive(Clone, Debug, Serialize)]
pub struct Cmd {
    pub display: Vec<Display>,
    pub plot: Vec<Die>,
    pub lazy: Vec<(String, Die)>,
    pub save: Vec<(String, String)>,
}

impl Cmd {
    pub fn new() -> Self {
        Self { display: vec![], plot: vec![], lazy: vec![], save: vec![] }
    }

    pub fn add_display(&mut self, d: Display) {
        self.display.push(d)
    }

    pub fn add_plot(&mut self, d: Die) {
        self.plot.push(d)
    }

    pub fn add_lazy(&mut self, name: String, die: Die) {
        self.lazy.push((name, die))
    }

    pub fn add_save(&mut self, name: String, payload: String) {
        self.save.push((name, payload))
    }
}

fn mod_bin_op(lhs: Res, bin_opr: BinOpr, rhs: Res) -> Result<Res, String> {
    if let BinOpr::Semi = bin_opr {
        return Ok(rhs);
    }

    match (lhs, rhs) {
        (Res::Number(lhs), Res::Number(rhs)) => Ok(Res::Number(bin_opr.modify(lhs, rhs))),
        (Res::List(lhs), rhs) => lhs
            .iter()
            .map(|lhs| mod_bin_op(lhs.clone(), bin_opr, rhs.clone()))
            .collect::<Result<Vec<_>, _>>()
            .map(Res::List),
        (lhs, Res::List(rhs)) => rhs
            .iter()
            .map(|rhs| mod_bin_op(lhs.clone(), bin_opr, rhs.clone()))
            .collect::<Result<Vec<_>, _>>()
            .map(Res::List),
        (Res::Die(lhs), Res::Die(rhs)) => Ok(Res::Die(Die::from_bin_op(lhs, bin_opr, rhs))),
        (Res::Die(lhs), Res::Number(rhs)) => {
            Ok(Res::Die(Die::from_bin_op(lhs, bin_opr, Die::from_const(rhs))))
        }
        (Res::Number(lhs), Res::Die(rhs)) => {
            Ok(Res::Die(Die::from_bin_op(Die::from_const(lhs), bin_opr, rhs)))
        }
        (lhs, rhs) => Err(format!("Cannot apply operation: {lhs:?} {bin_opr:?} {rhs:?}")),
    }
}

fn neg_un_op(res: Res) -> Result<Res, String> {
    match res {
        Res::Number(n) => Ok(Res::Number(-n)),
        Res::Sigil(s) => Err(format!("Cannot negate a sigil: {s:?}")),
        Res::Func(..) | Res::Builtin(..) => Err("Cannot negate a function".to_owned()),
        Res::Die(..) => Err("Cannot negate a die".to_owned()),
        Res::Unit => Err("Cannot negate the unit element".to_owned()),
        Res::List(l) => l.into_iter().map(neg_un_op).collect::<Result<Vec<_>, _>>().map(Res::List),
    }
}

fn eval(expr: Expr, ctx: Context, cmd: &mut Cmd) -> Result<Res, String> {
    match expr {
        Expr::Atom(Atom::Number(n)) => Ok(Res::Number(n)),
        Expr::Atom(Atom::Die(d)) => Ok(Res::Die(d)),
        Expr::Atom(Atom::Ident(ident)) => match ctx.get(ident.clone()) {
            Some(res) => Ok(res),
            None => Err(format!("Can't find given variable in context {ident:?}")),
        },
        Expr::Atom(Atom::Sigil(s)) => Ok(Res::Sigil(s)),
        Expr::Atom(Atom::List(l)) => l
            .into_iter()
            .map(|l| eval(l, ctx.clone(), cmd))
            .collect::<Result<Vec<Res>, _>>()
            .map(Res::List),
        Expr::Atom(Atom::Func(ident, params, body)) => {
            let mut decl_idents = params.clone();
            if let Some(name) = &ident {
                decl_idents.push(name.clone());
            }

            let captured_idents = captured_idents(&body, decl_idents);
            Ok(Res::Func(ident, ctx.prune(captured_idents), params, body))
        }
        Expr::Atom(Atom::FuncCall(expr, args)) => {
            let func = eval(*expr, ctx.clone(), cmd)?;

            match func {
                Res::Builtin(ident) => {
                    let args = args
                        .into_iter()
                        .map(|x| eval(x, ctx.clone(), cmd))
                        .collect::<Result<Vec<_>, _>>()?;

                    ctx.dispatch_builtin(ident, args, cmd)
                }
                Res::Func(name, closure, params, body) => {
                    let args = args
                        .into_iter()
                        .map(|x| eval(x, ctx.clone(), cmd))
                        .collect::<Result<Vec<_>, _>>()?;

                    let ctx = ctx.combine(closure.clone());

                    let ctx = if let Some(name) = name {
                        ctx.set(
                            name.clone(),
                            Res::Func(Some(name), closure, params.clone(), body.clone()),
                        )
                    } else {
                        ctx
                    };

                    let ctx = params
                        .into_iter()
                        .zip(args)
                        .fold(ctx, |ctx, (param, arg)| ctx.set(param, arg));

                    eval(*body, ctx, cmd)
                }
                x => Err(format!("Called variable isn't a function {x:?}")),
            }
        }
        Expr::UnOp(UnOpr::Neg, expr) => neg_un_op(eval(*expr, ctx, cmd)?),
        Expr::BinOp(lhs, bin_opr, rhs) => match (bin_opr, rhs) {
            (BinOpr::Dot, box Expr::Atom(Atom::FuncCall(expr, args))) => {
                let mut args = args;
                args.insert(0, *lhs);
                eval(Expr::Atom(Atom::FuncCall(expr, args)), ctx, cmd)
            }
            (BinOpr::Dot, rhs) => {
                Err(format!("Right hand side of dot expression must be function call {rhs:?}"))
            }
            (bin_opr, rhs) => {
                mod_bin_op(eval(*lhs, ctx.clone(), cmd)?, bin_opr, eval(*rhs, ctx, cmd)?)
            }
        },
        Expr::Assign(ident, value, next_) => {
            let value = eval(*value, ctx.clone(), cmd)?;
            let ctx = ctx.set(ident, value);
            eval(*next_, ctx, cmd)
        }
    }
}

fn captured_idents(expr: &Expr, decl_idents: Vec<String>) -> Vec<String> {
    match expr {
        Expr::Atom(Atom::Number(_) | Atom::Die(_) | Atom::Sigil(_)) => vec![],
        Expr::Atom(Atom::Ident(ident)) => {
            if decl_idents.contains(ident) {
                vec![]
            } else {
                vec![ident.clone()]
            }
        }
        Expr::Atom(Atom::List(l)) => {
            l.iter().flat_map(|expr| captured_idents(expr, decl_idents.clone())).collect()
        }
        Expr::Atom(Atom::Func(ident, params, body)) => {
            let mut decl_idents = decl_idents;
            if let Some(name) = ident {
                decl_idents.push(name.clone());
            }
            for param in params.iter() {
                decl_idents.push(param.clone());
            }
            captured_idents(body, decl_idents)
        }
        Expr::Atom(Atom::FuncCall(expr, args)) => args
            .iter()
            .flat_map(|expr| captured_idents(expr, decl_idents.clone()))
            .chain(captured_idents(expr, decl_idents.clone()))
            .collect(),
        Expr::UnOp(_, expr) => captured_idents(expr, decl_idents),
        Expr::BinOp(lhs, _, rhs) => {
            let lhs = captured_idents(lhs, decl_idents.clone());
            let rhs = captured_idents(rhs, decl_idents);
            lhs.into_iter().chain(rhs).collect()
        }
        Expr::Assign(ident, value, next_) => {
            let mut decl_idents = decl_idents;
            let mut idents = captured_idents(value, decl_idents.clone());
            decl_idents.push(ident.clone());
            idents.extend::<Vec<String>>(captured_idents(next_, decl_idents));
            idents
        }
    }
}

pub fn interpret(i: String, init: Vec<(String, String)>) -> Result<Cmd, String> {
    let mut cmd = Cmd::new();
    match parse(i) {
        None => Err("Parsing error".to_owned()),
        Some(expr) => match eval(expr, Context::new(init), &mut cmd) {
            Err(e) => Err(e),
            Ok(res) => match res_to_disp(res) {
                None => Ok(cmd),
                Some(r) => {
                    cmd.add_display(r);
                    Ok(cmd)
                }
            },
        },
    }
}

#[cfg(test)]
mod test {
    use super::interpret;
    use expect_test::{Expect, expect};

    fn check(actual: &'static str, expect: Expect) {
        let actual = format!("{:?}", interpret(actual.to_owned(), vec![]));
        expect.assert_eq(&actual);
    }

    #[test]
    fn test_atom() {
        check("55", expect!["Ok(Cmd { display: [Number(55)], plot: [], lazy: [], save: [] })"]);
        check(
            "1_000_000",
            expect!["Ok(Cmd { display: [Number(1000000)], plot: [], lazy: [], save: [] })"],
        );
        check("hello", expect![[r#"Err("Can't find given variable in context \"hello\"")"#]]);
        check("Hiya", expect![[r#"Err("Parsing error")"#]]);
        check("get-best", expect![[r#"Err("Can't find given variable in context \"get-best\"")"#]]);
        check("_testerman", expect![[r#"Err("Parsing error")"#]]);
        check(":sigil", expect!["Ok(Cmd { display: [], plot: [], lazy: [], save: [] })"]);
        check(
            "[1,2,3,4,]",
            expect![
                "Ok(Cmd { display: [List([Number(1), Number(2), Number(3), Number(4)])], plot: [], lazy: [], save: [] })"
            ],
        );
        check("run(1, :test)", expect![[r#"Err("Can't find given variable in context \"run\"")"#]]);
        check(
            "|first, second,| first + second",
            expect!["Ok(Cmd { display: [], plot: [], lazy: [], save: [] })"],
        );
    }

    #[test]
    fn test_expr() {
        check("55", expect!["Ok(Cmd { display: [Number(55)], plot: [], lazy: [], save: [] })"]);

        check(
            "55 + -35 * 12",
            expect!["Ok(Cmd { display: [Number(-365)], plot: [], lazy: [], save: [] })"],
        );

        check(
            "(55 + -35) * 12",
            expect!["Ok(Cmd { display: [Number(240)], plot: [], lazy: [], save: [] })"],
        );
    }

    #[test]
    fn test_block() {
        check(
            r#"
                let x = 4 in
                let y = 6 in
                x + y
            "#,
            expect!["Ok(Cmd { display: [Number(10)], plot: [], lazy: [], save: [] })"],
        );

        check(
            r#"
                let x =
                    let a = 4 * 6 in
                    let b = 22 in
                    a * b
                in
                let y = 6 in
                x + y
            "#,
            expect!["Ok(Cmd { display: [Number(534)], plot: [], lazy: [], save: [] })"],
        );

        check(
            r#"
                let x =
                    (let a = 4 * 6 in
                    let b = 22 in
                    a * b)
                in
                let y = 6 in
                x + y
            "#,
            expect!["Ok(Cmd { display: [Number(534)], plot: [], lazy: [], save: [] })"],
        );

        check(
            r#"
                let test-func(first, second,) =
                    let a = first + second in
                    let b = first - second in
                    a * b
                in
                test-func(1, [1, 2, 3])
            "#,
            expect![
                "Ok(Cmd { display: [List([List([Number(0), Number(-2), Number(-4)]), List([Number(0), Number(-3), Number(-6)]), List([Number(0), Number(-4), Number(-8)])])], plot: [], lazy: [], save: [] })"
            ],
        );

        check(
            r#"
                let test-func = |first, second|
                    let a = first + second in
                    let b = first - second in
                    a * b
                in
                test-func(1, [1, 2, 3])
            "#,
            expect![
                "Ok(Cmd { display: [List([List([Number(0), Number(-2), Number(-4)]), List([Number(0), Number(-3), Number(-6)]), List([Number(0), Number(-4), Number(-8)])])], plot: [], lazy: [], save: [] })"
            ],
        );
    }

    #[test]
    fn test_builtin() {
        check("id(1)", expect!["Ok(Cmd { display: [Number(1)], plot: [], lazy: [], save: [] })"]);
        check("id()", expect![[r#"Err("Expected at least 1 argument")"#]]);
        check(
            "id(1, 2, 3)",
            expect!["Ok(Cmd { display: [Number(1)], plot: [], lazy: [], save: [] })"],
        );
    }
}
