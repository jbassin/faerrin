use crate::{
    ast::{Atom, BinOpr, Expr, UnOpr},
    die::Die,
    pratt_parser::{self, Pratt},
};
use nom::{
    AsChar, IResult, InputTakeAtPosition,
    branch::alt,
    bytes::complete::tag,
    character::complete::{alphanumeric1, char, multispace0, one_of},
    combinator::{fail, map, map_res, recognize, success},
    error::ErrorKind,
    multi::{many0, many0_count, many1, separated_list0},
    sequence::{delimited, pair, preceded, terminated},
};
use pipe_trait::*;
use std::panic;

pub type R<'a, T> = IResult<&'a str, T>;

fn ws<'a, F, O>(inner: F) -> impl FnMut(&'a str) -> R<O>
where
    F: 'a + FnMut(&'a str) -> R<O>,
{
    delimited(multispace0, inner, multispace0)
}

fn lower_alpha1<'a, T>(input: T) -> IResult<T, T>
where
    T: 'a + InputTakeAtPosition,
    <T as InputTakeAtPosition>::Item: AsChar,
{
    input.split_at_position1_complete(|item| !item.as_char().is_lowercase(), ErrorKind::Alpha)
}

fn optional<'a, F, O>(mut inner: F) -> impl FnMut(&'a str) -> R<Option<O>>
where
    F: 'a + FnMut(&'a str) -> R<O>,
{
    move |i| match inner(i) {
        Err(_) => Ok((i, None)),
        Ok((i, x)) => Ok((i, Some(x))),
    }
}

fn comma_list<'a, F, O: 'a + Clone>(
    left: char,
    inner: F,
    right: char,
) -> impl FnMut(&'a str) -> R<Vec<O>>
where
    F: 'a + FnMut(&'a str) -> R<O>,
{
    separated_list0(char(','), inner)
        .pipe(|x| terminated(x, char(',').pipe(optional)))
        .pipe(|x| delimited(char(left), x, char(right)))
        .pipe(ws)
}

