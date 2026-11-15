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

    public static bool NeedsKey(ProviderPreset preset, string baseUrl)
    {
        if (preset is not (ProviderPreset.Custom or ProviderPreset.Ollama or ProviderPreset.Lmstudio)) return Contracts.Presets[preset].NeedsKey;
        var host = Origins.HostOf(baseUrl);
        return !Origins.IsLoopbackHost(host) && (preset == ProviderPreset.Custom || !Origins.IsLanHost(host));
    }
}

public static class Origins
{
    public static bool IsAllowedEndpoint(string baseUrl) => OriginOf(baseUrl) is { } origin
        && (new Uri(origin).Scheme == "https" || IsLoopbackHost(HostOf(baseUrl)) || IsLanHost(HostOf(baseUrl)));

    public static string? NormalizeBaseUrl(string baseUrl)
    {
        if (OriginOf(baseUrl) is null) return null;
        var uri = new Uri(baseUrl);
        return uri.Scheme + "://" + HostOf(baseUrl).ToLowerInvariant() + (uri.IsDefaultPort ? "" : ":" + uri.Port) + uri.AbsolutePath.TrimEnd('/');
    }

    public static string? OriginOf(string baseUrl)
    {
        if (!Uri.TryCreate(baseUrl, UriKind.Absolute, out var uri) || uri.Scheme is not ("https" or "http") || string.IsNullOrEmpty(uri.Host) || uri.UserInfo.Length > 0)
            return null;
        return uri.GetLeftPart(UriPartial.Authority).ToLowerInvariant();
    }

    public static string HostOf(string baseUrl)
    {
        if (OriginOf(baseUrl) is null) return "";
        // Uri.Host canonicalizes IPv4 spellings that the policy treats as external.
        var authority = baseUrl.Trim().Split('/', '\\', '?', '#')[2];
        return authority.StartsWith('[') ? authority[..(authority.IndexOf(']') + 1)] : authority.Split(':')[0];
    }

    public static bool IsLoopbackHost(string host) => host.Equals("localhost", StringComparison.OrdinalIgnoreCase)
        || IPAddress.TryParse(host, out var address)
        && (address.Equals(IPAddress.IPv6Loopback) || address.AddressFamily == AddressFamily.InterNetwork && host == address.ToString() && address.GetAddressBytes()[0] == 127);

    public static bool IsLanHost(string host)
    {
        if (host.EndsWith(".local", StringComparison.OrdinalIgnoreCase)) return true;
        if (!IPAddress.TryParse(host, out var address)) return false;
        if (address.AddressFamily == AddressFamily.InterNetworkV6)
            return address.IsIPv6LinkLocal || (address.GetAddressBytes()[0] & 0xFE) == 0xFC;
        if (address.AddressFamily != AddressFamily.InterNetwork || host != address.ToString()) return false;
        var bytes = address.GetAddressBytes();
        return bytes[0] == 10 || bytes[0] == 172 && bytes[1] is >= 16 and <= 31 || bytes[0] == 192 && bytes[1] == 168 || bytes[0] == 169 && bytes[1] == 254;
    }
}
