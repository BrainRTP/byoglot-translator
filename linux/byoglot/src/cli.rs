#[derive(PartialEq)]
pub enum Command {
    Activate,
    TranslateSelection,
    TranslateText(String),
    TranslateStdin,
    Help,
    Version,
}

pub fn parse(args: &[String]) -> Command {
    match args {
        [] => Command::Activate,
        [flag] if flag == "--translate-selection" => Command::TranslateSelection,
        [flag, value] if flag == "--text" && value == "-" => Command::TranslateStdin,
        [flag, value] if flag == "--text" => Command::TranslateText(value.clone()),
        [flag] if flag == "--version" => Command::Version,
        _ => Command::Help,
    }
}

impl std::fmt::Debug for Command {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Self::Activate => "Activate",
            Self::TranslateSelection => "TranslateSelection",
            Self::TranslateText(_) => "TranslateText([redacted])",
            Self::TranslateStdin => "TranslateStdin",
            Self::Help => "Help",
            Self::Version => "Version",
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn command(args: &[&str]) -> Command {
        parse(&args.iter().map(|a| (*a).into()).collect::<Vec<_>>())
    }
    #[test]
    fn no_arguments_activate() {
        assert_eq!(command(&[]), Command::Activate);
    }
    #[test]
    fn translate_selection_flag() {
        assert_eq!(
            command(&["--translate-selection"]),
            Command::TranslateSelection
        );
    }
    #[test]
    fn text_with_a_value() {
        assert_eq!(
            command(&["--text", "Hello"]),
            Command::TranslateText("Hello".into())
        );
    }
    #[test]
    fn text_dash_reads_stdin() {
        assert_eq!(command(&["--text", "-"]), Command::TranslateStdin);
    }
    #[test]
    fn text_without_a_value_is_help() {
        assert_eq!(command(&["--text"]), Command::Help);
    }
    #[test]
    fn unknown_flag_is_help() {
        for args in [
            &["--unknown"][..],
            &["--text", "Hello", "extra"],
            &["--translate-selection", "extra"],
            &["--help"],
        ] {
            assert_eq!(command(args), Command::Help);
        }
        assert_eq!(command(&["--version"]), Command::Version);
    }
}
