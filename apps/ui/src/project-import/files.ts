export interface ImportFile {
  path: string;
  file: { size: number };
  kind: "code" | "conversation";
}
export const supportsLocalImport = false;
export async function selectImportFiles(_kind: "code" | "conversation"): Promise<ImportFile[]> {
  return [];
}
export async function readImportChunk(
  _file: ImportFile["file"],
  _offset: number,
  _bytes: number,
): Promise<string> {
  throw new Error("Local directory selection is unavailable on this platform");
}
