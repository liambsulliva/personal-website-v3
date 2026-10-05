<script lang="ts">
  import { onMount } from "svelte";
  import Bookmark from "./Bookmark.svelte";

  export let class_ = "";
  export let frontSrc: string;
  export let backSrc: string;
  let book: HTMLElement;

  let isHovering = false;
  export let isFlipped = false;

  let tiltX = 9;
  let tiltY = -9;
  let rotateY = 0;
  let spineDisplay = "block";
  let paperBlockDisplay = "block";

  const totalPages = 35;
  let pages: HTMLElement[] = [];

  $: {
    rotateY = isFlipped ? 180 : 0;
  }

  const reducedMotion = () =>
    document.documentElement.hasAttribute("data-reduced-motion");

  function handleMouseMove(event: MouseEvent) {
    if (!isHovering || reducedMotion()) return;
    const rect = book.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    tiltX = ((y - centerY) / centerY) * 10;
    tiltY = ((centerX - x) / centerX) * 10;
  }

  function handleMouseLeave() {
    isHovering = false;
    tiltX = 9;
    tiltY = -9;
  }

  function handleMouseEnter() {
    isHovering = true;
  }

  onMount(() => {
    book.addEventListener("mousemove", handleMouseMove);
    book.addEventListener("mouseenter", handleMouseEnter);
    book.addEventListener("mouseleave", handleMouseLeave);

    return () => {
      book.removeEventListener("mousemove", handleMouseMove);
      book.removeEventListener("mouseenter", handleMouseEnter);
      book.removeEventListener("mouseleave", handleMouseLeave);
    };
  });
</script>

<div
  bind:this={book}
  class="book {class_} {isFlipped ? 'flipped' : ''}"
  style="transform: rotateX({tiltX}deg) rotateY({tiltY + rotateY}deg)"
>
  <div class="front">
    <img
      src={frontSrc}
      alt="Front Cover"
      class="rounded-r w-full h-full object-cover"
    />
  </div>
  <div class="back">
    <img
      src={backSrc}
      alt="Back Cover"
      class="rounded-r w-full h-full object-cover"
    />
  </div>
  <div class="spine" style="display: {spineDisplay};"></div>
  <div class="paper-block" style="display: {paperBlockDisplay};"></div>
  {#each Array(totalPages) as _, i}
    <div bind:this={pages[i]} class="page" style="z-index: {totalPages - i};">
      {#if i + 1 === 3 || i + 1 === 5 || i + 1 === 9 || i + 1 === 12 || i + 1 === 22 || i + 1 === 33}
        <div style="position: relative; z-index: 1000;">
          <Bookmark targetPage={i + 1} {isFlipped} />
        </div>
      {/if}
    </div>
  {/each}
</div>

<style>
  .book {
    transform-style: preserve-3d;
    position: relative;
    margin: 5vmin auto;
    margin-bottom: 4rem;
    transition: transform 0.5s ease-out;
    max-width: 75vw;
    height: 52.5vmin;
    width: 75vmin;
    z-index: 40;
  }

  .front,
  .back,
  .spine,
  .paper-block,
  .page {
    position: absolute;
    top: 0;
    left: 0;
    transition:
      transform 0.5s ease,
      box-shadow 0.35s ease-in-out;
    /* Fix GPU Rendering Bug on bookOpen (Chromium) */
    backface-visibility: visible;
    -webkit-backface-visibility: visible;
    /* -------------------------------- */
  }

  .page,
  .front,
  .back {
    transform-origin: left center;
  }

  .front,
  .back {
    width: 100%;
    height: 100%;
  }

  .spine {
    width: 55px;
    height: 100%;
    left: -1.5rem;
    background: #252525;
    transform: rotateY(-90deg) translateX(-40%);
    transform-style: preserve-3d;
    border-radius: 5px 0 0 5px;
  }

  .spine::before,
  .spine::after {
    content: "";
    position: absolute;
    width: 100%;
    height: 100%;
    background: #252525;
    display: none;
  }

  .front {
    z-index: 2;
    transform: translateZ(10px);
  }

  .back {
    z-index: 1;
    background: #624a2e;
    transform: translateZ(-55px);
    box-shadow: 0 8px 16px rgba(0, 0, 0, 0.2);
    border-radius: 0 5px 5px 0;
  }

  .paper-block {
    width: 95%;
    height: 98%;
    top: 1%;
    left: 2.5%;
    background: #f5f5f5;
    transform: translateZ(-54px);
    box-shadow: inset 0 0 5px rgba(0, 0, 0, 0.1);
    border-radius: 0 5px 5px 0;
  }

  .page {
    position: absolute;
    width: 98%;
    height: 98%;
    top: 1%;
    left: 1%;
    background: #fdfdfd;
    transform: translateZ(0);
    /* Browser Performance Optimization for Chromium, partial support in Firefox */
    will-change: transform;
    /* -------------------------------- */
    border-radius: 0 5px 5px 0;
  }

  .page img {
    border-radius: 0 5px 5px 0;
  }

  @media screen and (max-width: 600px) {
    .spine {
      transform: rotateY(-90deg) translateX(-40%);
    }
  }
</style>
