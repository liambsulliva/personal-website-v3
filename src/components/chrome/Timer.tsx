import { useEffect, useState } from "react";

// Figma Timer (6:141): "5:08 PM ET (PGH)". Hydrated client:idle; tick only.
// Hover/focus flips the face down (a 3D cube turn) to 24-hour time.
const twelve = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
  timeZone: "America/New_York",
});
const twentyFour = new Intl.DateTimeFormat("en-US", {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "America/New_York",
});

export default function Timer() {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    let interval: number | undefined;
    // Align ticks to the minute boundary.
    const timeout = window.setTimeout(
      () => {
        setNow(new Date());
        interval = window.setInterval(() => setNow(new Date()), 60_000);
      },
      60_000 - (Date.now() % 60_000),
    );
    return () => {
      window.clearTimeout(timeout);
      window.clearInterval(interval);
    };
  }, []);

  const civil = now ? `${twelve.format(now)} ET (PGH)` : "0:00 PM ET (PGH)";
  const military = now ? `${twentyFour.format(now)} ET (PGH)` : "00:00 ET (PGH)";

  return (
    <div
      className="timer flex shrink-0 items-start px-2 py-1"
      tabIndex={now ? 0 : -1}
      style={{ visibility: now ? "visible" : "hidden" }}
      aria-label={`Pittsburgh time ${civil}`}
    >
      <time className="timer__cube" dateTime={now?.toISOString()}>
        <span className="timer__face timer__face--front">{civil}</span>
        <span className="timer__face timer__face--top" aria-hidden="true">
          {military}
        </span>
      </time>
    </div>
  );
}
