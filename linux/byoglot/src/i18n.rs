macro_rules! messages {
    ($($id:ident => ($en:literal, $ru:literal)),+ $(,)?) => {
        #[derive(Clone, Copy, Debug)]
        pub enum Msg { $($id),+ }
        impl Msg { pub const ALL: &'static [Self] = &[$(Self::$id),+]; }
        pub fn text(msg: Msg, russian: bool) -> &'static str {
            match (msg, russian) { $((Msg::$id, false) => $en, (Msg::$id, true) => $ru),+ }
        }
    };
}
messages! {
    Translate => ("Translate", "Перевод"),
    Templates => ("Templates", "Шаблоны"),
    Connections => ("Connections", "Подключения"),
    Preferences => ("Preferences", "Настройки"),
    KeyboardShortcuts => ("Keyboard Shortcuts", "Сочетания клавиш"),
    About => ("About ByoGlot", "О ByoGlot"),
    Quit => ("Quit", "Выйти"),
    Paste => ("Paste", "Вставить"),
    Copy => ("Copy", "Копировать"),
    Cancel => ("Cancel", "Отмена"),
    Save => ("Save", "Сохранить"),
    Delete => ("Delete", "Удалить"),
    Edit => ("Edit", "Изменить"),
    Duplicate => ("Duplicate", "Создать копию"),
    AddConnection => ("Add Connection", "Добавить подключение"),
    EditConnection => ("Edit Connection", "Изменить подключение"),
    AddTemplate => ("Add Template", "Добавить шаблон"),
    EditTemplate => ("Edit Template", "Изменить шаблон"),
    SourceLanguage => ("Source language", "Исходный язык"),
    TargetLanguage => ("Target language", "Язык перевода"),
    Auto => ("Detect automatically", "Определять автоматически"),
    UseDefault => ("Use default", "По умолчанию"),
    Template => ("Template", "Шаблон"),
    Builtin => ("Built-in", "Встроенный"),
    Name => ("Name", "Название"),
    Instructions => ("Instructions", "Инструкции"),
    Preset => ("Provider", "Провайдер"),
    Custom => ("Custom", "Другой"),
    BaseUrl => ("Base URL", "Базовый URL"),
    ApiKey => ("API key", "API-ключ"),
    ApiKeyKeep => ("API key (leave empty to keep it)", "API-ключ (оставьте пустым для сохранения)"),
    ConsentRequired => ("Confirm the destination before saving.", "Подтвердите адрес перед сохранением."),
    Consent => ("Text I translate and my instructions are sent to {}.", "Переводимый текст и мои инструкции отправляются на {}."),
    InvalidUrl => ("Enter a valid HTTPS URL, or HTTP for a local network host.", "Введите корректный HTTPS URL или HTTP для узла локальной сети."),
    Active => ("Active", "Активно"),
    MakeActive => ("Use this connection", "Использовать подключение"),
    KeyMissing => ("Key missing", "Нет ключа"),
    Models => ("Models", "Модели"),
    PageModel => ("Page model", "Модель для страниц"),
    TextModel => ("Text model", "Модель для текста"),
    Effort => ("Reasoning effort", "Уровень рассуждения"),
    EffortNone => ("No reasoning", "Без рассуждения"),
    EffortLow => ("Low", "Низкий"),
    EffortMedium => ("Medium", "Средний"),
    EffortHigh => ("High", "Высокий"),
    RefreshModels => ("Refresh models", "Обновить модели"),
    NoModels => ("No models are available from this provider.", "Провайдер не вернул доступных моделей."),
    FixConnection => ("Open Connections", "Открыть подключения"),
    Input => ("Text to translate", "Текст для перевода"),
    Result => ("Translation", "Перевод"),
    InputLimit => ("Up to {} UTF-16 units", "До {} единиц UTF-16"),
    NoConnections => ("Add a provider to start translating.", "Добавьте провайдера для перевода."),
    DeleteTemplate => ("Delete this template?", "Удалить этот шаблон?"),
    DeleteConnection => ("Delete this connection?", "Удалить это подключение?"),
    DeleteExplanation => ("This removes your saved settings for it.", "Сохраненные настройки будут удалены."),
    NameRequired => ("Enter a name.", "Введите название."),
    CopyName => ("{} copy", "{} (копия)"),
    LanguageStyle => ("Language style", "Стиль языка"),
    LanguagePrompt => ("Use language style instructions", "Использовать инструкции для стиля языка"),
    LanguageProfile => ("Language profile", "Языковой профиль"),
    Generic => ("General", "Общий"),
    ProfileText => ("Profile instructions", "Инструкции профиля"),
    ResetProfile => ("Reset profile", "Сбросить профиль"),
    ProfileLimit => ("The profile is longer than {} characters.", "Профиль длиннее {} символов."),
    Startup => ("Startup", "Запуск"),
    StartBackground => ("Start in the background at login", "Запускать в фоне при входе"),
    StartupReason => ("Keep ByoGlot ready when you log in.", "Подготовить ByoGlot к работе при входе в систему."),
    PortalUnavailable => ("The desktop could not apply this preference.", "Рабочий стол не смог применить эту настройку."),
    QuickHint => ("Select text and press the shortcut again, or paste it here.", "Выделите текст и нажмите сочетание еще раз или вставьте его здесь."),
    OpenMain => ("Open in ByoGlot", "Открыть в ByoGlot"),
    ShortcutDescription => ("Translate the selected text", "Перевести выделенный текст"),
    ShortcutFallback => ("Bind this command to a key in your desktop's keyboard settings: {}", "Назначьте этой команде сочетание клавиш в настройках рабочего стола: {}"),
    ShortcutBinding => ("Requesting a shortcut from the desktop...", "Запрос сочетания клавиш у рабочего стола..."),
    ShortcutChange => ("Change...", "Изменить..."),
    CliHelp => ("Usage: byoglot [--translate-selection | --text TEXT | --text - | --help | --version]\nWith no options, open the main window. Use --text - to read standard input.", "Использование: byoglot [--translate-selection | --text TEXT | --text - | --help | --version]\nБез параметров открывается главное окно. Параметр --text - читает стандартный ввод."),
    StdinError => ("Standard input could not be read as UTF-8 text.", "Не удалось прочитать стандартный ввод как текст UTF-8."),
    WindowShortcuts => ("Ctrl+V: Paste. Ctrl+C: Copy selected text. Tab: Move focus.", "Ctrl+V: вставить. Ctrl+C: копировать выделенный текст. Tab: переместить фокус."),
    PortableSettings => ("Portable settings", "Перенос настроек"),
    Export => ("Export", "Экспорт"),
    Import => ("Import", "Импорт"),
    ExportHint => ("Exports contain settings only. API keys and translated text are never included.", "Экспорт содержит только настройки. API-ключи и переводимый текст в него не входят."),
    FileError => ("The file could not be read or written.", "Не удалось прочитать или записать файл."),
    ImportError => ("This is not a supported ByoGlot settings export.", "Этот файл не является поддерживаемым экспортом настроек ByoGlot."),
    Imported => ("Settings imported. Add API keys in Connections.", "Настройки импортированы. Добавьте API-ключи в подключениях."),
    Exported => ("Settings exported.", "Настройки экспортированы."),
    Saved => ("Saved", "Сохранено"),
    NoKeyring => ("No keyring is available. The API key is kept until ByoGlot quits.", "Связка ключей недоступна. API-ключ хранится до выхода из ByoGlot."),
    ErrNoConnection => ("Add a provider first.", "Сначала добавьте провайдера."),
    ErrNoModel => ("Choose a model.", "Выберите модель."),
    ErrKeyMissing => ("The API key for this provider is missing.", "Для этого провайдера не задан API-ключ."),
    ErrConsent => ("Confirm that text may be sent to {}.", "Подтвердите отправку текста на {}."),
    ErrTooLong => ("The text is longer than {} characters.", "Текст длиннее {} символов."),
    ErrEmpty => ("There is no text to translate.", "Нет текста для перевода."),
    ErrStorage => ("Settings or API keys could not be accessed. Check storage and keyring permissions.", "Не удалось получить доступ к настройкам или API-ключам. Проверьте права доступа к файлам и связке ключей."),
    NotSelected => ("Not selected", "Не выбрано"),
    ErrOffline => ("The provider did not answer. Check the connection.", "Провайдер не ответил. Проверьте соединение."),
    ErrAuth => ("The provider rejected the API key (HTTP {}).", "Провайдер отклонил API-ключ (HTTP {})."),
    ErrRateLimit => ("The provider limit is reached. Try again later.", "Достигнут лимит провайдера. Повторите позже."),
    ErrProvider => ("The provider returned an error: {}", "Провайдер вернул ошибку: {}"),
    ErrBadResponse => ("The provider returned an invalid response.", "Провайдер вернул некорректный ответ."),
    ErrIncompatible => ("This provider does not support the required API.", "Провайдер не поддерживает необходимый API."),
    ErrAborted => ("Translation cancelled.", "Перевод отменен."),
    ProviderFailure => ("Request failed", "Запрос не выполнен"),
    AboutDescription => ("Translate with your own AI providers.", "Переводите с помощью своих ИИ-провайдеров."),
    Menu => ("Main menu", "Главное меню"),
    Close => ("Close", "Закрыть"),
    Confirm => ("Confirm", "Подтвердить"),
}

