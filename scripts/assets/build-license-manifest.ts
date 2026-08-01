import { writeFile } from "node:fs/promises";

import { licenseManifestPath, readManifest } from "./library.js";

const manifest = await readManifest();
const errors: string[] = [];
const assets = manifest.assets.map((asset) => {
  if (!asset.author) errors.push(`${asset.path}: missing author`);
  if (!asset.license) errors.push(`${asset.path}: missing license`);
  if (!asset.source && !asset.originalWork)
    errors.push(`${asset.path}: missing source or originalWork marker`);
  if (!/^[a-f0-9]{64}$/.test(asset.sha256))
    errors.push(`${asset.path}: invalid SHA-256`);
  return {
    id: asset.id,
    path: asset.path,
    author: asset.author,
    license: asset.license,
    source: asset.source,
    originalWork: asset.originalWork ?? false,
    sha256: asset.sha256,
  };
});
if (process.argv.includes("--check")) {
  if (errors.length > 0) {
    console.error(errors.join("\n"));
    process.exitCode = 1;
  } else {
    console.log(`License metadata is complete for ${assets.length} assets`);
  }
} else {
  await writeFile(
    licenseManifestPath,
    `${JSON.stringify({ schemaVersion: 1, assets }, null, 2)}\n`,
  );
  console.log(
    `Wrote ${assets.length} license records to ${licenseManifestPath}`,
  );
}
