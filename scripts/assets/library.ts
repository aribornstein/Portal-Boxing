import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

export const runtimeRoot = path.resolve("public-runtime/assets");
export const manifestPath = path.join(runtimeRoot, "manifests/assets.json");
export const licenseManifestPath = path.join(
  runtimeRoot,
  "manifests/licenses.json",
);

export interface AssetRecord {
  readonly id: string;
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly kind: string;
  readonly source?: string;
  readonly author?: string;
  readonly license?: string;
  readonly originalWork?: boolean;
}

export interface AssetManifest {
  readonly schemaVersion: 1;
  readonly assets: readonly AssetRecord[];
}

export async function readManifest(
  filePath = manifestPath,
): Promise<AssetManifest> {
  const parsed: unknown = JSON.parse(await readFile(filePath, "utf8"));
  if (!isManifest(parsed))
    throw new Error(`${filePath} is not a valid asset manifest`);
  return parsed;
}

export async function inventoryAssets(): Promise<AssetRecord[]> {
  const files = await walk(runtimeRoot);
  const records: AssetRecord[] = [];
  for (const file of files) {
    const relativePath = path
      .relative(runtimeRoot, file)
      .split(path.sep)
      .join("/");
    if (relativePath.startsWith("manifests/")) continue;
    const data = await readFile(file);
    records.push({
      id: relativePath.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, ""),
      path: relativePath,
      bytes: data.byteLength,
      sha256: createHash("sha256").update(data).digest("hex"),
      kind: path.extname(relativePath).slice(1).toLowerCase() || "unknown",
    });
  }
  return records.sort((left, right) => left.path.localeCompare(right.path));
}

export async function validateGltf(filePath: string) {
  const parsed = JSON.parse(await readFile(filePath, "utf8")) as {
    asset?: { version?: string };
    buffers?: Array<{ uri?: string }>;
    images?: Array<{ uri?: string }>;
    materials?: Array<{ name?: string; extensions?: Record<string, unknown> }>;
    animations?: Array<{ name?: string }>;
  };
  const errors: string[] = [];
  if (parsed.asset?.version !== "2.0")
    errors.push(`${filePath}: glTF version must be 2.0`);
  if ((parsed.materials?.length ?? 0) > 24)
    errors.push(`${filePath}: material count exceeds 24`);
  parsed.animations?.forEach((animation, index) => {
    if (!animation.name?.trim())
      errors.push(`${filePath}: animation ${index} has no name`);
  });
  for (const dependency of [
    ...(parsed.buffers ?? []),
    ...(parsed.images ?? []),
  ]) {
    if (!dependency.uri || dependency.uri.startsWith("data:")) continue;
    const dependencyPath = path.resolve(path.dirname(filePath), dependency.uri);
    try {
      await stat(dependencyPath);
    } catch {
      errors.push(`${filePath}: missing dependency ${dependency.uri}`);
    }
  }
  return errors;
}

export function findDuplicateHashes(assets: readonly AssetRecord[]) {
  const byHash = new Map<string, string[]>();
  for (const asset of assets)
    byHash.set(asset.sha256, [...(byHash.get(asset.sha256) ?? []), asset.path]);
  return [...byHash.entries()].filter(([, files]) => files.length > 1);
}

async function walk(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const results: string[] = [];
  for (const entry of entries) {
    const child = path.join(directory, entry.name);
    if (entry.isDirectory()) results.push(...(await walk(child)));
    else if (entry.isFile()) results.push(child);
  }
  return results;
}

function isManifest(value: unknown): value is AssetManifest {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<AssetManifest>;
  return candidate.schemaVersion === 1 && Array.isArray(candidate.assets);
}
