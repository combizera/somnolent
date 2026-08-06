import { importInsomnia } from "./insomnia.js";
import { importInsomniaV5, isInsomniaV5, type ImportOptions, type ImportPayload } from "./insomnia5.js";

export type ImportFormat = "insomnia-v4" | "insomnia-v5";

export interface ImportResult extends ImportPayload {
  format: ImportFormat;
  /** Nome da collection, quando o arquivo traz um. */
  sourceName?: string;
}

/** Aceita JSON e YAML — o parser de YAML só é baixado quando faz falta. */
async function parseDocument(text: string): Promise<unknown> {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return JSON.parse(trimmed);
    } catch {
      // Não era JSON válido; tenta como YAML abaixo.
    }
  }
  const { parse } = await import("yaml");
  try {
    return parse(trimmed);
  } catch (err) {
    throw new Error(
      `Não consegui ler o arquivo como JSON nem como YAML. ${err instanceof Error ? err.message : ""}`.trim(),
    );
  }
}

/**
 * Importa um export do Insomnia sem precisar dizer a versão: v5 vem em YAML com
 * `type: collection.insomnia.rest`, v4 vem em JSON com `resources`.
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
    "Formato não reconhecido. Esperava um export do Insomnia: v5 (YAML, começa com 'type: collection.insomnia.rest/5.0') ou v4 (JSON, com o campo 'resources').",
  );
}
