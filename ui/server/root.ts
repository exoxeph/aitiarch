import { realpath, stat } from "node:fs/promises";
import path from "node:path";

/** The root IS the notebook folder. An override never gains another .aitiarch. */
export async function resolveRoot(options: { cwd?: string; root?: string } = {}): Promise<string> {
  if (options.root !== undefined && !options.root.trim()) throw new Error("Empty notebook root.");
  const target = path.resolve(options.cwd ?? process.cwd(), options.root ?? ".aitiarch");
  const canonical = await realpath(target);
  if (!(await stat(canonical)).isDirectory()) throw new Error("Notebook root must be a directory.");
  return canonical;
}
