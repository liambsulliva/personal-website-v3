export type SectionKey =
  | "me"
  | "career"
  | "engineering"
  | "design"
  | "photography"
  | "writing";

export type NavGeometry = {
  size: number;
  gap: number;
  slot: number;
  glyph: number;
};

export type Section = {
  key: SectionKey;
  label: string;
  href: string;
  /** Figma icon set name in /public/icons */
  icon: string;
  /** CSS color token */
  color: string;
  /**
   * Lobby NavLink stair-step geometry (Figma 16:225 desktop, 18:368 mobile):
   * font size, text→icon gap, icon slot, glyph (overflows slot). Desktop
   * values are multiplied by --lobby-u (see pages/index.astro).
   */
  lobby: { desktop: NavGeometry; mobile: NavGeometry };
  /** Mobile menu link font size + text/icon gap (Figma 33:1236) */
  menu: { size: number; gap: number };
};

export const SECTIONS: readonly Section[] = [
  {
    key: "me",
    label: "Me",
    href: "/me",
    icon: "user",
    color: "var(--accent-walnut)",
    lobby: {
      desktop: { size: 100, gap: 16, slot: 62, glyph: 69.44 },
      mobile: { size: 48, gap: 6, slot: 23.25, glyph: 26.04 },
    },
    menu: { size: 48, gap: 10 },
  },
  {
    key: "career",
    label: "Career",
    href: "/career",
    icon: "briefcase",
    color: "var(--accent-career)",
    lobby: {
      desktop: { size: 87, gap: 16, slot: 54, glyph: 69.44 },
      mobile: { size: 40, gap: 10, slot: 29.549, glyph: 37.998 },
    },
    menu: { size: 40, gap: 10 },
  },
  {
    key: "engineering",
    label: "Engineering",
    href: "/engineering",
    icon: "monitor",
    color: "var(--accent-engineering)",
    lobby: {
      desktop: { size: 72, gap: 13, slot: 45, glyph: 57.04 },
      mobile: { size: 36, gap: 9, slot: 24.624, glyph: 31.212 },
    },
    menu: { size: 36, gap: 9 },
  },
  {
    key: "design",
    label: "Design",
    href: "/design",
    icon: "palette",
    color: "var(--accent-design)",
    lobby: {
      desktop: { size: 59, gap: 11, slot: 37, glyph: 47.12 },
      mobile: { size: 33, gap: 8, slot: 20.246, glyph: 25.784 },
    },
    menu: { size: 33, gap: 8 },
  },
  {
    key: "photography",
    label: "Photography",
    href: "/photography",
    icon: "camera",
    color: "var(--accent-photography)",
    lobby: {
      desktop: { size: 48, gap: 9, slot: 30, glyph: 38.44 },
      mobile: { size: 30, gap: 8, slot: 16.416, glyph: 21.034 },
    },
    menu: { size: 30, gap: 8 },
  },
  {
    key: "writing",
    label: "Writing",
    href: "/writing",
    icon: "pen",
    color: "var(--accent-writing)",
    lobby: {
      desktop: { size: 40, gap: 8, slot: 25, glyph: 32.24 },
      mobile: { size: 28, gap: 7, slot: 13.68, glyph: 17.642 },
    },
    menu: { size: 28, gap: 7 },
  },
];

export const sectionByKey = (key: SectionKey) =>
  SECTIONS.find((section) => section.key === key)!;

export const SOCIALS = [
  { icon: "file-text", label: "Resume", href: "https://flowcv.com/resume/ida15ih5ad" },
  { icon: "github", label: "GitHub", href: "https://github.com/liambsulliva" },
  {
    icon: "linkedin",
    label: "LinkedIn",
    href: "https://linkedin.com/in/liambsulliva",
  },
] as const;

export const VERSIONS = [
  { label: "v3.", href: null },
  { label: "v2.", href: "https://v2.liambsullivan.com" },
  { label: "v1.", href: "https://v1.liambsullivan.com" },
] as const;
