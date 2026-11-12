using ByoGlot.Core.Capture;

namespace ByoGlot.Core.Tests.Capture;

public class ClipboardTextTests
{
    [Theory]
    [InlineData("ExcludeClipboardContentFromMonitorProcessing")]
    [InlineData("CanIncludeInClipboardHistory")]
    public void ConcealedFormatsAreNeverRead(string format) => Assert.IsType<ClipboardRead.Concealed>(ClipboardText.Read(["Text", format], 5000, () => throw new InvalidOperationException("Must not read private content.")));
    [Fact]
    public void NoTextFormatIsEmpty() => Assert.IsType<ClipboardRead.Empty>(ClipboardText.Read(["Bitmap"], 5000, () => throw new InvalidOperationException("Must not read without a text format.")));
    [Fact]
    public void WhitespaceOnlyIsEmpty() => Assert.IsType<ClipboardRead.Empty>(ClipboardText.Read(["Text"], 5000, () => " \n \t"));
    [Fact]
    public void LongTextIsRefused() => Assert.Equal(new ClipboardRead.TooLong(5000), ClipboardText.Read(["Text"], 5000, () => new string('a', 5001)));
    [Fact]
    public void TextIsTrimmed() => Assert.Equal(new ClipboardRead.Text("hello"), ClipboardText.Read(["Text"], 5000, () => " hello \n"));
    [Fact]
    public void LimitCountsUtf16CodeUnits() => Assert.Equal(new ClipboardRead.TooLong(5000), ClipboardText.Read(["Text"], 5000, () => string.Concat(Enumerable.Repeat("😀", 2501))));
    [Fact]
    public void UnchangedSequenceNeverReadsStaleClipboardText() => Assert.IsType<ClipboardRead.Empty>(ClipboardText.ReadChanged(10, 10, ["Text"], 5000, () => throw new InvalidOperationException("Must not read the previous clipboard.")));
    [Fact]
    public void ChangedSequenceStillUsesPrivacyChecks() => Assert.IsType<ClipboardRead.Concealed>(ClipboardText.ReadChanged(10, 11, ["Text", "CanIncludeInClipboardHistory"], 5000, () => throw new InvalidOperationException("Must not read private content.")));

}
