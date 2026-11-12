using System.Text.Json.Nodes;

namespace ByoGlot.Core.Tests;

public class ContractsTests
{
    [Fact]
    public void LanguagesEqualContract()
    {
        var languages = JsonNode.Parse(File.ReadAllText(Path.Combine(ContractsFolder.Dir, "languages.json")))!;
        TestJson.Equal(languages["codes"], Contracts.LanguageCodes);
        Assert.Equal(languages["auto"]!.GetValue<string>(), Contracts.AutoSourceName);
        foreach (var (code, name) in languages["names"]!.AsObject()) Assert.Equal(name!.GetValue<string>(), Contracts.LanguageName(code));
        Assert.Equal("Russian", Contracts.LanguageName("ru"));
        Assert.Equal("not a code", Contracts.LanguageName("not a code"));
    }

    [Fact]
    public void LimitsPresetsAndProfilesEqualContract()
    {
        Assert.Equal(4000, Contracts.Limits.MaxChars);
        Assert.Equal(180000, Contracts.Limits.GenerateTimeoutMs);
        Assert.Equal("https://api.deepseek.com", Contracts.Presets[ProviderPreset.Deepseek].BaseUrl);
        var presets = JsonNode.Parse(File.ReadAllText(Path.Combine(ContractsFolder.Dir, "presets.json")))!;
        TestJson.Equal(presets["favoriteModel"], Contracts.FavoriteModel);
        Assert.Equal(presets["selectionDefaultEffort"]!.GetValue<string>(), Contracts.SelectionDefaultEffort);
        foreach (var (id, profile) in Contracts.BuiltinProfiles)
        {
            Assert.False(string.IsNullOrWhiteSpace(profile));
            Assert.Equal(File.ReadAllText(Path.Combine(ContractsFolder.Dir, "..", "lib", "translate", "profiles", id + ".md")).Trim(), profile);
        }
        Assert.DoesNotContain('\n', Contracts.BuiltinProfiles["generic"][^1..]);
    }

    [Fact]
    public void ErrorKindsAndFatalClassificationEqualContract()
    {
        var errors = JsonNode.Parse(File.ReadAllText(Path.Combine(ContractsFolder.Dir, "errors.json")))!;
        TestJson.Equal(errors["kinds"], Enum.GetValues<ErrorKind>().Select(k => k.Wire()).ToArray());
        TestJson.Equal(errors["fatal"], Enum.GetValues<ErrorKind>().Where(k => new BackendException(k).IsFatal).Select(k => k.Wire()).ToArray());
    }
}
