use crate::syncdie::SyncDie;
use color_eyre::Result;
use color_eyre::eyre::WrapErr;
use std::sync::{Arc, LazyLock, Mutex};
use uiua::format::FormatConfig;
use uiua::{Compiler, Uiua, UiuaError, UiuaErrorKind};

static FORMAT_CONFIG: LazyLock<FormatConfig> = LazyLock::new(|| {
    FormatConfig::default()
        .with_trailing_newline(false)
        .with_align_comments(true)
        .with_comment_space_after_hash(true)
});

pub(crate) fn format<T: AsRef<str>>(text: T) -> Result<String> {
    let text = text
        .as_ref()
        .trim_start_matches('`')
        .trim_end_matches('`')
        .trim_start_matches("elixir")
        .trim();

    let formatted = uiua::format::format_str(text, &FORMAT_CONFIG)?;
    Ok(formatted.output)
}

pub(crate) fn do_uiua<T: AsRef<str>>(text: T, db: Arc<Mutex<SyncDie>>) -> Result<(String, String)> {
    let text = format(text).wrap_err("Failed to format")?;

    let mut comp = Compiler::new();
    comp.load_str("~Dice {Name Rolls}")?;

    comp.create_bind_function("GetDice", (2, 1), move |uiua| {
        let base = uiua.pop_nat()?;
        let interval = uiua.pop_string()?;

        let mut sd = db.lock().unwrap();
        let res = sd
            .get_dice(base, interval)
            .map_err(|e| UiuaError::from(UiuaErrorKind::CompilerPanic(e.to_string())))?;

        let players = res.keys().map(|k| format!(r#""{k}""#)).collect::<Vec<_>>().join(" ");
        let rolls = res
            .values()
            .map(|v| {
                format!(r#"[{}]"#, v.iter().map(|n| format!("{n}")).collect::<Vec<_>>().join("_"))
            })
            .collect::<Vec<_>>()
            .join(" ");

        uiua.run_str(format!("~Dice {{Name Rolls}} \n Dice {{{players}}} [{rolls}]").as_str())?;
        Ok(())
    })?;

    comp.load_str(&text)?;
    let asm = comp.finish();

    let mut uiua = Uiua::with_safe_sys();
    uiua.run_asm(asm)?;

    let stack = uiua.take_stack();
    let res = stack.into_iter().map(|x| format!("{x}")).collect::<Vec<_>>().join("\n");

    Ok((text, res))
}
