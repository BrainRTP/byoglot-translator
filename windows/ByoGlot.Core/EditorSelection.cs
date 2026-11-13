namespace ByoGlot.Core;

public sealed class EditorSelection(string targetLang)
{
    public string TargetLang { get; private set; } = targetLang;
    public string? TemplateId { get; private set; }
    public void ChooseTemplate(Template template)
    {
        TemplateId = template.Id;
        TargetLang = template.Settings.TargetLang ?? TargetLang;
    }
    public void ChooseTarget(string language) => TargetLang = language;
}

public static class ErrorActions
{
    public static bool OpensConnections(RunnerError error) => error is RunnerError.NoConnection or RunnerError.NoModel or RunnerError.KeyMissing or RunnerError.ConsentNeeded
        or RunnerError.Backend { Error.Kind: ErrorKind.Unauthorized or ErrorKind.ProviderAuth };
}
