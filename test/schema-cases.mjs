// Invalid-args cases read from schemas/args.schema.json (SECOND-TESTS-DOCS-4): for every field the
// schema names, a case with a required field missing and cases with a value of the wrong type or
// outside the schema's constraints, each a single change to a valid base. Not a test file itself.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const ARGS_SCHEMA = JSON.parse(readFileSync(join(ROOT, 'schemas', 'args.schema.json'), 'utf8'));

const clone = (v) => JSON.parse(JSON.stringify(v));

function resolve(node, root) {
  if (node && node.$ref) return resolve(node.$ref.replace(/^#\//, '').split('/').reduce((n, k) => n[k], root), root);
  return node;
}

// The oneOf branch the value fits by its const `kind` (the host), or the first.
function branchFor(node, value, root) {
  const branches = node.oneOf.map((b) => resolve(b, root));
  return branches.find((b) => b.properties?.kind?.const !== undefined && value?.kind === b.properties.kind.const) ?? branches[0];
}

// Values the schema node refuses, each with a name. The value is assumed to fit the node.
function badValues(node) {
  const out = [];
  const type = node.type;
  if (type === 'string') out.push(['a number', 7], ['an array', ['x']]);
  if (type === 'integer') out.push(['a string', '0'], ['a fraction', 1.5]);
  if (type === 'array') out.push(['a string', 'x'], ['an object', {}]);
  if (type === 'object') out.push(['a string', 'x'], ['an array', []], ['null', null]);
  if (node.minLength >= 1) out.push(['empty', '']);
  if (node.minItems >= 1) out.push(['empty', []]);
  if (node.minimum !== undefined) out.push(['below the minimum', node.minimum - 1]);
  if (node.pattern !== undefined) out.push(['not matching its pattern', 'Not A_Pattern']);
  if (node.const !== undefined) out.push(['not its const', `${node.const}-other`]);
  return out;
}

const setAt = (obj, path, v) => {
  const last = path[path.length - 1];
  const parent = path.slice(0, -1).reduce((o, k) => o[k], obj);
  parent[last] = v;
};
const deleteAt = (obj, path) => {
  const last = path[path.length - 1];
  const parent = path.slice(0, -1).reduce((o, k) => o[k], obj);
  delete parent[last];
};

// Each case: {name, args, field}, where field is the name the refusal must mention.
export function schemaCases(base, { schema = ARGS_SCHEMA, only } = {}) {
  const cases = [];
  const walk = (rawNode, value, path, field) => {
    let node = resolve(rawNode, schema);
    if (node.oneOf) node = branchFor(node, value, schema);
    const where = path.join('.');
    if (path.length > 0) {
      for (const [what, v] of badValues(node)) {
        const args = clone(base);
        setAt(args, path, v);
        cases.push({ name: `${where} ${what}`, args, field });
      }
    }
    if (node.type === 'object' && value && typeof value === 'object' && !Array.isArray(value)) {
      const props = node.properties ?? {};
      for (const key of node.required ?? []) {
        if (path.length === 0 && only && !only.includes(key)) continue;
        const args = clone(base);
        deleteAt(args, [...path, key]);
        cases.push({ name: `${[...path, key].join('.')} missing`, args, field: key });
      }
      for (const [key, sub] of Object.entries(props)) {
        if (path.length === 0 && only && !only.includes(key)) continue;
        if (value[key] === undefined) continue;
        walk(sub, value[key], [...path, key], key);
      }
      if (node.additionalProperties && typeof node.additionalProperties === 'object') {
        for (const key of Object.keys(value).filter((k) => !(k in props))) {
          walk(node.additionalProperties, value[key], [...path, key], field);
        }
      }
    }
    if (node.type === 'array' && node.items && Array.isArray(value) && value.length > 0) {
      walk(node.items, value[0], [...path, 0], field);
    }
  };
  walk(schema, base, [], '');
  return cases;
}

// Does some error name the field (or, for a plural, its singular: answers -> "answer for ...")?
export const namesField = (errors, field) =>
  errors.some((e) => e.includes(field) || (field.endsWith('s') && e.includes(field.slice(0, -1))));
