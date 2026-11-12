namespace ByoGlot.Core;

public abstract record RunnerError
{
    public sealed record NoConnection : RunnerError;
    public sealed record NoModel : RunnerError;
    public sealed record KeyMissing : RunnerError;
    public sealed record ConsentNeeded(string Origin) : RunnerError;
    public sealed record TooLong(int Limit) : RunnerError;
    public sealed record Empty : RunnerError;
    public sealed record Backend(BackendException Error) : RunnerError;
}
public sealed class RunnerException(RunnerError error) : Exception
{
    public RunnerError Error { get; } = error;
}
public sealed record RunnerInput(string Text, int Limit, string Context = "", string AppName = "", string? TemplateId = null, string? TargetLang = null);
public sealed record RunnerOutput(string Text, string SourceLang, string TargetLang, ModelRef Model);

public sealed class TranslationRunner(ISettingsRepository settings, ISecretStore secrets, IHttpTransport transport)
{
    private readonly object gate = new();
    private readonly Dictionary<string, (Connection Connection, string? Secret, Translator Translator)> translators = [];

    public async Task<RunnerOutput> TranslateAsync(RunnerInput input, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        var text = input.Text.Trim();
        if (text.Length == 0) throw new RunnerException(new RunnerError.Empty());
        if (text.Length > input.Limit) throw new RunnerException(new RunnerError.TooLong(input.Limit));
        var state = await settings.ReadAsync();
        var connection = state.Connections.FirstOrDefault(c => c.Id == state.ActiveConnectionId) ?? throw new RunnerException(new RunnerError.NoConnection());
        var template = state.Templates.FirstOrDefault(t => t.Id == input.TemplateId)
            ?? state.Templates.FirstOrDefault(t => t.Id == state.Globals.DefaultTemplateId) ?? Contracts.BuiltinTemplate;
        var effective = SettingsLogic.Effective(template, state);
        var target = input.TargetLang ?? effective.TargetLang;
        var model = effective.Model ?? throw new RunnerException(new RunnerError.NoModel());
        var origin = Origins.OriginOf(connection.BaseUrl) ?? throw new RunnerException(new RunnerError.Backend(new BackendException(ErrorKind.Offline)));
        if (!Origins.IsAllowedEndpoint(connection.BaseUrl)) throw new RunnerException(new RunnerError.Backend(new BackendException(ErrorKind.Offline)));
        if (!Origins.IsLocalHost(new Uri(origin).Host) && !state.ConsentedOrigins.Contains(origin))
            throw new RunnerException(new RunnerError.ConsentNeeded(origin));
        string? secret;
        try { secret = await secrets.GetAsync(connection.Id, origin); }
        catch (OriginMismatchException) { throw new RunnerException(new RunnerError.KeyMissing()); }
        if (ProviderEffort.NeedsKey(connection.Preset, connection.BaseUrl) && string.IsNullOrEmpty(secret)) throw new RunnerException(new RunnerError.KeyMissing());
        var profile = LanguageProfiles.Text(state.Globals.LanguagePromptEnabled, state.Globals.LanguageProfile, target, Contracts.BuiltinProfiles, state.ProfileOverrides);
        Translator translator;
        lock (gate)
        {
            if (!translators.TryGetValue(connection.Id, out var entry) || entry.Connection != connection || entry.Secret != secret)
            {
                var client = new ProviderClient(connection, secret, transport);
                entry = (connection, secret, new Translator(_ => Task.FromResult<ITextGenerator>(client)));
                translators[connection.Id] = entry;
            }
            translator = entry.Translator;
        }
        try
        {
            var result = await translator.TranslateAsync(new(text, input.Context, input.AppName, state.Globals.SourceLang, target, effective.PrePrompt, profile, model), ct);
            return new(result, state.Globals.SourceLang, target, model);
        }
        catch (BackendException e) when (e.Kind == ErrorKind.Aborted && ct.IsCancellationRequested) { throw new OperationCanceledException(ct); }
        catch (BackendException e) { throw new RunnerException(new RunnerError.Backend(e)); }
    }
}
