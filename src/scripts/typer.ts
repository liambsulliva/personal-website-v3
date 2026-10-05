// Lobby hero type-in. Same contract as before — forward only, once per
// session, SSR text when motion is off — but the motion is v2's
// DescriptionTyper: one character at a time, pausing at each line, with that
// component's blinking "|" cursor. Marks (Analyst chart, PNC logo) type as
// the beat after their word so the caret ends past them, not in front.
// The delete/shuffle loop stays out; these three lines are the finished copy.

const root = document.documentElement;
const hero = document.querySelector<HTMLElement>("[data-hero]");

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Characters go quicker than v2's 100ms typeDelay; each line break then holds
// long enough for the cursor to blink at the end of the line (v2 0.75s step),
// so the three sentences land as separate beats.
const TYPE_DELAY = 25;
const LINE_DELAY = 633;

async function run(hero: HTMLElement): Promise<void> {
  root.dataset.typerStarted = "";
  try {
    sessionStorage.setItem("lobby-typed", "1");
  } catch {}

  const tokens = [...hero.querySelectorAll<HTMLElement>("[data-tok]")];
  const pops = new Map(
    [...hero.querySelectorAll<HTMLElement>("[data-pop]")].map((el) => [el.dataset.pop, el]),
  );
  const caret = hero.querySelector<HTMLElement>(".hero__caret")!;
  let cancelled = false;

  const finish = () => {
    cancelled = true;
    tokens.forEach((token) => {
      token.dataset.shown = "";
      token.querySelectorAll<HTMLElement>("[data-ch]").forEach((ch) => {
        ch.dataset.shown = "";
        ch.style.visibility = "";
      });
    });
    pops.forEach((pop) => (pop.dataset.shown = ""));
    caret.hidden = true;
    hero.appendChild(caret);
    root.classList.remove("typing");
  };
  document.addEventListener("motionchange", finish, { once: true });

  // The pipe lives in the line, like v2's `.cursor`, so it shares the
  // baseline and follows wraps. It contributes no width (see .hero__caret).
  const placeCaret = (el: HTMLElement, atStart = false) => {
    if (atStart) el.before(caret);
    else el.after(caret);
  };

  const steps: { el: HTMLElement; lineEnd: boolean }[] = [];
  tokens.forEach((token, index) => {
    const raw = token.textContent ?? "";
    const coreStart = raw.search(/\S/);
    const coreEnd = raw.search(/\s*$/);
    // Formatted markup leaves newlines inside some words. Type the word;
    // leave the surrounding whitespace as static text so it keeps collapsing.
    const leading = coreStart === -1 ? "" : raw.slice(0, coreStart);
    const core = coreStart === -1 ? "" : raw.slice(coreStart, coreEnd);
    const trailing = coreStart === -1 ? "" : raw.slice(coreEnd);
    const chars = Array.from(core).map((char) => {
      const el = document.createElement("span");
      el.dataset.ch = "";
      el.style.visibility = "hidden";
      el.textContent = char;
      return el;
    });
    token.replaceChildren(leading, ...chars, trailing);
    // The word box is in the layout; only untyped letters stay hidden.
    // Inline visibility, because these spans are created in script and
    // don't receive the component's scoped styles.
    token.dataset.shown = "";
    const next = tokens[index + 1];
    const pop = pops.get(core);
    const isLineEnd =
      !!next &&
      !next.hasAttribute("data-join") &&
      token.closest(".hero__line") !== next.closest(".hero__line");
    chars.forEach((el, charIndex) => {
      const last = charIndex === chars.length - 1;
      steps.push({
        el,
        lineEnd: last && !pop && isLineEnd,
      });
    });
    // Marks type as their own beat after the word, so the caret parks after
    // the glyph (the PNC line-end pause used to sit in front of the logo).
    if (pop) steps.push({ el: pop, lineEnd: isLineEnd });
  });

  if (!steps.length) {
    finish();
    return;
  }

  caret.hidden = false;
  placeCaret(steps[0].el, true);
  await sleep(450);

  for (const step of steps) {
    if (cancelled) return;
    step.el.dataset.shown = "";
    step.el.style.visibility = "visible";
    placeCaret(step.el);
    await sleep(step.lineEnd ? LINE_DELAY : TYPE_DELAY);
  }

  if (cancelled) return;
  await sleep(600);
  finish();
}

if (hero && root.classList.contains("typing")) {
  run(hero);
}

export {};
