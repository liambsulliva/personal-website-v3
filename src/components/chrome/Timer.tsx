import { useEffect, useState } from "react";

// Figma Timer (6:141). Hydrated client:idle; tick only.
// Shows the visitor's local time; hover/focus advances the film strip one
// frame to Pittsburgh time, "5:08 PM (My Time)". Touch has no hover, so a
// tap toggles the same advance — unadvertised, for whoever finds it.
const local = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});
const pgh = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
  timeZone: "America/New_York",
});

export default function Timer() {
  const [now, setNow] = useState<Date | null>(null);
  const [advanced, setAdvanced] = useState(false);

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

  const yours = now ? `${local.format(now)} (Your Time)` : "0:00 PM (Your Time)";
  const home = now ? `${pgh.format(now)} (My Time)` : "0:00 PM (My Time)";

  return (
    <div
      className="timer flex shrink-0 items-start px-2 py-1"
      tabIndex={now ? 0 : -1}
      style={{ visibility: now ? "visible" : "hidden" }}
      aria-label={`Local time ${yours}, Pittsburgh time ${home}`}
      data-advanced={advanced || undefined}
      onPointerUp={(e) => {
        if (e.pointerType !== "mouse") setAdvanced((a) => !a);
      }}
    >
      <time className="timer__gate" dateTime={now?.toISOString()}>
        <span className="timer__strip">
          <span className="timer__frame">{yours}</span>
          <span className="timer__frame" aria-hidden="true">
            {home}
          </span>
        </span>
      </time>
    </div>
  );
}
