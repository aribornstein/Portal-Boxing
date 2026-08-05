import { writeFile } from "node:fs/promises";

import { inventoryAssets, manifestPath, readManifest } from "./library.js";

const existing = await readManifest();
const metadata = new Map(existing.assets.map((asset) => [asset.path, asset]));
const assets = (await inventoryAssets()).map((asset) => ({
  ...metadata.get(asset.path),
  ...(asset.path.startsWith("audio/")
    ? {
        author: "PORTALAR project",
        license: "Project-owned original",
        originalWork: true,
      }
    : {}),
  ...asset,
}));
await writeFile(
  manifestPath,
  `${JSON.stringify({ schemaVersion: 1, assets }, null, 2)}\n`,
);
console.log(`Wrote ${assets.length} asset records to ${manifestPath}`);
