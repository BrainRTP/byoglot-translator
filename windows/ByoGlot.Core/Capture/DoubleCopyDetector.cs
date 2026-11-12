namespace ByoGlot.Core.Capture;

public sealed class DoubleCopyDetector(TimeSpan? window = null, TimeSpan? minGap = null)
{
    private readonly TimeSpan window = window ?? TimeSpan.FromMilliseconds(600);
    private readonly TimeSpan minGap = minGap ?? TimeSpan.FromMilliseconds(120);
    private uint? lastSequence;
    private TimeSpan? candidate;

    public bool Observe(uint sequenceNumber, TimeSpan time)
    {
        if (lastSequence == sequenceNumber) return false;
        lastSequence = sequenceNumber;
        if (candidate is not { } first || time < first || time - first > window)
        {
            candidate = time;
            return false;
        }
        if (time - first < minGap)
        {
            // Formats written in one burst belong to the same copy.
            candidate = time;
            return false;
        }
        candidate = null;
        return true;
    }
}
