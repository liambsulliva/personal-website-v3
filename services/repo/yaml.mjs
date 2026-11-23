import { parseDocument, visit } from "yaml";

const CORE = new Set(["str", "int", "float", "bool", "null", "map", "seq"].map((name) => `tag:yaml.org,2002:${name}`));

/** { data, problem }: data only, with no tags for a parser to act on and no aliases to expand. */
export function plainYaml(text) {
  const doc = parseDocument(text);
  if (doc.errors.length) return { problem: "That isn't valid YAML" };
  // An unresolved tag is a warning, and can leave its node untagged.
  let problem = doc.warnings.length ? "YAML tags aren't allowed" : null;
  visit(doc, {
    Alias: () => void (problem = "YAML aliases aren't allowed"),
    Node: (_, node) => void (node.tag && !CORE.has(node.tag) && (problem = "YAML tags aren't allowed")),
  });
  return problem ? { problem } : { data: doc.toJS(), problem: null };
}
