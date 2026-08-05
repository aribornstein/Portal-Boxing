import {
  DepthSensingSystem,
  ReferenceSpaceType,
  SessionMode,
  VisibilityState,
  World,
  type World as WorldInstance,
} from "@iwsdk/core";

import {
  type LiveXRStatus,
  XRRuntimeBridgeSystem,
} from "../xr/runtimeBridge.js";
import { CombatAudioSystem } from "../audio/combatAudioSystem.js";
import { GameplayPresentationSystem } from "../gameplay/presentationSystem.js";
import { HandCombatSystem } from "../combat/handCombatSystem.js";
import { EnemyCombatSystem } from "../combat/enemyCombatSystem.js";
import {
  KickCombatSystem,
  type PhysicalContactDiagnostic,
} from "../combat/physicalContactSystem.js";
import { RoomCaptureSystem } from "../room/roomCaptureSystem.js";
import { DepthSafetySystem } from "../xr/depthSafetySystem.js";
import { preloadLocalInputVisuals } from "../xr/preloadInputVisuals.js";
import { PanelSystem } from "../panel.js";
import { detectCapabilities } from "./capabilities.js";
import { GameSimulation, type SimulationSnapshot } from "./gameSimulation.js";

export async function bootstrap() {
  const container = document.querySelector<HTMLDivElement>("#scene-container");
  const app = document.querySelector<HTMLElement>("#app");
  if (!container || !app) throw new Error("Application containers are missing");

  const simulation = new GameSimulation();
  renderShell(app, simulation);
  renderCapabilities(app, await detectCapabilities());

  let world: WorldInstance | undefined;
  try {
    world = await World.create(container, {
      xr: {
        sessionMode: SessionMode.ImmersiveAR,
        offer: "none",
        referenceSpace: {
          type: ReferenceSpaceType.BoundedFloor,
          fallbackOrder: [
            ReferenceSpaceType.LocalFloor,
            ReferenceSpaceType.Local,
          ],
        },
        features: {
          handTracking: true,
          anchors: true,
          hitTest: true,
          planeDetection: true,
          meshDetection: true,
          lightEstimation: true,
          depthSensing: {
            required: true,
            usage: "gpu-optimized",
            format: "float32",
          },
          layers: true,
        },
      },
      render: {
        defaultLighting: false,
        stencil: true,
        camera: { position: [0, 1.6, 3], lookAt: [0, 1.2, 0] },
      },
      features: {
        locomotion: false,
        grabbing: false,
        physics: false,
        sceneUnderstanding: { showWireFrame: false },
        environmentRaycast: true,
        camera: false,
      },
    });
    await preloadLocalInputVisuals(world).catch((error: unknown) => {
      console.warn(
        "Local input visuals unavailable; tracking will continue",
        error,
      );
    });
    world.globals.portalBoxingSimulation = simulation;
    world.registerSystem(DepthSensingSystem);
    world.registerSystem(DepthSafetySystem, { priority: 0.25 });
    world.registerSystem(XRRuntimeBridgeSystem);
    world.registerSystem(RoomCaptureSystem);
    world.registerSystem(PanelSystem);
    world.registerSystem(GameplayPresentationSystem);
    world.registerSystem(CombatAudioSystem);
    world.registerSystem(EnemyCombatSystem);
    world.registerSystem(HandCombatSystem, { priority: 0.5 });
    world.registerSystem(KickCombatSystem, { priority: 0.6 });
    const runtimeBridge = world.getSystem(XRRuntimeBridgeSystem);
    const unsubscribeRuntime = runtimeBridge?.subscribe((status) =>
      renderLiveXRStatus(app, status),
    );
    const physicalContactSystem = world.getSystem(KickCombatSystem);
    const unsubscribePhysicalContact =
      physicalContactSystem?.subscribeDiagnostics((diagnostic) =>
        renderPhysicalContactDiagnostic(app, diagnostic),
      );
    const unsubscribePhysicalDebug =
      physicalContactSystem?.subscribeDebugVisibility((enabled) =>
        renderPhysicalDebugVisibility(app, enabled),
      );
    simulation.markRuntimeReady();
    const unsubscribeVisibility = world.visibilityState.subscribe(
      (visibility) => {
        if (visibility === VisibilityState.VisibleBlurred) {
          simulation.pause("XR visibility interrupted; threats paused", true);
        } else if (visibility === VisibilityState.Visible) {
          simulation.resume("XR visibility restored; combat resumed");
        }
      },
    );
    window.addEventListener(
      "pagehide",
      () => {
        unsubscribeVisibility();
        unsubscribeRuntime?.();
        unsubscribePhysicalContact?.();
        unsubscribePhysicalDebug?.();
      },
      { once: true },
    );
  } catch (error) {
    console.error("IWSDK bootstrap failed", error);
    setText(app, "status", "FATAL_ERROR: IWSDK failed to initialize");
  }

  bindCommands(
    app,
    simulation,
    () => {
      world?.launchXR();
    },
    () => {
      const capture = world?.getSystem(RoomCaptureSystem)?.capture();
      if (!capture) throw new Error("Live room capture is unavailable");
      simulation.loadRoomObservations(
        capture.observations,
        capture.playerPosition,
      );
    },
    () => {
      const system = world?.getSystem(KickCombatSystem);
      if (!system) throw new Error("Physical contact system is unavailable");
      system.setDebugVisible(!system.isDebugVisible);
    },
  );
  if ("serviceWorker" in navigator && globalThis.isSecureContext) {
    const isDev = (
      import.meta as ImportMeta & {
        readonly env: { readonly DEV: boolean };
      }
    ).env.DEV;
    if (isDev) {
      void caches
        .keys()
        .then((cacheNames) =>
          Promise.all(
            cacheNames
              .filter((cacheName) => cacheName.startsWith("portalar-shell-"))
              .map((cacheName) => caches.delete(cacheName)),
          ),
        )
        .then(() => navigator.serviceWorker.getRegistrations())
        .then((registrations) =>
          Promise.allSettled(
            registrations.map((registration) => registration.unregister()),
          ),
        )
        .catch((error: unknown) => {
          console.warn("Development cache cleanup failed", error);
        });
    } else {
      void navigator.serviceWorker
        .register("./sw.js")
        .catch((error: unknown) => {
          console.warn("Offline cache registration failed", error);
        });
    }
  }
}

