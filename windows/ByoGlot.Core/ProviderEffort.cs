using System.Net;
using System.Net.Sockets;
using System.Text.Json.Nodes;

namespace ByoGlot.Core;

public static class ProviderEffort
{
    public static IReadOnlyList<string> Variants(ProviderPreset preset, IReadOnlyList<string>? supportedLevels, IReadOnlyList<string>? supportedParameters) => preset switch
    {
        ProviderPreset.Deepseek => ["none", .. supportedLevels ?? []],
        ProviderPreset.Openrouter when supportedParameters?.Contains("reasoning") == true => ["none", "low", "medium", "high"],
        _ => ["none"]
    };

    public static JsonObject Params(ProviderPreset preset, string? variant) => preset switch
    {
        ProviderPreset.Deepseek => new JsonObject { ["reasoning_effort"] = variant ?? "none" },
        ProviderPreset.Openrouter when variant is not null and not "none" => new JsonObject { ["reasoning"] = new JsonObject { ["effort"] = variant } },
        _ => []
    };

    public static bool NeedsKey(ProviderPreset preset, string baseUrl) => preset == ProviderPreset.Custom
        ? Origins.OriginOf(baseUrl) is not { } origin || new Uri(origin).Host is not ("localhost" or "127.0.0.1")
        : Contracts.Presets[preset].NeedsKey;
}

public static class Origins
{
    public static bool IsAllowedEndpoint(string baseUrl) => OriginOf(baseUrl) is { } origin
        && (new Uri(origin).Scheme == "https" || IsLocalHost(new Uri(origin).Host));

    public static string? NormalizeBaseUrl(string baseUrl) => OriginOf(baseUrl) is null ? null : new Uri(baseUrl).GetLeftPart(UriPartial.Path).TrimEnd('/');

    public static string? OriginOf(string baseUrl)
    {
        if (!Uri.TryCreate(baseUrl, UriKind.Absolute, out var uri) || uri.Scheme is not ("https" or "http") || string.IsNullOrEmpty(uri.Host) || uri.UserInfo.Length > 0)
            return null;
        return uri.GetLeftPart(UriPartial.Authority).ToLowerInvariant();
    }

    public static bool IsLocalHost(string host)
    {
        host = host.Trim('[', ']').ToLowerInvariant();
        if (host == "localhost" || host.EndsWith(".local", StringComparison.Ordinal)) return true;
        if (!IPAddress.TryParse(host, out var address)) return false;
        if (address.Equals(IPAddress.IPv6Loopback)) return true;
        if (address.AddressFamily == AddressFamily.InterNetworkV6)
            return address.IsIPv6LinkLocal || (address.GetAddressBytes()[0] & 0xFE) == 0xFC;
        if (address.AddressFamily != AddressFamily.InterNetwork) return false;
        var bytes = address.GetAddressBytes();
        return bytes[0] is 127 or 10 || bytes[0] == 172 && bytes[1] is >= 16 and <= 31 || bytes[0] == 192 && bytes[1] == 168 || bytes[0] == 169 && bytes[1] == 254;
    }
}
