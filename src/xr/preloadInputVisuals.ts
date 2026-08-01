import { AssetManager, CacheManager, type World } from "@iwsdk/core";

import { XR_INPUT_VISUAL_ASSETS } from "./inputVisualAssets.js";

export async function preloadLocalInputVisuals(world: World) {
  await Promise.all(
    XR_INPUT_VISUAL_ASSETS.map(async ({ localUrl, profileUrl }) => {
      const gltf = await AssetManager.loadGLTF(localUrl);
      CacheManager.setAsset(profileUrl, gltf);
    }),
  );
  world.input.xr.visualAdapters.controller.left.toggleVisual(false);
  world.input.xr.visualAdapters.controller.right.toggleVisual(false);
}
