import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import styles from "./BezierPlayground.module.css";
import fingergunUrl from "./fingergun.svg?url";

const PAD = 14;
const PLOT = 100;

function bezierPoint(
  t: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
) {
  const u = 1 - t;
  const uu = u * u;
  const tt = t * t;
  const bx = 3 * uu * t * x1 + 3 * u * tt * x2 + tt * t;
  const by = 3 * uu * t * y1 + 3 * u * tt * y2 + tt * t;
  return { x: bx, y: by };
}

function toSvg(mx: number, my: number) {
  return {
    x: PAD + mx * PLOT,
    y: PAD + (1 - my) * PLOT,
  };
}

export default function BezierPlayground() {
  const reactId = useId();
  const safeDomId = reactId.replace(/:/g, "");
  const logoRef = useRef<HTMLImageElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const [x1, setX1] = useState(0.25);
  const [y1, setY1] = useState(0.46);
  const [x2, setX2] = useState(0.45);
  const [y2, setY2] = useState(0.94);

  const easing = useMemo(
    () => `cubic-bezier(${x1}, ${y1}, ${x2}, ${y2})`,
    [x1, y1, x2, y2],
  );

  const curvePath = useMemo(() => {
    const parts: string[] = [];
    const steps = 96;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const { x, y } = bezierPoint(t, x1, y1, x2, y2);
      const p = toSvg(x, y);
      parts.push(i === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`);
    }
    return parts.join(" ");
  }, [x1, y1, x2, y2]);

  const p0 = toSvg(0, 0);
  const p1 = toSvg(x1, y1);
  const p2 = toSvg(x2, y2);
  const p3 = toSvg(1, 1);

  const handleLine = `M ${p0.x} ${p0.y} L ${p1.x} ${p1.y} M ${p2.x} ${p2.y} L ${p3.x} ${p3.y}`;

  const playRecoil = useCallback(() => {
    const el = logoRef.current;
    if (!el) return;
    el.getAnimations().forEach((a) => a.cancel());
    el.animate(
      [
        { transform: "rotate(0deg)", offset: 0 },
        { transform: "rotate(-20deg)", offset: 0.1 },
        { transform: "rotate(0deg)", offset: 1 },
      ],
      {
        duration: 500,
        easing,
        fill: "forwards",
      },
    );
  }, [easing]);

  // Auto-replay on edit is decorative; under zap only the Replay button plays.
  useEffect(() => {
    clearTimeout(debounceRef.current);
    if (document.documentElement.hasAttribute("data-reduced-motion")) return;
    debounceRef.current = setTimeout(() => {
      playRecoil();
    }, 280);
    return () => clearTimeout(debounceRef.current);
  }, [x1, y1, x2, y2, playRecoil]);

  const vbSize = PAD * 2 + PLOT;

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <span className={styles.light} style={{ background: "#ff5e5e" }} aria-hidden="true" />
        <span className={styles.light} style={{ background: "#ffbd40" }} aria-hidden="true" />
        <span className={styles.light} style={{ background: "#38c759" }} aria-hidden="true" />
        <span className={styles.headerLabel}>cubic-bezier</span>
      </div>
      <div className={styles.editor}>
      <div className={styles.codeArea}>
        <div className={styles.codeLine}>
          <span className={styles.dim}>
            {"/* matches logo-recoil timing */"}
          </span>
        </div>
        <div className={styles.codeLine}>
          <span className={styles.keyword}>animation</span>
          <span className={styles.punct}>:</span>
          <span className={styles.functionName}> logo-recoil</span>
          <span className={styles.number}> 0.5s</span>
          <span className={styles.functionName}> cubic-bezier</span>
          <span className={styles.punct}>(</span>
          <label className={styles.srOnly} htmlFor={`${safeDomId}-x1`}>
            x1 control point
          </label>
          <input
            id={`${safeDomId}-x1`}
            className={styles.input}
            type="number"
            step={0.01}
            value={Number.isFinite(x1) ? x1 : 0}
            onChange={(e) => setX1(parseFloat(e.target.value) || 0)}
            aria-label="x1"
          />
          <span className={styles.punct}>,</span>
          <label className={styles.srOnly} htmlFor={`${safeDomId}-y1`}>
            y1 control point
          </label>
          <input
            id={`${safeDomId}-y1`}
            className={styles.input}
            type="number"
            step={0.01}
            value={Number.isFinite(y1) ? y1 : 0}
            onChange={(e) => setY1(parseFloat(e.target.value) || 0)}
            aria-label="y1"
          />
          <span className={styles.punct}>,</span>
          <label className={styles.srOnly} htmlFor={`${safeDomId}-x2`}>
            x2 control point
          </label>
          <input
            id={`${safeDomId}-x2`}
            className={styles.input}
            type="number"
            step={0.01}
            value={Number.isFinite(x2) ? x2 : 0}
            onChange={(e) => setX2(parseFloat(e.target.value) || 0)}
            aria-label="x2"
          />
          <span className={styles.punct}>,</span>
          <label className={styles.srOnly} htmlFor={`${safeDomId}-y2`}>
            y2 control point
          </label>
          <input
            id={`${safeDomId}-y2`}
            className={styles.input}
            type="number"
            step={0.01}
            value={Number.isFinite(y2) ? y2 : 0}
            onChange={(e) => setY2(parseFloat(e.target.value) || 0)}
            aria-label="y2"
          />
          <span className={styles.punct}>)</span>
          <span className={styles.keyword}> forwards</span>
          <span className={styles.punct}>;</span>
        </div>
      </div>
      <div className={styles.body}>
        <div className={styles.graphWrap}>
          <p className={styles.graphCaption}>Easing curve (time → value)</p>
          <svg
            className={styles.graphSvg}
            viewBox={`0 0 ${vbSize} ${vbSize}`}
            role="img"
            aria-label={`Cubic Bézier easing from (0,0) to (1,1) with control points (${x1}, ${y1}) and (${x2}, ${y2})`}
          >
            <defs>
              <pattern
                id={`${safeDomId}-grid`}
                width={PLOT / 4}
                height={PLOT / 4}
                patternUnits="userSpaceOnUse"
                x={PAD}
                y={PAD}
              >
                <path
                  d={`M ${PLOT / 4} 0 L 0 0 0 ${PLOT / 4}`}
                  fill="none"
                  stroke="#2d2d2d"
                  strokeWidth="0.5"
                />
              </pattern>
            </defs>
            <rect
              x={PAD}
              y={PAD}
              width={PLOT}
              height={PLOT}
              fill={`url(#${safeDomId}-grid)`}
              stroke="#3c3c3c"
              strokeWidth="1"
            />
            <text
              x={PAD + 2}
              y={PAD + PLOT + 11}
              fill="#6e7681"
              fontSize="8"
              fontFamily="system-ui, sans-serif"
            >
              0
            </text>
            <text
              x={PAD + PLOT - 4}
              y={PAD - 4}
              fill="#6e7681"
              fontSize="8"
              fontFamily="system-ui, sans-serif"
              textAnchor="end"
            >
              1
            </text>
            <path
              d={handleLine}
              fill="none"
              stroke="#555"
              strokeWidth="1"
              strokeDasharray="4 3"
            />
            <circle
              cx={p1.x}
              cy={p1.y}
              r="3.5"
              fill="#4a9eff"
              stroke="#1e1e1e"
            />
            <circle
              cx={p2.x}
              cy={p2.y}
              r="3.5"
              fill="#c586c0"
              stroke="#1e1e1e"
            />
            <circle cx={p0.x} cy={p0.y} r="3" fill="#6a9955" />
            <circle cx={p3.x} cy={p3.y} r="3" fill="#6a9955" />
            <path
              d={curvePath}
              fill="none"
              stroke="#dcdcaa"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        <div className={styles.previewCol}>
          <p className={styles.previewLabel}>logo-recoil preview</p>
          <div className={styles.previewStage}>
            <div className={styles.pivot}>
              <img
                ref={logoRef}
                className={styles.previewLogo}
                src={fingergunUrl}
                alt="Wiki menu finger-gun icon (logo-recoil preview)"
                width={1006}
                height={888}
                draggable={false}
              />
            </div>
          </div>
          <div className={styles.controls}>
            <button
              type="button"
              className={`${styles.replay} squishy squishy-md`}
              onClick={playRecoil}
            >
              Replay animation
            </button>
            <p className={styles.hint}>
              Graph updates live; preview replays shortly after you change a
              value.
            </p>
          </div>
        </div>
      </div>
      </div>
    </div>
  );
}
