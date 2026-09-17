import { importInsomnia } from "./insomnia.js";
import { importInsomniaV5, isInsomniaV5, type ImportOptions, type ImportPayload } from "./insomnia5.js";

export type ImportFormat = "insomnia-v4" | "insomnia-v5";

export interface ImportResult extends ImportPayload {
  format: ImportFormat;
  /** Collection name, when the file carries one. */
  sourceName?: string;
}

/** Accepts JSON and YAML — the YAML parser is only downloaded when needed. */
async function parseDocument(text: string): Promise<unknown> {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return JSON.parse(trimmed);
    } catch {
      // Not valid JSON; fall through to YAML below.
    }
  }
  const { parse } = await import("yaml");
  try {
    return parse(trimmed);
  } catch (err) {
    throw new Error(
      `Could not read the file as JSON or as YAML. ${err instanceof Error ? err.message : ""}`.trim(),
    );
  }
}

/**
 * Imports an Insomnia export without being told the version: v5 comes as YAML
 * with `type: collection.insomnia.rest`, v4 as JSON with `resources`.
 */
export async function importInsomniaExport(
  text: string,
  opts: ImportOptions,
): Promise<ImportResult> {
  const doc = await parseDocument(text);

  if (isInsomniaV5(doc)) {
    const payload = importInsomniaV5(doc, opts);
    const name = (doc as { name?: string }).name;
    return { ...payload, format: "insomnia-v5", sourceName: name };
  }

  if (doc && typeof doc === "object" && Array.isArray((doc as { resources?: unknown }).resources)) {
    const payload = importInsomnia(doc, opts);
    return { ...payload, format: "insomnia-v4", warnings: [] };
  }

  throw new Error(
    "Unrecognized format. Expected an Insomnia export: v5 (YAML, starting with 'type: collection.insomnia.rest/5.0') or v4 (JSON, with the 'resources' field).",
  );
}
