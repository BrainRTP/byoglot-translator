using ByoGlot.Core.Capture;

namespace ByoGlot.Core.Tests.Capture;

public class HotKeyTests
{
    [Theory]
    [InlineData(3u, 0x54u, "Ctrl+Alt+T")]
    [InlineData(6u, 0x4Bu, "Ctrl+Shift+K")]
    [InlineData(8u, 0x70u, "Win+F1")]
    [InlineData(1u, 0x20u, "Alt+Space")]
    public void DisplayStrings(uint modifiers, uint key, string expected) => Assert.Equal(expected, new HotKey(modifiers, key).Display);
    [Fact]
    public void ABareKeyIsInvalid()
    {
        Assert.False(new HotKey(0, 0x54).IsValid);
        Assert.False(new HotKey(4, 0x54).IsValid);
        Assert.True(HotKey.Default.IsValid);
        Assert.Equal("Ctrl+Alt+T", HotKey.Default.Display);
    }
}
