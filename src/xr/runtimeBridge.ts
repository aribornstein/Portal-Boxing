import {
  createSystem,
  DepthSensingSystem,
  VisibilityState,
  XRMesh,
  XRPlane,
} from "@iwsdk/core";

export type LiveSessionState = "browser" | "immersive" | "interrupted";
export type LiveDepthState = "cpu" | "gpu-only" | "unavailable";

export interface LiveXRStatus {
  readonly session: LiveSessionState;
  readonly enabledFeatures: readonly string[];
  readonly leftHand: boolean;
  readonly rightHand: boolean;
  readonly depth: LiveDepthState;
  readonly planeCount: number;
  readonly meshCount: number;
  readonly semanticLabels: readonly string[];
}

export type LiveXRStatusListener = (status: LiveXRStatus) => void;

const browserStatus: LiveXRStatus = {
  session: "browser",
  enabledFeatures: [],
  leftHand: false,
  rightHand: false,
  depth: "unavailable",
  planeCount: 0,
  meshCount: 0,
  semanticLabels: [],
};

export class XRRuntimeBridgeSystem extends createSystem({
  planes: { required: [XRPlane] },
  meshes: { required: [XRMesh] },
}) {
  private readonly listeners = new Set<LiveXRStatusListener>();
  private status: LiveXRStatus = browserStatus;
  private statusSignature = "";
  private nextPublishTime = 0;
  private depthSystem: DepthSensingSystem | undefined;

  init() {
    this.depthSystem = this.world.getSystem(DepthSensingSystem);
    const publishSoon = () => {
      this.nextPublishTime = 0;
    };
    this.renderer.xr.addEventListener("sessionstart", publishSoon);
    this.renderer.xr.addEventListener("sessionend", publishSoon);
    this.cleanupFuncs.push(() => {
      this.renderer.xr.removeEventListener("sessionstart", publishSoon);
      this.renderer.xr.removeEventListener("sessionend", publishSoon);
      this.listeners.clear();
    });
  }

  update(_delta: number, time: number) {
    if (time < this.nextPublishTime) return;
    this.nextPublishTime = time + 0.25;
    this.publish(this.readStatus());
  }

  subscribe(listener: LiveXRStatusListener) {
    this.listeners.add(listener);
    listener(this.status);
    return () => this.listeners.delete(listener);
  }

  get currentStatus() {
    return this.status;
  }

  private readStatus(): LiveXRStatus {
    const session = this.renderer.xr.getSession();
    const semanticLabels = new Set<string>();
    for (const entity of this.queries.meshes.entities) {
      const label = entity.getValue(XRMesh, "semanticLabel");
      if (label) semanticLabels.add(label);
    }
    return {
      session: !session
        ? "browser"
        : this.visibilityState.value === VisibilityState.VisibleBlurred
          ? "interrupted"
          : "immersive",
      enabledFeatures: [...(session?.enabledFeatures ?? [])].sort(),
      leftHand: Boolean(this.input.xr.getPrimaryInputSource("left")?.hand),
      rightHand: Boolean(this.input.xr.getPrimaryInputSource("right")?.hand),
      depth: this.depthSystem?.cpuDepthData[0]
        ? "cpu"
        : this.depthSystem?.gpuDepthData[0]
          ? "gpu-only"
          : "unavailable",
      planeCount: this.queries.planes.entities.size,
      meshCount: this.queries.meshes.entities.size,
      semanticLabels: [...semanticLabels].sort(),
    };
  }

  private publish(status: LiveXRStatus) {
    const signature = JSON.stringify(status);
    if (signature === this.statusSignature) return;
    this.status = status;
    this.statusSignature = signature;
    for (const listener of this.listeners) listener(status);
  }
}
