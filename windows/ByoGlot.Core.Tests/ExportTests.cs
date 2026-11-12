using System.Text.Json;
using System.Text.Json.Nodes;

namespace ByoGlot.Core.Tests;

public class ExportTests
{
    private static string Sample => File.ReadAllText(Path.Combine(ContractsFolder.Dir, "samples", "export-v1.json"));

    [Fact]
    public void SampleDecodesAndRoundTrips()
    {
        var file = ExportFile.Decode(Sample);
        var json = JsonSerializer.Serialize(file, CoreJson.Options);
        Assert.True(JsonNode.DeepEquals(JsonNode.Parse(Sample), JsonNode.Parse(json)));
        Assert.Equal(file.ExportedAt, ExportFile.Decode(json).ExportedAt);
    }

    [Theory]
    [InlineData("format", "other")]
    [InlineData("version", 2)]
    public void OtherFormatsAndVersionsAreRejected(string key, object value)
    {
        var json = JsonNode.Parse(Sample)!;
        json[key] = JsonSerializer.SerializeToNode(value);
        Assert.Throws<JsonException>(() => ExportFile.Decode(json.ToJsonString()));
    }

    [Fact]
    public void ExportConnectionsHaveExactlyFourPortableFields()
    {
        var c = new Connection("c", ProviderPreset.Deepseek, "DeepSeek", "https://api.deepseek.com", new("deepseek", "model"));
        var settings = AppSettings.Initial("ru") with { Connections = [c], ConsentedOrigins = [c.BaseUrl], ActiveConnectionId = c.Id };
        var file = SettingsLogic.Export(settings, DateTimeOffset.UnixEpoch);
        var json = JsonSerializer.SerializeToNode(file, CoreJson.Options)!;
        Assert.Equal(new[] { "id", "preset", "name", "baseUrl" }, json["connections"]![0]!.AsObject().Select(p => p.Key));
        Assert.Equal("1970-01-01T00:00:00.000Z", file.ExportedAt);
    }

    [Fact]
    public void MergeDropsUnknownModelsKeepsOneBuiltinAndPreservesExistingConnections()
    {
        var file = ExportFile.Decode(Sample);
        var study = file.Templates.Single(t => t.Id == "study");
        file = file with { Templates = [.. file.Templates, study with { Id = "unknown", Settings = study.Settings with { PageModel = new("custom", "bad", ConnectionId: "missing"), SelectionModel = new("custom", "bad", ConnectionId: "missing") } }] };
        var existing = new Connection("c1", ProviderPreset.Custom, "keep", "http://localhost");
        var into = AppSettings.Initial("en") with { Connections = [existing], ProfileOverrides = new Dictionary<string, ProfileOverride> { ["ru"] = new("old", "old", 0) }, SiteRules = [new("r1", "old", "old")] };
        var merged = SettingsLogic.Merge(file, into);
        Assert.Single(merged.Templates, t => t.Id == Contracts.BuiltinTemplate.Id);
        Assert.Null(merged.Templates.Single(t => t.Id == "unknown").Settings.PageModel);
        Assert.Null(merged.Templates.Single(t => t.Id == "unknown").Settings.SelectionModel);
        Assert.Equal(existing, Assert.Single(merged.Connections));
        Assert.Equal(file.Globals, merged.Globals);
        Assert.Equal("Keep technical terms clear.", merged.ProfileOverrides["ru"].Text);
        Assert.Equal("*.example.com", Assert.Single(merged.SiteRules).Pattern);
    }

    [Fact]
    public void InitialModelsPreferFavoriteAndFallBackToDefault()
    {
        var favorite = new ModelInfo("deepseek", "deepseek-flash", "Favorite", ["none", "low", "high"], 0, 0);
        var other = new ModelInfo("custom", "other", "Other", ["low", "high"], 0, 0);
        var chosen = SettingsLogic.PickInitialModels([other, favorite], other, "c");
        Assert.Equal(new("deepseek", "deepseek-flash", "none", "c"), chosen.Page);
        Assert.Equal(new("deepseek", "deepseek-flash", "high", "c"), chosen.Selection);
        chosen = SettingsLogic.PickInitialModels([other], other, "c");
        Assert.Equal("low", chosen.Page?.Variant);
        Assert.Equal("high", chosen.Selection?.Variant);
        Assert.Equal((null, null), SettingsLogic.PickInitialModels([], null, "c"));
    }

    [Theory]
    [InlineData("secret")]
    [InlineData("missing")]
    [InlineData("null")]
    [InlineData("enum")]
    public void InvalidPortableShapesAreRejected(string change)
    {
        var json = JsonNode.Parse(Sample)!;
        switch (change)
        {
            case "secret": json["connections"]![0]!["apiKey"] = "must-not-import"; break;
            case "missing": json["globals"]!.AsObject().Remove("targetLang"); break;
            case "null": json["templates"]![0]!["settings"]!["targetLang"] = null; break;
            case "enum": json["connections"]![0]!["preset"] = 0; break;
        }
        Assert.Throws<JsonException>(() => ExportFile.Decode(json.ToJsonString()));
    }
}