fn raw_number(i: &'_ str) -> R<'_, isize> {
    terminated(one_of("0123456789"), char('_').pipe(many0))
        .pipe(many1)
        .pipe(|x| map(x, |x| x.iter().collect::<String>()))
        .pipe(|x| map_res(x, |x| str::parse(x.as_str())))(i)
}

fn number(i: &'_ str) -> R<'_, Atom> {
    raw_number.pipe(|x| map(x, Atom::Number)).pipe(ws)(i)
}

fn single_die(i: &'_ str) -> R<'_, Atom> {
    preceded(alt((char('d'), char('D'))), raw_number)
        .pipe(|x| map(x, |x| Atom::Die(Die::from_base(1, x))))(i)
}

fn multi_die(i: &'_ str) -> R<'_, Atom> {
    let (i, count) = raw_number(i)?;
    let (i, _) = alt((char('d'), char('D')))(i)?;
    let (i, base) = raw_number(i)?;

    if count < 1 {
        return fail(i);
    }

    Ok((i, Atom::Die(Die::from_base(count as usize, base))))
}

fn die(i: &'_ str) -> R<'_, Atom> {
    alt((single_die, multi_die)).pipe(ws)(i)
}

fn v_ident(i: &'_ str) -> R<'_, String> {
    let (i, ident) = pair(lower_alpha1, alt((alphanumeric1, tag("-"))).pipe(many0_count))
        .pipe(recognize)
        .pipe(ws)(i)?;

    if matches!(ident, "let" | "in") {
        return fail(i);
    }

    Ok((i, ident.to_owned()))
}

fn ident(i: &'_ str) -> R<'_, Atom> {
    v_ident.pipe(|x| map(x, Atom::Ident))(i)
}

fn sigil(i: &'_ str) -> R<'_, Atom> {
    let second = alt((alphanumeric1, tag("-"))).pipe(many0_count);
    pair(lower_alpha1, second)
        .pipe(recognize)
        .pipe(|x| preceded(char(':'), x))
        .pipe(|x| map(x, |x: &str| Atom::Sigil(x.to_owned())))
        .pipe(ws)(i)
}

fn list(i: &'_ str) -> R<'_, Atom> {
    comma_list('[', expr, ']').pipe(|x| map(x, Atom::List))(i)
}

fn func_call(i: &'_ str) -> R<'_, Atom> {
    let arg_list = comma_list('(', expr, ')');
    let collection = expr.pipe(|x| delimited(char('('), x, char(')'))).pipe(ws);
    let ident = ident.pipe(|x| map(x, Expr::Atom));

    alt((collection, ident))
        .pipe(|x| pair(x, arg_list))
        .pipe(|x| map(x, |(x, y)| Atom::FuncCall(Box::new(x), y)))
        .pipe(ws)(i)
}

fn anon_func(i: &'_ str) -> R<'_, Atom> {
    let (i, arg_list) = comma_list('|', v_ident, '|')(i)?;
    let (i, expr_) = expr.pipe(ws)(i)?;

    Ok((i, Atom::Func(None, arg_list, Box::new(expr_))))
}

fn atom(i: &'_ str) -> R<'_, Atom> {
    alt((anon_func, func_call, list, die, sigil, number, ident))(i)
}

fn bin_opr(i: &'_ str) -> R<'_, BinOpr> {
    let add = success(BinOpr::Add).pipe(move |op| preceded(tag("+"), op));
    let sub = success(BinOpr::Sub).pipe(move |op| preceded(tag("-"), op));
    let mul = success(BinOpr::Mul).pipe(move |op| preceded(tag("*"), op));
    let div = success(BinOpr::Div).pipe(move |op| preceded(tag("/"), op));
    let semi = success(BinOpr::Semi).pipe(move |op| preceded(tag(";"), op));
    let dot = success(BinOpr::Dot).pipe(move |op| preceded(tag("."), op));
    alt((add, sub, mul, div, semi, dot)).pipe(ws)(i)
}

fn un_opr(i: &'_ str) -> R<'_, UnOpr> {
    let neg = success(UnOpr::Neg).pipe(move |op| preceded(tag("-"), op));
    let neg1 = success(UnOpr::Neg).pipe(move |op| preceded(tag("-"), op));
    alt((neg, neg1)).pipe(ws)(i)
}

fn assign(i: &'_ str) -> R<'_, Expr> {
    let (i, _) = tag("let").pipe(ws)(i)?;
    let (i, ident) = v_ident(i)?;
    let (i, _) = char('=').pipe(ws)(i)?;
    let (i, expr_) = expr.pipe(ws)(i)?;
    let (i, _) = tag("in").pipe(ws)(i)?;
    let (i, block) = expr.pipe(ws)(i)?;

    Ok((i, Expr::Assign(ident, Box::new(expr_), Box::new(block))))
}

fn func(i: &'_ str) -> R<'_, Expr> {
    let (i, _) = tag("let").pipe(ws)(i)?;
    let (i, ident) = v_ident.pipe(ws)(i)?;
    let (i, arg_list) = comma_list('(', v_ident, ')')(i)?;
    let (i, _) = char('=').pipe(ws)(i)?;
    let (i, expr_) = expr.pipe(ws)(i)?;
    let (i, _) = tag("in").pipe(ws)(i)?;
    let (i, block) = expr.pipe(ws)(i)?;

    Ok((
        i,
        Expr::Assign(
            ident.clone(),
            Box::new(Expr::Atom(Atom::Func(Some(ident), arg_list, Box::new(expr_)))),
            Box::new(block),
        ),
    ))
}

fn expr_v(i: &'_ str) -> R<'_, Vec<Pratt>> {
    let (i, prefix) = un_opr.pipe(ws).pipe(optional)(i)?;
    let prefix = prefix.map(Pratt::Prefix);

    let atom = atom.pipe(|x| map(x, Pratt::Atom)).pipe(ws);
    let collection = expr.pipe(|x| delimited(char('('), x, char(')'))).pipe(ws);
    let group = alt((func, assign, collection)).pipe(|x| map(x, Pratt::Group)).pipe(ws);

    let (i, val) = alt((group, atom))(i)?;
    let val = Some(val);

    let (i, infix) = bin_opr.pipe(ws).pipe(optional)(i)?;
    let infix = infix.map(Pratt::Infix);

    let vals = vec![prefix, val, infix].into_iter().flatten().collect();

    let (i, rest) = expr_v.pipe(ws).pipe(optional)(i)?;
    let rest = rest.unwrap_or_default();

    Ok((i, [vals, rest].concat()))
}

fn expr(i: &'_ str) -> R<'_, Expr> {
    let (i, pratt) = expr_v.pipe(ws)(i)?;
    match pratt_parser::parse(pratt) {
        Ok(expr) => Ok((i, expr)),
        Err(_) => unreachable!(),
    }
}

pub fn parse(i: String) -> Option<Expr> {
    let res = panic::catch_unwind(|| expr(i.as_str()));

    match res {
        Err(_) => None,
        Ok(Ok(("", expr))) => Some(expr),
        Ok(..) => None,
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use expect_test::{Expect, expect};
    use std::fmt;

    fn check<T: fmt::Debug + serde::Serialize>(actual: R<T>, expect: Expect) {
        let actual = match actual {
            Err(err) => format!("{:?}", err),
            Ok((_, actual)) => serde_lexpr::to_string(&actual).unwrap(),
        };
        expect.assert_eq(&actual);
    }

    #[test]
    fn test_empty() {
        check(Ok(("", "")), expect![[r#""""#]]);
    }

    #[test]
    fn test_atom() {
        check(atom("55"), expect![["(Number . 55)"]]);
        check(atom("1_000_000"), expect![["(Number . 1000000)"]]);
        check(atom("hello"), expect![[r#"(Ident . "hello")"#]]);
        check(atom("Hiya"), expect![[r#"Error(Error { input: "Hiya", code: Alpha })"#]]);
        check(atom("get-best"), expect![[r#"(Ident . "get-best")"#]]);
        check(
            atom("_testerman"),
            expect![[r#"Error(Error { input: "_testerman", code: Alpha })"#]],
        );
        check(atom(":sigil"), expect![[r#"(Sigil . "sigil")"#]]);
        check(atom("d20"), expect!["(Die Base 1 20)"]);
        check(atom("8d6"), expect!["(Die Base 8 6)"]);
        check(
            atom("[1,2,3,4,]"),
            expect![[
                "(List (Atom Number . 1) (Atom Number . 2) (Atom Number . 3) (Atom Number . 4))"
            ]],
        );
        check(
            atom("run(1, :test)"),
            expect![[
                r#"(FuncCall (Atom Ident . "run") ((Atom Number . 1) (Atom Sigil . "test")))"#
            ]],
        );
        check(
            atom("|first, second,| first + second"),
            expect![[
                r#"(Func () ("first" "second") (BinOp (Atom Ident . "first") Add (Atom Ident . "second")))"#
            ]],
        );
    }

    #[test]
    fn test_expr() {
        check(expr("55"), expect!["(Atom Number . 55)"]);

        check(
            expr("55 + -35 * 12"),
            expect![
                "(BinOp (Atom Number . 55) Add (BinOp (UnOp Neg (Atom Number . 35)) Mul (Atom Number . 12)))"
            ],
        );

        check(
            expr("(55 + -35) * 12"),
            expect![
                "(BinOp (BinOp (Atom Number . 55) Add (UnOp Neg (Atom Number . 35))) Mul (Atom Number . 12))"
            ],
        );
    }

    #[test]
    fn test_block() {
        check(
            expr(
                r#"
                let x = 4 in
                let y = 6 in
                x + y
            "#,
            ),
            expect![[
                r#"(Assign "x" (Atom Number . 4) (Assign "y" (Atom Number . 6) (BinOp (Atom Ident . "x") Add (Atom Ident . "y"))))"#
            ]],
        );

        check(
            expr(
                r#"
                let x =
                    let a = 4 * 6 in
                    let b = 22 in
                    a * b
                in
                let y = 6 in
                x + y
            "#,
            ),
            expect![[
                r#"(Assign "x" (Assign "a" (BinOp (Atom Number . 4) Mul (Atom Number . 6)) (Assign "b" (Atom Number . 22) (BinOp (Atom Ident . "a") Mul (Atom Ident . "b")))) (Assign "y" (Atom Number . 6) (BinOp (Atom Ident . "x") Add (Atom Ident . "y"))))"#
            ]],
        );

        check(
            expr(
                r#"
                let x =
                    (let a = 4 * 6 in
                    let b = 22 in
                    a * b)
                in
                let y = 6 in
                x + y
            "#,
            ),
            expect![[
                r#"(Assign "x" (Assign "a" (BinOp (Atom Number . 4) Mul (Atom Number . 6)) (Assign "b" (Atom Number . 22) (BinOp (Atom Ident . "a") Mul (Atom Ident . "b")))) (Assign "y" (Atom Number . 6) (BinOp (Atom Ident . "x") Add (Atom Ident . "y"))))"#
            ]],
        );

        check(
            expr(
                r#"
                let test-func(first, second,) =
                    let a = first + second in
                    let b = first - second in
                    a * b
                in
                test-func(1, [1, 2, 3])
            "#,
            ),
            expect![[
                r#"(Assign "test-func" (Atom Func ("test-func") ("first" "second") (Assign "a" (BinOp (Atom Ident . "first") Add (Atom Ident . "second")) (Assign "b" (BinOp (Atom Ident . "first") Sub (Atom Ident . "second")) (BinOp (Atom Ident . "a") Mul (Atom Ident . "b"))))) (Atom FuncCall (Atom Ident . "test-func") ((Atom Number . 1) (Atom List (Atom Number . 1) (Atom Number . 2) (Atom Number . 3)))))"#
            ]],
        );

        check(
            expr(
                r#"
                let test-func = |first, second|
                    let a = first + second in
                    let b = first - second in
                    a * b
                in
                test-func(1, [1, 2, 3])
            "#,
            ),
            expect![[
                r#"(Assign "test-func" (Atom Func () ("first" "second") (Assign "a" (BinOp (Atom Ident . "first") Add (Atom Ident . "second")) (Assign "b" (BinOp (Atom Ident . "first") Sub (Atom Ident . "second")) (BinOp (Atom Ident . "a") Mul (Atom Ident . "b"))))) (Atom FuncCall (Atom Ident . "test-func") ((Atom Number . 1) (Atom List (Atom Number . 1) (Atom Number . 2) (Atom Number . 3)))))"#
            ]],
        );
    }
}
