export interface ImportFile {
  path: string;
  file: File;
  kind: "code" | "conversation";
}
const EXCLUDED =
  /(?:^|\/)(?:\.git|node_modules|\.env(?:\.[^/]*)?|credentials(?:\.json)?|auth\.json)(?:\/|$)/i;

export const supportsLocalImport =
  typeof document !== "undefined" && "webkitdirectory" in document.createElement("input");
export function selectImportFiles(kind: "code" | "conversation"): Promise<ImportFile[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    if (kind === "code") input.setAttribute("webkitdirectory", "");
    else input.accept = ".jsonl";
    input.addEventListener("cancel", () => resolve([]), { once: true });
    input.addEventListener(
      "change",
      () =>
        resolve(
          Array.from(input.files ?? []).flatMap((file) => {
            const relative =
              kind === "code" ? file.webkitRelativePath.split("/").slice(1).join("/") : file.name;
            return EXCLUDED.test(relative) ? [] : [{ path: relative, file, kind }];
          }),
        ),
      { once: true },
    );
    input.click();
  });
}
export async function readImportChunk(file: File, offset: number, bytes: number): Promise<string> {
  const data = new Uint8Array(await file.slice(offset, offset + bytes).arrayBuffer());
  let binary = "";
  for (const byte of data) binary += String.fromCharCode(byte);
  return btoa(binary);
}
