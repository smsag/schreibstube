import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { HIDDEN_NODE_GLOBALS, WORKER_PRELUDE, withWorkerPrelude } from "./worker-prelude";

/**
 * A Worker with Node integration, as far as the prelude can tell: a global
 * scope with no `window` and Node's names on it. Run in a context of its own,
 * so hiding them never touches the test runner's.
 */
function nodeWorkerScope(): Record<string, unknown> {
  const scope: Record<string, unknown> = {};
  for (const name of HIDDEN_NODE_GLOBALS) scope[name] = { name };
  return scope;
}

/** What code after the prelude sees, by bare name and on the global object. */
const PROBE = `
  seen = {
    bare: [${HIDDEN_NODE_GLOBALS.map((name) => `typeof ${name}`).join(", ")}],
    property: [${HIDDEN_NODE_GLOBALS.map((name) => `typeof globalThis.${name}`).join(", ")}]
  };
`;

function run(scope: Record<string, unknown>): { bare: string[]; property: string[] } {
  // A classic script stands in for the module here. The names are configurable
  // in this scope, so its top-level `const`s are allowed; a locked-down name
  // would be a SyntaxError in a script and is fine in a module, which this
  // runner cannot start without an experimental flag.
  runInNewContext(`${WORKER_PRELUDE}\n${PROBE}`, scope);
  return scope.seen as { bare: string[]; property: string[] };
}

describe("the Worker prelude", () => {
  it("hides every Node name a Worker is given, by bare name and on the global", () => {
    const bare = nodeWorkerScope();
    runInNewContext(PROBE, bare);
    expect((bare.seen as { bare: string[] }).bare.every((type) => type === "object")).toBe(true);

    const seen = run(nodeWorkerScope());
    expect(seen.bare.every((type) => type === "undefined")).toBe(true);
    expect(seen.property.every((type) => type === "undefined")).toBe(true);
  });

  it("names require and module, the two that reach the machine", () => {
    expect(HIDDEN_NODE_GLOBALS).toEqual(expect.arrayContaining(["process", "require", "module"]));
  });

  it("goes in front of the bundle, so nothing in it runs first", () => {
    expect(withWorkerPrelude("export {};").startsWith(WORKER_PRELUDE)).toBe(true);
  });
});
