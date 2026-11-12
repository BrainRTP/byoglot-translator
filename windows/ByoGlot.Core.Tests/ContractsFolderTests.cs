namespace ByoGlot.Core.Tests;

public class ContractsFolderTests
{
    [Fact]
    public void FindsTheContractsFolder() => Assert.True(File.Exists(Path.Combine(ContractsFolder.Dir, "fixtures", "prompt-text.json")));

    [Fact]
    public void EmbedsContractDataAndProfiles()
    {
        var names = typeof(Contracts).Assembly.GetManifestResourceNames();
        Assert.Contains("contracts/languages.json", names);
        Assert.Contains("profiles/generic.md", names);
    }
}
