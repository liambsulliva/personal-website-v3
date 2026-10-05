import React, { useCallback, useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import Carousel from "./Carousel";

// pdf.js is loaded on demand in the browser only (never during SSR).
const loadPdfjs = async () => {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;
  return pdfjs;
};

export interface PdfSlideCarouselProps {
  // Document URL (e.g. /pitch-deck.pdf)
  src: string;
  // Slide frame width / height as a fraction (e.g. 16/10, 16/9).
  aspectRatio?: number;
  className?: string;
}

const PdfSlideCarousel: React.FC<PdfSlideCarouselProps> = ({
  src,
  aspectRatio = 16 / 10,
  className = "",
}) => {
  const [slideWidth, setSlideWidth] = useState(0);
  const [numPages, setNumPages] = useState(0);
  const [current, setCurrent] = useState(0);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">(
    "idle",
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const canvasesRef = useRef<(HTMLCanvasElement | null)[]>([]);
  const renderedRef = useRef<Set<number>>(new Set());
  const pdfRef = useRef<PDFDocumentProxy | null>(null);
  const lastSlideWidthRef = useRef(0);

  useEffect(() => {
    if (slideWidth <= 0) return;
    const prev = lastSlideWidthRef.current;
    if (prev > 0 && prev !== slideWidth) {
      renderedRef.current = new Set();
    }
    lastSlideWidthRef.current = slideWidth;
  }, [slideWidth]);

  useEffect(() => {
    let cancelled = false;
    renderedRef.current = new Set();
    canvasesRef.current = [];
    setStatus("loading");
    setErrorMessage(null);
    setNumPages(0);
    setCurrent(0);

    const load = async () => {
      try {
        const pdfjs = await loadPdfjs();
        const task = pdfjs.getDocument({ url: src });
        const pdf = await task.promise;
        if (cancelled) {
          await pdf.destroy();
          return;
        }
        pdfRef.current = pdf;
        setNumPages(pdf.numPages);
        setStatus("ready");
      } catch (e) {
        if (cancelled) return;
        setStatus("error");
        setErrorMessage(
          e instanceof Error ? e.message : "Failed to load document",
        );
      }
    };

    void load();

    return () => {
      cancelled = true;
      const p = pdfRef.current;
      pdfRef.current = null;
      if (p) void p.destroy();
    };
  }, [src]);

  const renderPage = useCallback(
    async (pageIndex: number) => {
      const pdf = pdfRef.current;
      if (!pdf || slideWidth <= 0) return;
      if (renderedRef.current.has(pageIndex)) return;

      const canvas = canvasesRef.current[pageIndex];
      if (!canvas) return;

      const pageNumber = pageIndex + 1;
      const page = await pdf.getPage(pageNumber);
      const baseViewport = page.getViewport({ scale: 1 });
      const scale = slideWidth / baseViewport.width;
      const viewport = page.getViewport({ scale });

      // High DPI rendering
      const devicePixelRatio = window.devicePixelRatio * 2 || 1;
      canvas.width = Math.floor(viewport.width * devicePixelRatio);
      canvas.height = Math.floor(viewport.height * devicePixelRatio);

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      await page.render({
        canvasContext: ctx,
        viewport,
        transform: [devicePixelRatio, 0, 0, devicePixelRatio, 0, 0],
      }).promise;
      renderedRef.current.add(pageIndex);
    },
    [slideWidth],
  );

  useEffect(() => {
    if (status !== "ready" || numPages === 0 || slideWidth <= 0) return;
    void renderPage(current);
    void renderPage(current + 1);
    void renderPage(current - 1);
  }, [status, numPages, current, slideWidth, renderPage]);

  if (status === "error") {
    return (
      <div
        className={`flex w-full min-w-0 max-w-full items-center justify-center rounded-card border border-border bg-surface px-4 text-center text-sm text-muted ${className}`}
        style={{ aspectRatio }}
      >
        {errorMessage ?? "Could not load PDF."}
      </div>
    );
  }

  return (
    <div className={`min-w-0 max-w-full overflow-x-hidden ${className}`.trim()}>
      <Carousel
        items={Array.from({ length: numPages }, (_, index) => index)}
        currentIndex={current}
        onCurrentIndexChange={setCurrent}
        loop={false}
        transition="slide"
        aspectRatio={aspectRatio}
        isLoading={status === "loading"}
        viewportClassName="isolate max-w-full rounded-card border border-border bg-skeleton"
        slideClassName="flex items-center justify-center bg-skeleton"
        previousLabel="Previous slide"
        nextLabel="Next slide"
        onViewportWidthChange={setSlideWidth}
        renderSlide={({ item: pageIndex, isActive }) => (
          <canvas
            ref={(el) => {
              canvasesRef.current[pageIndex] = el;
            }}
            className="max-h-full max-w-full object-contain"
            aria-hidden={!isActive}
          />
        )}
      />
    </div>
  );
};

export default PdfSlideCarousel;
