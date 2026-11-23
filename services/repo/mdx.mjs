// What an entry's MDX may contain. MDX is code: it runs when the site builds
// and in the site's server, so an entry written by whoever got into the
// dashboard is limited to data and the site's own components:
//
//   import    components under src/components, and albumPhotos from lib/cloudinary
//   export    `export const name = <literal>`, or albumPhotos(<literal>)
//   {…}       literals and the names above; no calls, members or functions
//   <…>       components, and plain elements without scripts or handlers
//
// Parsed with the same extensions, in the same order, as Astro's MDX, so there
// is nothing this reads as text that the site would run.
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { mdxFromMarkdown } from "mdast-util-mdx";
import { gfm } from "micromark-extension-gfm";
import { mdxjs } from "micromark-extension-mdxjs";
import { plainYaml } from "./yaml.mjs";

const COMPONENT_FILE = /^\.\.\/\.\.\/components\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.(?:tsx|jsx|astro|svelte)$/;
const HELPERS = { "../../lib/cloudinary": new Set(["albumPhotos"]) };
/** The fields of src/content.config.ts. Astro also reads `layout`, as a path to import. */
const FIELDS = new Set("title description wing section kind date href external github image hero heroFit badges languages role team tools timeline subtitle featured hidden".split(" "));
const ELEMENTS = new Set("a abbr b blockquote br cite code dd del details div dl dt em figcaption figure h2 h3 h4 h5 h6 hr i img ins kbd li mark ol p pre q s samp small span strong sub summary sup table tbody td tfoot th thead time tr u ul var".split(" "));
const LINKS = new Set(["href", "src", "url", "action", "formaction", "poster", "data"]);
const safeLink = (value) => {
  // As a browser reads a scheme: control characters and spaces don't count.
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(value.replace(/[\0-\x20\x7f-\x9f]/g, ""));
  if (/&(?:#|colon|tab|newline)/i.test(value)) return false;
  return !scheme || ["http", "https", "mailto", "tel"].includes(scheme[1].toLowerCase());
};

/** A few components render their text as HTML (set:html): inline formatting only. */
const TAG = /^<\/?(?:a|b|br|code|em|i|kbd|mark|s|span|strong|sub|sup)((?: (?:href|class|rel|target)=(?:"[^"<>]*"|'[^'<>]*'))*) ?\/?>/;
function safeText(text) {
  for (const { index } of text.matchAll(/<[a-z!?/]/gi)) {
    const tag = TAG.exec(text.slice(index));
    if (!tag) return false;
    for (const [, href] of tag[1].matchAll(/ href=(.[^"'<>]*)/g)) if (!safeLink(href.slice(1))) return false;
  }
  // A string that ends in “<” is a tag waiting for the next one.
  return !text.endsWith("<");
}

class Refused extends Error {}
const refuse = (what) => {
  throw new Refused(what);
};

/** A literal: data only, apart from names in `known`. */
function checkValue(node, known) {
  switch (node.type) {
    case "Literal":
      if (node.regex || node.bigint) refuse("a regular expression");
      return typeof node.value === "string" && !safeText(node.value) ? refuse("HTML in text") : undefined;
    case "TemplateLiteral":
      if (node.expressions.length) refuse("a template with code in it");
      return safeText(node.quasis[0].value.cooked ?? "") ? undefined : refuse("HTML in text");
    case "Identifier":
      return known.has(node.name) || node.name === "undefined" ? undefined : refuse(`the name “${node.name}”`);
    case "UnaryExpression":
      return ["-", "+", "!"].includes(node.operator) ? checkValue(node.argument, known) : refuse(`“${node.operator}”`);
    case "BinaryExpression":
      // 16 / 9
      if (!["-", "*", "/"].includes(node.operator)) refuse(`“${node.operator}”`);
      checkValue(node.left, known);
      return checkValue(node.right, known);
    case "ArrayExpression":
      for (const item of node.elements) item && checkValue(item, known);
      return;
    case "ObjectExpression":
      for (const property of node.properties) {
        if (property.type !== "Property" || property.kind !== "init" || property.method || property.computed) refuse("a computed, spread or method property");
        const key = property.key.name ?? String(property.key.value);
        if (key === "__proto__" || key === "dangerouslySetInnerHTML") refuse(`the property “${key}”`);
        checkValue(property.value, known);
      }
      return;
    default:
      refuse(`code (${node.type})`);
  }
}

function checkImports(program, known) {
  for (const node of program.body) {
    if (node.type !== "ImportDeclaration") continue;
    const from = node.source.value;
    for (const item of node.specifiers) {
      if (COMPONENT_FILE.test(from) && item.type === "ImportDefaultSpecifier" && /^[A-Z]/.test(item.local.name)) known.components.add(item.local.name);
      else if (HELPERS[from]?.has(item.imported?.name) && item.local.name === item.imported.name) known.helpers.add(item.local.name);
      else refuse(`an import from “${from}”`);
    }
    if (!node.specifiers.length || node.attributes?.length) refuse(`an import from “${from}”`);
  }
}

function checkExports(program, known) {
  for (const node of program.body) {
    if (node.type === "ImportDeclaration") continue;
    if (node.type !== "ExportNamedDeclaration" || node.declaration?.type !== "VariableDeclaration" || node.declaration.kind !== "const") refuse("code outside “export const”");
    for (const { id, init } of node.declaration.declarations) {
      // Names the site's own build exports or reads.
      if (id.type !== "Identifier" || !/^[a-z][A-Za-z0-9]*$/.test(id.name) || ["components", "frontmatter", "file", "url", "layout", "prerender"].includes(id.name) || !init) refuse("that export");
      const call = init.type === "CallExpression" && init.callee.type === "Identifier" && known.helpers.has(init.callee.name) && !init.optional;
      if (call) for (const arg of init.arguments) checkValue(arg, known.values);
      else checkValue(init, known.values);
      known.values.add(id.name);
    }
  }
}

function checkElement(node, known) {
  const name = node.name;
  if (name === null) {
    if (node.attributes.length) refuse("attributes on a fragment");
    return;
  }
  // <Component>: an imported one or one the site passes in. Dots and colons reach other objects.
  const component = /^[A-Z][A-Za-z0-9]*$/.test(name);
  if (!component && !ELEMENTS.has(name)) refuse(`the element <${name}>`);
  if (known.values.has(name)) refuse(`the element <${name}>`);
  for (const attribute of node.attributes) {
    if (attribute.type !== "mdxJsxAttribute") refuse("a spread attribute");
    const key = attribute.name;
    const lower = key.toLowerCase();
    if (key.includes(":") ? !(component && /^client:(visible|load|idle)$/.test(key)) : /^on/.test(lower) || ["dangerouslysetinnerhtml", "srcdoc", "srcset", "ref"].includes(lower)) refuse(`the attribute ${key}`);
    const value = attribute.value;
    if (value && typeof value === "object") {
      checkExpression(value.data?.estree, known);
      const literal = value.data?.estree?.body[0]?.expression;
      if (LINKS.has(lower) && !(literal?.type === "Literal" && typeof literal.value === "string" && safeLink(literal.value))) refuse(`code in ${key}`);
    } else if (typeof value === "string" && !safeText(value)) {
      refuse("HTML in text");
    } else if (LINKS.has(lower) && typeof value === "string" && !safeLink(value)) refuse(`that ${key}`);
  }
}

function checkExpression(program, known) {
  // An empty {} or a comment has no body.
  if (!program) refuse("an expression that doesn't parse");
  if (!program.body.length) return;
  if (program.body.length !== 1 || program.body[0].type !== "ExpressionStatement") refuse("code");
  checkValue(program.body[0].expression, known.values);
}

function* walk(node) {
  yield node;
  for (const child of node.children ?? []) yield* walk(child);
}

/** Splits an entry the one way Astro and the dashboard both do, or refuses it. */
function split(text) {
  const match = /^---\n([\s\S]*?\n)---(?:\n([\s\S]*))?$/.exec(text);
  // Astro ends the frontmatter at the first “---” that starts a line, or “+++”.
  if (!match || /^(?:---|\+\+\+)/m.test(match[1]) || text.includes("\r")) refuse("that frontmatter");
  return { yaml: match[1], body: match[2] ?? "" };
}

/** Why this entry can't be published, or null. */
export function entryProblem(text) {
  try {
    const { yaml, body } = split(text);
    const front = plainYaml(yaml);
    if (front.problem) return `Frontmatter: ${front.problem}`;
    const data = front.data ?? {};
    if (typeof data !== "object" || Array.isArray(data)) refuse("that frontmatter");
    for (const key of Object.keys(data)) if (!FIELDS.has(key)) refuse(`the field “${key}”`);
    for (const key of ["href", "github"]) if (typeof data[key] === "string" && !safeLink(data[key])) refuse(`that ${key}`);

    let tree;
    try {
      tree = fromMarkdown(body, { extensions: [mdxjs(), gfm()], mdastExtensions: [mdxFromMarkdown(), gfmFromMarkdown()] });
    } catch (error) {
      return `The write-up doesn't parse: ${error.reason ?? error.message}`;
    }
    const known = { components: new Set(), helpers: new Set(), values: new Set() };
    const nodes = [...walk(tree)];
    const code = nodes.filter((node) => node.type === "mdxjsEsm");
    for (const node of code) checkImports(node.data?.estree ?? refuse("code that doesn't parse"), known);
    for (const node of code) checkExports(node.data.estree, known);
    for (const node of nodes) {
      if (node.type === "mdxJsxFlowElement" || node.type === "mdxJsxTextElement") checkElement(node, known);
      else if (node.type === "mdxFlowExpression" || node.type === "mdxTextExpression") checkExpression(node.data?.estree, known);
      else if (node.type === "html") refuse("raw HTML");
      else if ((node.type === "link" || node.type === "image" || node.type === "definition") && !safeLink(node.url)) refuse("that link");
    }
    return null;
  } catch (error) {
    if (error instanceof Refused) return `The write-up can't contain ${error.message}`;
    return "The write-up couldn't be checked";
  }
}
