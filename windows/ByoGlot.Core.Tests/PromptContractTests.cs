using System.Text.Json.Nodes;

namespace ByoGlot.Core.Tests;

public class PromptContractTests
{
    public static IEnumerable<object[]> TextCases => TestJson.Cases("prompt-text");
    public static IEnumerable<object[]> ProfileCases => TestJson.Cases("language-profile");

    [Theory, MemberData(nameof(TextCases))]
    public void TextPromptMatchesEveryFixture(string name, string inputJson, string expectedJson)
    {
        _ = name;
        Assert.Equal(TestJson.Read<string>(expectedJson), PromptBuilder.Text(TestJson.Read<TextPromptInput>(inputJson)));
    }

    [Theory, MemberData(nameof(ProfileCases))]
    public void LanguageProfileMatchesEveryFixture(string name, string inputJson, string expectedJson)
    {
        _ = name;
        var input = JsonNode.Parse(inputJson)!;
        Assert.Equal(TestJson.Read<string>(expectedJson), LanguageProfiles.Text(
            input["languagePromptEnabled"]!.GetValue<bool>(), input["languageProfile"]!.GetValue<string>(), input["targetLang"]!.GetValue<string>(),
            TestJson.Read<Dictionary<string, string>>(input["builtins"]!.ToJsonString()), TestJson.Read<Dictionary<string, ProfileOverride>>(input["overrides"]!.ToJsonString())));
    }
}