pub fn tr(msg: Msg) -> &'static str {
    #[cfg(feature = "gui")]
    let russian = gtk::glib::language_names()
        .first()
        .is_some_and(|s| s.starts_with("ru"));
    #[cfg(not(feature = "gui"))]
    let russian = false;
    text(msg, russian)
}
pub fn tr_with(msg: Msg, arg: &str) -> String {
    tr(msg).replacen("{}", arg, 1)
}

pub fn language_name(code: &str) -> String {
    if code == "auto" {
        return tr(Msg::Auto).into();
    }
    let names = [
        ("en", "English", "Английский"),
        ("ru", "Russian", "Русский"),
        ("uk", "Ukrainian", "Украинский"),
        ("de", "German", "Немецкий"),
        ("fr", "French", "Французский"),
        ("es", "Spanish", "Испанский"),
        ("it", "Italian", "Итальянский"),
        ("pt", "Portuguese", "Португальский"),
        ("pl", "Polish", "Польский"),
        ("nl", "Dutch", "Нидерландский"),
        ("cs", "Czech", "Чешский"),
        ("sv", "Swedish", "Шведский"),
        ("tr", "Turkish", "Турецкий"),
        ("ar", "Arabic", "Арабский"),
        ("he", "Hebrew", "Иврит"),
        ("hi", "Hindi", "Хинди"),
        ("zh", "Chinese", "Китайский"),
        ("ja", "Japanese", "Японский"),
        ("ko", "Korean", "Корейский"),
        ("vi", "Vietnamese", "Вьетнамский"),
    ];
    let russian = tr(Msg::Translate) == text(Msg::Translate, true);
    names
        .iter()
        .find(|(id, _, _)| *id == code)
        .map(|(_, en, ru)| if russian { *ru } else { *en })
        .unwrap_or(code)
        .into()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn every_message_has_valid_english_and_russian() {
        for &msg in Msg::ALL {
            for russian in [false, true] {
                let value = text(msg, russian);
                assert!(!value.trim().is_empty(), "{msg:?}");
                assert!(
                    !value.contains(['ё', 'Ё', '\u{2013}', '\u{2014}']),
                    "{msg:?}"
                );
            }
        }
    }
}

pub fn effort_name(value: &str) -> &str {
    match value {
        "none" => tr(Msg::EffortNone),
        "low" => tr(Msg::EffortLow),
        "medium" => tr(Msg::EffortMedium),
        "high" => tr(Msg::EffortHigh),
        other => other,
    }
}