function renderShell(app: HTMLElement, simulation: GameSimulation) {
  app.innerHTML = `
    <header class="topbar"><div><span class="eyebrow">PORTALAR</span><h1>Beat 'em up in your room</h1></div><div class="runtime-badge">Quest 3 / WebXR</div></header>
    <main>
      <section class="hero"><div class="hero-copy"><p class="kicker">Controller-optional mixed reality boxing</p><h2>Your room stays real.<br>The fight comes through.</h2><p>Scan the room, review uncertain objects, confirm a safe combat zone, then open a portal. Real furniture is never destroyed; only safety-approved virtual proxies can react.</p><div class="primary-actions"><button data-command="xr">Enter mixed reality</button><button class="secondary" data-command="simulate">Enter desktop simulation</button></div></div><div class="portal-preview" aria-label="Animated portal preview"><div class="portal-core"></div><div class="portal-ring"></div></div></section>
      <section class="console"><div class="status-strip"><div><span>Application</span><strong data-role="application">BOOT</strong></div><div><span>Encounter</span><strong data-role="encounter">IDLE</strong></div><div><span>Stage</span><strong data-role="stage">--</strong></div><div><span>Wave</span><strong data-role="wave">--</strong></div><div><span>Boss</span><strong data-role="boss">--</strong></div><div><span>Enemy</span><strong data-role="health">--</strong></div><div><span>Player</span><strong data-role="player-health">100/100</strong></div><div><span>Guard</span><strong data-role="guard">OPEN</strong></div><div><span>Score</span><strong data-role="score">0</strong></div></div><div class="xr-status-strip"><div><span>Session</span><strong data-role="xr-session">BROWSER</strong></div><div><span>Hands</span><strong data-role="xr-hands">0/2</strong></div><div><span>Geometry</span><strong data-role="xr-geometry">0P / 0M</strong></div><div><span>Depth</span><strong data-role="xr-depth">UNAVAILABLE</strong></div><div><span>Physical</span><strong data-role="physical-contact" data-state="idle">ARMED / START COMBAT</strong></div></div><p class="live-status" data-role="status">Runtime booting</p><div class="command-grid"><button data-command="live-room">Use live room scan</button><button data-command="room">Load room fixture</button><button data-command="confirm">Confirm labels + safety</button><button data-command="safety-bypass" class="debug-toggle" aria-pressed="false">Debug safety: enforced</button><button data-command="depth-debug" class="debug-toggle" aria-pressed="false">Depth view: off</button><button data-command="continue-bypass" class="danger" hidden>Continue without room safety</button><button data-command="portal">Open portal</button><button data-command="wave">Defeat wave</button><button data-command="phase">Advance boss phase</button><button data-command="boss">Defeat boss</button><button data-command="next-stage">Next stage</button><button data-command="pause">Emergency stop</button><button data-command="restart">Restart</button></div></section>
      <section class="capability-section"><div class="section-title"><p class="kicker">Preflight</p><h2>Capability and safety gate</h2></div><div class="capability-grid" data-role="capabilities"></div></section>
    </main>`;
  simulation.subscribe((snapshot) => renderSnapshot(app, snapshot));
}

