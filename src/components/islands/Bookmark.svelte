<script lang="ts">
  // Decorative year tab on the HERL cover. The portfolio book is a cover
  // model only (no open state or page turns, unlike the HERL app itself), so
  // the tabs label milestones rather than act as buttons.
  let {
    targetPage,
    isFlipped = false,
  }: {
    targetPage: number;
    isFlipped?: boolean;
  } = $props();

  const bookmarkTitles: Record<number, string> = {
    3: "1995",
    5: "1996",
    9: "2001",
    12: "2004",
    22: "2011",
    33: "2023",
  };

  const bookmarkPages = Object.keys(bookmarkTitles);
  const totalBookmarks = bookmarkPages.length;
  const index = $derived(bookmarkPages.indexOf(targetPage.toString()));
  const top = $derived(`${(index * 45) / totalBookmarks}vmin`);
  const label = $derived(bookmarkTitles[targetPage] || `Page ${targetPage}`);
</script>

<div class="bookmark" class:flipped={isFlipped} style="top: {top}" aria-hidden="true">
  <div class="bookmark-tab">
    <span class="bookmark-label">{label}</span>
  </div>
</div>

<style>
  .bookmark {
    position: absolute;
    right: -2.5rem;
    width: 2.5rem;
    height: 4.5rem;
    background: #252525;
    transform-origin: left center;
    border-radius: 0 0.25rem 0.25rem 0;
    z-index: 1000;
  }

  .bookmark.flipped {
    right: 3rem;
    transition: right 0.35s ease-in-out 0.45s;
  }

  .bookmark-tab {
    position: relative;
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .bookmark-label {
    color: white;
    writing-mode: vertical-rl;
    text-orientation: mixed;
    transform: rotate(180deg);
    padding: 0.5rem 0;
  }
</style>
