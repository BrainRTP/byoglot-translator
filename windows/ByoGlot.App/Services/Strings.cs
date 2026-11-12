using System.Globalization;
using Microsoft.Windows.ApplicationModel.Resources;

namespace ByoGlot.App.Services;

public static class Strings
{
    private static readonly ResourceLoader Loader = new();
    public static string Get(string key) => Loader.GetString(key);
    public static string Format(string key, params object[] values) => string.Format(CultureInfo.CurrentUICulture, Get(key), values);
}
