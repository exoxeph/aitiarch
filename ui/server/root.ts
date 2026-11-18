import { stat } from "node:fs/promises";
import path from "node:path";
import {canonicalPath,isLocalAbsolute} from "./paths.ts";

/** The root IS the notebook folder. An override never gains another .aitiarch. */
export async function resolveRoot(options: { cwd?: string; root?: string } = {}): Promise<string> {
  if (options.root !== undefined && !options.root.trim()) throw new Error("Empty notebook root.");
  const target = path.resolve(options.cwd ?? process.cwd(), options.root ?? ".aitiarch");
  if (isLocalAbsolute(target)) throw new Error("Notebook root cannot be inside private local storage.");
  const canonical = await canonicalPath(target);
  if (isLocalAbsolute(canonical)) throw new Error("Notebook root cannot be inside private local storage.");
  if (!(await stat(canonical)).isDirectory()) throw new Error("Notebook root must be a directory.");
  return canonical;
}
