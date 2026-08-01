import path from "node:path";
import { stat } from "node:fs/promises";

import {
  findDuplicateHashes,
  readManifest,
  runtimeRoot,
  validateGltf,
} from "./library.js";

const manifest = await readManifest();
const errors: string[] = [];
const ids = new Set<string>();
for (const asset of manifest.assets) {
  if (ids.has(asset.id)) errors.push(`Duplicate asset id: ${asset.id}`);
  ids.add(asset.id);
  const filePath = path.resolve(runtimeRoot, asset.path);
  if (!filePath.startsWith(`${runtimeRoot}${path.sep}`)) {
    errors.push(`Asset path escapes runtime root: ${asset.path}`);
    continue;
  }
  try {
    await stat(filePath);
  } catch {
    errors.push(`Missing asset: ${asset.path}`);
  }
  if (asset.kind === "gltf") errors.push(...(await validateGltf(filePath)));
}
for (const [, files] of findDuplicateHashes(manifest.assets))
  errors.push(`Duplicate asset content: ${files.join(", ")}`);
if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Validated ${manifest.assets.length} production assets`);
}
