export function inspectMediaBytes(
  bytes: Uint8Array,
  mimeType: string,
  maxBytes: number
): { kind: "image" | "video"; extension: string } | null;
