export type CapabilityStatus =
  "available" | "unavailable" | "session-check" | "blocked";

export interface CapabilityItem {
  readonly id: string;
  readonly label: string;
  readonly status: CapabilityStatus;
  readonly detail: string;
}

export interface CapabilitySnapshot {
  readonly items: readonly CapabilityItem[];
  readonly deviceMode: "emulator" | "physical-quest" | "desktop";
  readonly modelCache: "cached" | "missing" | "unsupported";
}

export function localVisionInferenceCapability(options: {
  readonly cameraFramesAvailable: boolean;
  readonly modelCache: CapabilitySnapshot["modelCache"];
}): CapabilityItem {
  if (!options.cameraFramesAvailable) {
    return {
      id: "vision-inference",
      label: "Raw RGB vision inference",
      status: "blocked",
      detail:
        "Raw RGB frames are unavailable; physical contact observations use Quest camera depth instead",
    };
  }
  if (options.modelCache !== "cached") {
    return {
      id: "vision-inference",
      label: "Raw RGB vision inference",
      status: "blocked",
      detail: "No verified quantized local model artifact is packaged",
    };
  }
  return {
    id: "vision-inference",
    label: "Raw RGB vision inference",
    status: "available",
    detail: "Same-origin model and supported frame input are available",
  };
}

export async function detectCapabilities(): Promise<CapabilitySnapshot> {
  const webXr = "xr" in navigator;
  const immersiveAr =
    webXr &&
    (await navigator.xr?.isSessionSupported("immersive-ar").catch(() => false));
  const modelCache =
    "caches" in globalThis
      ? (await caches.match("./assets/models/siglip2-vision.onnx"))
        ? "cached"
        : "missing"
      : "unsupported";
  const userAgent = navigator.userAgent.toLowerCase();
  const deviceMode = userAgent.includes("iwer")
    ? "emulator"
    : userAgent.includes("quest")
      ? "physical-quest"
      : "desktop";
  const sessionDetail = immersiveAr
    ? "Requested as an optional WebXR session feature; verified after session start"
    : "Requires an immersive-ar session or the IWSDK emulator";
  return {
    deviceMode,
    modelCache,
    items: [
      item(
        "webxr",
        "WebXR",
        webXr,
        webXr ? "navigator.xr is present" : "WebXR is unavailable",
      ),
      item(
        "immersive-ar",
        "Immersive AR",
        Boolean(immersiveAr),
        immersiveAr
          ? "Session mode is supported"
          : "Use desktop simulation or a compatible headset",
      ),
      pending("hands", "Hand tracking", sessionDetail),
      pending(
        "depth",
        "Quest camera depth",
        immersiveAr
          ? "Required camera-derived metric depth; session starts only when WebXR grants it"
          : sessionDetail,
      ),
      pending("scene", "Scene understanding", sessionDetail),
      pending("planes", "Planes and meshes", sessionDetail),
      item(
        "webgpu",
        "WebGPU compute",
        "gpu" in navigator,
        "gpu" in navigator
          ? "Available for verified local workloads; not used by current scene labeling"
          : "Unavailable; current scene labeling does not require it",
      ),
      localVisionInferenceCapability({
        cameraFramesAvailable: false,
        modelCache,
      }),
      {
        id: "model",
        label: "Optional model artifact",
        status: modelCache === "cached" ? "available" : "blocked",
        detail:
          modelCache === "cached"
            ? "Local model is cached"
            : "No verified quantized SigLIP2 ONNX artifact is packaged",
      },
    ],
  };
}

function item(
  id: string,
  label: string,
  available: boolean,
  detail: string,
): CapabilityItem {
  return { id, label, status: available ? "available" : "unavailable", detail };
}

function pending(id: string, label: string, detail: string): CapabilityItem {
  return { id, label, status: "session-check", detail };
}
