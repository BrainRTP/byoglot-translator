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
    [Theory]
    [InlineData("\uFEFF", "")]
    [InlineData("\u0085", "\u0085")]
    [InlineData("\uFEFF\t\n\v\f\r \u00A0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200A\u2028\u2029\u202F\u205F\u3000", "")]
    public void PromptWhitespaceMatchesJavaScript(string edge, string retained)
    {
        var prompt = PromptBuilder.Text(new(edge + "rules" + edge, edge + "style" + edge, "en", "ru", "text", edge, edge + "App" + edge));
        Assert.Contains("USER INSTRUCTIONS:\n" + retained + "rules" + retained + "\n\n", prompt);
        Assert.Contains("LANGUAGE STYLE (the user instructions below override it):\n" + retained + "style" + retained + "\n\n", prompt);
        Assert.Contains("The text comes from the app " + retained + "App" + retained + ".", prompt);
        if (retained.Length == 0) Assert.DoesNotContain("CONTEXT", prompt);
        else Assert.Contains("CONTEXT (do not translate):\n" + edge, prompt);
    }

    [Theory]
    [InlineData("\uFEFF", "R")]
    [InlineData("\u0085", "\u0085R\u0085")]
    public void OverrideComparisonUsesJavaScriptWhitespace(string edge, string expected)
    {
        Assert.Equal(expected, LanguageProfiles.Text(true, "generic", "en", new Dictionary<string, string> { ["generic"] = "R" }, new Dictionary<string, ProfileOverride> { ["generic"] = new(edge + "R" + edge, "R", 1) }));
    }

}
