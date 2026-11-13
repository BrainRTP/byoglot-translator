using System.Globalization;

namespace ByoGlot.Core.Capture;

public sealed record HotKey(uint Modifiers, uint VirtualKey)
{
    public static HotKey Default { get; } = new(0x0002 | 0x0001, 0x54);
    public bool IsValid => (Modifiers & 0x000B) != 0 && VirtualKey is > 0 and <= 0xFF && VirtualKey is not (0x10 or 0x11 or 0x12 or 0x5B or 0x5C);
    public string Display
    {
        get
        {
            var keys = new List<string>();
            if ((Modifiers & 0x0002) != 0) keys.Add("Ctrl");
            if ((Modifiers & 0x0001) != 0) keys.Add("Alt");
            if ((Modifiers & 0x0004) != 0) keys.Add("Shift");
            if ((Modifiers & 0x0008) != 0) keys.Add("Win");
            keys.Add(VirtualKey switch
            {
                >= 0x30 and <= 0x39 or >= 0x41 and <= 0x5A => ((char)VirtualKey).ToString(),
                >= 0x70 and <= 0x87 => "F" + (VirtualKey - 0x6F).ToString(CultureInfo.InvariantCulture),
                0x08 => "Backspace", 0x09 => "Tab", 0x0D => "Enter", 0x1B => "Esc", 0x20 => "Space",
                0x21 => "PageUp", 0x22 => "PageDown", 0x23 => "End", 0x24 => "Home",
                0x25 => "Left", 0x26 => "Up", 0x27 => "Right", 0x28 => "Down", 0x2D => "Insert", 0x2E => "Delete",
                _ => "0x" + VirtualKey.ToString("X2", CultureInfo.InvariantCulture)
            });
            return string.Join("+", keys);
        }
    }
}
