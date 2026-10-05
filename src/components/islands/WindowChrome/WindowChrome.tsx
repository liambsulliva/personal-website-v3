import type { ReactNode } from "react";
import styles from "./WindowChrome.module.css";

interface WindowChromeProps {
  title?: ReactNode;
  className?: string;
  children?: ReactNode;
}

export default function WindowChrome({
  title,
  className,
  children,
}: WindowChromeProps) {
  return (
    <div className={`${styles.window}${className ? ` ${className}` : ""}`}>
      <div className={styles.chrome}>
        <div className={styles.dots} aria-hidden="true">
          <span className={styles.dot} data-color="close" />
          <span className={styles.dot} data-color="minimize" />
          <span className={styles.dot} data-color="maximize" />
        </div>
        {title ? <span className={styles.title}>{title}</span> : null}
      </div>
      {children != null ? <div className={styles.body}>{children}</div> : null}
    </div>
  );
}
