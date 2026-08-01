import { readManifest } from "./library.js";

const manifest = await readManifest();
const budgets = {
  total: 80 * 1024 * 1024,
  onnx: 45 * 1024 * 1024,
  glb: 18 * 1024 * 1024,
  gltf: 18 * 1024 * 1024,
  ktx2: 12 * 1024 * 1024,
  mp3: 4 * 1024 * 1024,
  ogg: 4 * 1024 * 1024,
} as const;
const total = manifest.assets.reduce((sum, asset) => sum + asset.bytes, 0);
const errors: string[] = [];
if (total > budgets.total)
  errors.push(`Total asset bytes ${total} exceed ${budgets.total}`);
for (const asset of manifest.assets) {
  const budget = budgets[asset.kind as keyof typeof budgets];
  if (budget && asset.bytes > budget)
    errors.push(
      `${asset.path} is ${asset.bytes} bytes; ${asset.kind} budget is ${budget}`,
    );
}
console.log(
  JSON.stringify(
    { totalBytes: total, assetCount: manifest.assets.length, budgets },
    null,
    2,
  ),
);
if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
}
