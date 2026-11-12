using System.Globalization;

namespace ByoGlot.Core;

public static class SettingsLogic
{
    public static ExportFile Export(AppSettings s, DateTimeOffset now) => new("byoglot-export", 1,
        now.UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture), s.Globals, s.Templates,
        s.ProfileOverrides, s.SiteRules, s.Connections.Select(c => new ExportConnection(c.Id, c.Preset, c.Name, c.BaseUrl)).ToArray());

    public static AppSettings Merge(ExportFile file, AppSettings into)
    {
        var connections = into.Connections.ToDictionary(c => c.Id);
        foreach (var c in file.Connections)
            if (Origins.IsAllowedEndpoint(c.BaseUrl)) connections.TryAdd(c.Id, new(c.Id, c.Preset, c.Name, Origins.NormalizeBaseUrl(c.BaseUrl)!));
        ModelRef? Clean(ModelRef? model) => model?.ConnectionId is { } id && connections.ContainsKey(id) ? model : null;
        Template CleanTemplate(Template t) => t with { Settings = t.Settings with { PageModel = Clean(t.Settings.PageModel), SelectionModel = Clean(t.Settings.SelectionModel) } };
        var templates = into.Templates.ToDictionary(t => t.Id);
        foreach (var t in file.Templates) templates[t.Id] = t;
        templates.TryAdd(Contracts.BuiltinTemplate.Id, Contracts.BuiltinTemplate);
        var overrides = into.ProfileOverrides.ToDictionary();
        foreach (var (id, value) in file.ProfileOverrides) overrides[id] = value;
        var rules = into.SiteRules.ToDictionary(r => r.Id);
        foreach (var r in file.SiteRules) rules[r.Id] = r;
        return into with
        {
            Globals = file.Globals,
            Templates = templates.Values.Select(CleanTemplate).ToArray(),
            ProfileOverrides = overrides,
            SiteRules = rules.Values.ToArray(),
            Connections = connections.Values.Select(c => c with { PageModel = Clean(c.PageModel), SelectionModel = Clean(c.SelectionModel) }).ToArray()
        };
    }

    public static (string PrePrompt, string TargetLang, ModelRef? Model) Effective(Template template, AppSettings settings)
    {
        var active = settings.Connections.FirstOrDefault(c => c.Id == settings.ActiveConnectionId);
        var own = template.Settings.SelectionModel;
        return (template.Settings.PrePrompt ?? "", template.Settings.TargetLang ?? settings.Globals.TargetLang,
            own is not null && own.ConnectionId == active?.Id ? own : active?.SelectionModel);
    }

    public static (ModelRef? Page, ModelRef? Selection) PickInitialModels(IReadOnlyList<ModelInfo> models, ModelInfo? defaultModel, string connectionId)
    {
        var favorite = models.FirstOrDefault(m => m.ProviderID == Contracts.FavoriteModel.ProviderID && m.Id == Contracts.FavoriteModel.Id);
        var chosen = favorite ?? defaultModel;
        if (chosen is null) return (null, null);
        var variant = chosen.Variants.Contains("none") ? "none" : favorite is null ? chosen.Variants.FirstOrDefault() : null;
        return (new(chosen.ProviderID, chosen.Id, variant, connectionId),
            new(chosen.ProviderID, chosen.Id, chosen.Variants.Contains(Contracts.SelectionDefaultEffort) ? Contracts.SelectionDefaultEffort : variant, connectionId));
    }
}