function renderCapabilities(
  app: HTMLElement,
  snapshot: Awaited<ReturnType<typeof detectCapabilities>>,
) {
  const grid = app.querySelector<HTMLElement>("[data-role='capabilities']")!;
  const capabilities = snapshot.items
    .map(
      (capability) =>
        `<article class="capability"><span class="capability-state ${capability.status}"></span><div><strong>${capability.label}</strong><p>${capability.detail}</p></div><small>${capability.status}</small></article>`,
    )
    .join("");
  grid.innerHTML = `${capabilities}<article class="capability device"><span class="capability-state available"></span><div><strong>Runtime profile</strong><p>${snapshot.deviceMode}; quality is Balanced; safety setup is required before combat.</p></div><small>${snapshot.modelCache}</small></article>`;
}

function renderSnapshot(app: HTMLElement, snapshot: SimulationSnapshot) {
  setText(app, "application", snapshot.application);
  setText(app, "encounter", snapshot.encounter);
  setText(app, "stage", snapshot.stage?.theme ?? "--");
  setText(
    app,
    "wave",
    snapshot.waveIndex >= 0 ? `${snapshot.waveIndex + 1}/3` : "--",
  );
  setText(
    app,
    "boss",
    snapshot.encounter === "BOSS_COMBAT" ? `Phase ${snapshot.bossPhase}` : "--",
  );
  setText(
    app,
    "health",
    snapshot.encounterHealthMaximum > 0
      ? `${Math.ceil(snapshot.encounterHealth)}/${snapshot.encounterHealthMaximum}`
      : "--",
  );
  setText(
    app,
    "player-health",
    `${Math.ceil(snapshot.playerHealth)}/${snapshot.playerHealthMaximum}`,
  );
  setText(app, "guard", snapshot.playerGuarding ? "CLOSED" : "OPEN");
  setText(app, "score", String(snapshot.score));
  setText(app, "status", snapshot.status);
  const bypassToggle = app.querySelector<HTMLButtonElement>(
    "[data-command='safety-bypass']",
  );
  if (bypassToggle) {
    bypassToggle.textContent = snapshot.safetyBypassEnabled
      ? "Debug safety: bypassed"
      : "Debug safety: enforced";
    bypassToggle.setAttribute(
      "aria-pressed",
      String(snapshot.safetyBypassEnabled),
    );
  }
  const bypassContinue = app.querySelector<HTMLButtonElement>(
    "[data-command='continue-bypass']",
  );
  if (bypassContinue) {
    bypassContinue.hidden = !snapshot.safetyBypassEnabled;
  }
}

