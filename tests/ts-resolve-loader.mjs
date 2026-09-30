/** Resolve extensionless relative imports used by Pages Functions in Node tests. */
import { access } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith(".") && context.parentURL?.startsWith("file:")) {
    const candidate=path.resolve(path.dirname(fileURLToPath(context.parentURL)),specifier);
    for (const ext of [".ts",".js"]) { try { await access(candidate+ext); return {url:pathToFileURL(candidate+ext).href,shortCircuit:true}; } catch {} }
  }
  return nextResolve(specifier,context);
}
