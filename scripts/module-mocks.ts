import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";

// Replaces modules for the verify scripts. The package is ESM (vinext needs "type": "module"),
// so patching Module._load no longer reaches lib/ imports. module.registerHooks sees both
// import and require, and a mock is served as an ES module that re-exports the object's keys.

type MockFactory = (request: string, parentPath: string | undefined) => object | undefined;

const PREFIX = "deni-mock:";
const mocks = new Map<string, object>();
let factory: MockFactory | undefined;
let nextId = 0;

registerHooks({
  resolve(specifier, context, nextResolve) {
    const parentPath = context.parentURL?.startsWith("file:")
      ? fileURLToPath(context.parentURL)
      : undefined;
    const mock = factory?.(specifier, parentPath);
    if (!mock) return nextResolve(specifier, context);
    const id = String(nextId++);
    mocks.set(id, mock);
    return { url: PREFIX + id, format: "module", shortCircuit: true };
  },
  load(url, context, nextLoad) {
    if (!url.startsWith(PREFIX)) return nextLoad(url, context);
    const id = url.slice(PREFIX.length);
    const names = Object.keys(mocks.get(id) ?? {}).filter(
      (name) => name !== "default" && /^[A-Za-z_$][\w$]*$/.test(name),
    );
    const source = [
      `const mock = globalThis.__deniModuleMocks.get(${JSON.stringify(id)});`,
      "export default mock;",
      ...names.map((name) => `export const ${name} = mock[${JSON.stringify(name)}];`),
    ].join("\n");
    return { format: "module", source, shortCircuit: true };
  },
});

(globalThis as { __deniModuleMocks?: Map<string, object> }).__deniModuleMocks = mocks;

/** Serves the factory's object for matching imports until the returned function is called. */
export function mockModules(next: MockFactory): () => void {
  factory = next;
  return () => {
    if (factory === next) factory = undefined;
  };
}