function renderLiveXRStatus(app: HTMLElement, status: LiveXRStatus) {
  setText(app, "xr-session", status.session.toUpperCase());
  setText(
    app,
    "xr-hands",
    `${Number(status.leftHand) + Number(status.rightHand)}/2`,
  );
  setText(app, "xr-geometry", `${status.planeCount}P / ${status.meshCount}M`);
  setText(
    app,
    "xr-depth",
    status.depth === "gpu-only"
      ? "CAMERA DEPTH / GPU"
      : status.depth === "cpu"
        ? "CAMERA DEPTH / CPU"
        : "UNAVAILABLE",
  );
}

function renderPhysicalContactDiagnostic(
  app: HTMLElement,
  diagnostic: PhysicalContactDiagnostic,
) {
  const output = app.querySelector<HTMLElement>(
    "[data-role='physical-contact']",
  );
  if (!output) return;
  output.textContent = diagnostic.message;
  output.dataset.state = diagnostic.state;
}

function renderPhysicalDebugVisibility(app: HTMLElement, enabled: boolean) {
  const button = app.querySelector<HTMLButtonElement>(
    "[data-command='depth-debug']",
  );
  if (!button) return;
  button.textContent = enabled ? "Depth view: on" : "Depth view: off";
  button.setAttribute("aria-pressed", String(enabled));
}

function bindCommands(
  app: HTMLElement,
  simulation: GameSimulation,
  launchXR: () => void,
  captureLiveRoom: () => void,
  togglePhysicalDebug: () => void,
) {
  const commands: Record<string, () => void> = {
    xr: () => {
      launchXR();
      if (simulation.application.state === "READY") {
        simulation.enterRoomSetup("Immersive AR session requested");
      }
    },
    simulate: () => simulation.enterRoomSetup(),
    "live-room": captureLiveRoom,
    room: () => simulation.loadRoomFixture(),
    confirm: () => simulation.confirmRoomSafety(),
    "safety-bypass": () =>
      simulation.setSafetyBypass(!simulation.snapshot.safetyBypassEnabled),
    "continue-bypass": () => simulation.continueWithoutRoomSafety(),
    "depth-debug": togglePhysicalDebug,
    portal: () => simulation.openPortal(),
    wave: () => simulation.completeCurrentWave(),
    phase: () => simulation.advanceBossPhase(),
    boss: () => simulation.defeatBoss(),
    "next-stage": () => simulation.nextStage(),
    pause: () => simulation.pause(),
    restart: () => simulation.restart(),
  };
  app.addEventListener("click", (event) => {
    const command = (event.target as HTMLElement).closest<HTMLElement>(
      "[data-command]",
    )?.dataset.command;
    if (!command) return;
    try {
      commands[command]?.();
    } catch (error) {
      setText(
        app,
        "status",
        error instanceof Error ? error.message : "Command failed",
      );
    }
  });
  window.addEventListener("keydown", (event) => {
    const keyCommands: Record<string, string> = {
      s: "simulate",
      l: "room",
      c: "confirm",
      p: "portal",
      n: "wave",
      "2": "phase",
      "3": "boss",
      g: "next-stage",
      Escape: "pause",
      r: "restart",
    };
    const command = keyCommands[event.key];
    if (command) commands[command]?.();
  });
}

function setText(app: HTMLElement, role: string, value: string) {
  const element = app.querySelector<HTMLElement>(`[data-role='${role}']`);
  if (element) element.textContent = value;
}
