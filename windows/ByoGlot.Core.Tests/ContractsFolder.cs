using System.Text.Json;

namespace ByoGlot.Core.Tests;

public sealed record ContractCase<TInput, TExpected>(string Name, TInput Input, TExpected Expected);

public static class ContractsFolder
{
    public static string Dir { get; } = Find();

    public static IEnumerable<ContractCase<TInput, TExpected>> Fixture<TInput, TExpected>(string name)
    {
        using var document = JsonDocument.Parse(File.ReadAllText(Path.Combine(Dir, "fixtures", name + ".json")));
        var root = document.RootElement;
        if (root.GetProperty("contract").GetString() != name || root.GetProperty("version").GetInt32() != 1)
            throw new InvalidDataException($"Unknown contract: {name}");
        var options = new JsonSerializerOptions(JsonSerializerDefaults.Web);
        return root.GetProperty("cases").EnumerateArray().Select(c => new ContractCase<TInput, TExpected>(
            c.GetProperty("name").GetString()!,
            c.GetProperty("input").Deserialize<TInput>(options)!,
            c.GetProperty("expected").Deserialize<TExpected>(options)!)).ToArray();
    }

    private static string Find()
    {
        for (var dir = new DirectoryInfo(AppContext.BaseDirectory); dir is not null; dir = dir.Parent)
        {
            var contracts = Path.Combine(dir.FullName, "contracts");
            if (File.Exists(Path.Combine(contracts, "README.md"))) return contracts;
        }
        throw new DirectoryNotFoundException("Cannot find contracts/README.md.");
    }
}
