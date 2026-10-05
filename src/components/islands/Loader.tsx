import { useEffect, useState } from "react";

// v2 Loader (EOS three-dots) on site tokens; shows an offline hint instead of
// spinning forever when the connection drops. The pulse is SVG SMIL, which the
// global zap CSS can't reach, so zap is read here and the dots render still.
const isReduced = () => document.documentElement.hasAttribute("data-reduced-motion");

export default function Loader({ size = 64, showOfflineMessage = true }: { size?: number; showOfflineMessage?: boolean }) {
  const [offline, setOffline] = useState(false);
  const [reduced, setReduced] = useState(() => typeof document !== "undefined" && isReduced());

  useEffect(() => {
    const observer = new MutationObserver(() => setReduced(isReduced()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-reduced-motion"] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const online = () => setOffline(false);
    const lost = () => setOffline(true);
    window.addEventListener("online", online);
    window.addEventListener("offline", lost);
    setOffline(!navigator.onLine);
    return () => {
      window.removeEventListener("online", online);
      window.removeEventListener("offline", lost);
    };
  }, []);

  return (
    <div className="flex justify-center py-6" role="status" aria-label="Loading photos">
      {showOfflineMessage && offline ? (
        <p className="m-0 text-[16px] text-muted">You seem to have lost connection. Try refreshing?</p>
      ) : (
        <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className="text-muted">
          {[
            { cx: 18, begin: "0.67" },
            { cx: 12, begin: "0.33" },
            { cx: 6, begin: "0" },
          ].map(({ cx, begin }) => (
            <circle key={cx} cx={cx} cy={12} r={reduced ? 2 : 0} fill="currentColor">
              {!reduced && (
                <animate
                  attributeName="r"
                  begin={begin}
                  calcMode="spline"
                  dur="1.5s"
                  keySplines="0.2 0.2 0.4 0.8;0.2 0.2 0.4 0.8;0.2 0.2 0.4 0.8"
                  repeatCount="indefinite"
                  values="0;2;0;0"
                />
              )}
            </circle>
          ))}
        </svg>
      )}
    </div>
  );
}
