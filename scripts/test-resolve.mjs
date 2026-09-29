// Module resolution for `npm test`: node:test runs the app's .ts sources with
// Node's built-in type stripping. Metro and tsc resolve the app's imports on
// their own; plain Node can't, so this fills the gaps:
//   - "@/..." is the repo root (tsconfig "paths");
//   - app imports leave out the extension ("./dates" → "./dates.ts");
//   - the app's .ts files are ES modules (package.json can't say
//     "type": "module" without breaking the CommonJS configs Metro and ESLint
//     load);
//   - "react-native" can't load in Node, so it maps to a small stub.
// Test-only: nothing in the app imports this file.
import { statSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = new URL("../", import.meta.url);

const STUBS = {
  "react-native": new URL("./test-stubs/react-native.mjs", import.meta.url).href,
};

// Only what Node can strip: .tsx (JSX) can't run under `npm test`.
const SUFFIXES = ["", ".ts", "/index.ts"];

function isFile(path) {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function isAppFile(url) {
  return url != null && url.startsWith("file:") && !url.includes("/node_modules/");
}

/** "@/…" and extensionless relative imports from app files → a file URL. */
function findAppFile(specifier, parentURL) {
  let base = null;
  if (specifier.startsWith("@/")) {
    base = new URL(specifier.slice(2), ROOT);
  } else if (isAppFile(parentURL) && (specifier.startsWith("./") || specifier.startsWith("../"))) {
    base = new URL(specifier, parentURL);
  }
  if (base == null) return null;
  const path = fileURLToPath(base);
  for (const suffix of SUFFIXES) {
    if (isFile(path + suffix)) return pathToFileURL(path + suffix).href;
  }
  return null;
}

export function resolve(specifier, context, nextResolve) {
  const stub = STUBS[specifier];
  if (stub != null) return { url: stub, format: "module", shortCircuit: true };

  const found = findAppFile(specifier, context.parentURL);
  const result = found != null ? { url: found, shortCircuit: true } : nextResolve(specifier, context);
  if (isAppFile(result.url) && result.url.endsWith(".ts")) {
    return { ...result, format: "module-typescript" };
  }
  return result;
}
