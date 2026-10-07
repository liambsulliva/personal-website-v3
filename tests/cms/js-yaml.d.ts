// js-yaml ships without types; the CMS contract loader only needs `load`,
// the same parser Astro's glob loader uses for YAML entries.
declare module "js-yaml" {
  export function load(text: string): unknown;
  const yaml: { load: typeof load };
  export default yaml;
}
