import {
  createSystem,
  FollowBehavior,
  Follower,
  Object3D,
  PanelUI,
  PanelDocument,
  PokeInteractable,
  RayInteractable,
  eq,
  VisibilityState,
} from "@iwsdk/core";
import type { UIKit, UIKitDocument } from "@iwsdk/core";

import type {
  GameSimulation,
  SimulationSnapshot,
} from "./app/gameSimulation.js";
import {
  KickCombatSystem,
  type PhysicalContactDiagnostic,
} from "./combat/physicalContactSystem.js";
import { EnemyCombatSystem } from "./combat/enemyCombatSystem.js";
import { RoomCaptureSystem } from "./room/roomCaptureSystem.js";
import {
  XRRuntimeBridgeSystem,
  type LiveXRStatus,
} from "./xr/runtimeBridge.js";

const simulationGlobal = "portalBoxingSimulation";

export class PanelSystem extends createSystem({
  welcomePanel: {
    required: [PanelUI, PanelDocument],
    where: [eq(PanelUI, "config", "./ui/welcome.json")],
  },
  contactPanel: {
    required: [PanelUI, PanelDocument],
    where: [eq(PanelUI, "config", "./ui/contact-debug.json")],
  },
}) {
  private simulation: GameSimulation | undefined;
  private feedback: UIKit.Text | undefined;

  init() {
    this.simulation = this.globals[simulationGlobal] as
      GameSimulation | undefined;
    if (!this.simulation) {
      console.warn("Spatial panel has no simulation source");
      return;
    }

    this.queries.welcomePanel.subscribe("qualify", (entity) => {
      const document = PanelDocument.data.document[
        entity.index
      ] as UIKitDocument;
      if (!document) {
        return;
      }
      entity.addComponent(RayInteractable);
      entity.addComponent(PokeInteractable);
      this.configurePanel(document, entity.object3D);
    });

    this.queries.contactPanel.subscribe("qualify", (entity) => {
      const document = PanelDocument.data.document[
        entity.index
      ] as UIKitDocument;
      if (document) {
        entity.addComponent(RayInteractable);
        entity.addComponent(PokeInteractable);
        this.configureContactPanel(document, entity.object3D);
      }
    });

    const panelRoot = new Object3D();
    panelRoot.name = "PORTALAR Setup Console";
    panelRoot.position.set(0, 1.45, -1.25);
    const panelEntity = this.world.createTransformEntity(panelRoot, {
      parent: this.world.activeLevel.value,
    });
    panelEntity.addComponent(PanelUI, {
      config: "./ui/welcome.json",
      maxWidth: 0.88,
      maxHeight: 1.16,
    });

    const contactRoot = new Object3D();
    contactRoot.name = "PORTALAR Physical Contact Monitor";
    contactRoot.visible = false;
    const contactEntity = this.world.createTransformEntity(contactRoot, {
      parent: this.world.activeLevel.value,
    });
    contactEntity.addComponent(PanelUI, {
      config: "./ui/contact-debug.json",
      maxWidth: 0.68,
      maxHeight: 0.23,
    });
    contactEntity.addComponent(Follower, {
      target: this.player.head,
      offsetPosition: [0, 0.32, -0.8],
      behavior: FollowBehavior.FaceTarget,
      speed: 7,
      tolerance: 0.08,
      maxAngle: 8,
    });
    this.cleanupFuncs.push(
      () => panelEntity.dispose(),
      () => contactEntity.dispose(),
    );
  }

  private configureContactPanel(document: UIKitDocument, panelRoot?: Object3D) {
    const output = document.getElementById("contact-diagnostic") as UIKit.Text;
    const debugButton = document.getElementById(
      "depth-debug-button",
    ) as UIKit.Text;
    const diagnosticsButton = document.getElementById(
      "contact-diagnostics-button",
    ) as UIKit.Text;
    const simulation = this.simulation!;
    const updateVisibility = () => {
      if (panelRoot) {
        panelRoot.visible =
          simulation.application.state === "PLAYING" &&
          this.visibilityState.value !== VisibilityState.NonImmersive;
      }
    };
    const contactSystem = this.world.getSystem(KickCombatSystem);
    const enemySystem = this.world.getSystem(EnemyCombatSystem);
    if (contactSystem) {
      debugButton.addEventListener("click", () =>
        contactSystem.setDebugVisible(!contactSystem.isDebugVisible),
      );
      this.cleanupFuncs.push(
        contactSystem.subscribeDiagnostics((diagnostic) =>
          this.renderContactDiagnostic(diagnostic, output),
        ),
        contactSystem.subscribeDebugVisibility((enabled) => {
          debugButton.setProperties({
            text: enabled ? "DEPTH VIEW ON" : "DEPTH VIEW OFF",
            backgroundColor: enabled ? "#185d3a" : "#111a1f",
            borderColor: enabled ? "#58e48d" : "#3b525c",
            color: enabled ? "#a8ffc8" : "#dbe7eb",
          });
        }),
      );
    }
    if (enemySystem) {
      diagnosticsButton.addEventListener("click", () => {
        const enabled = !enemySystem.isPhysicalContactDiagnosticsEnabled;
        enemySystem.setPhysicalContactDiagnostics(enabled);
      });
    }
    const updateDiagnosticsButton = (snapshot: SimulationSnapshot) => {
      diagnosticsButton.setProperties({
        text: snapshot.physicalContactDiagnosticsEnabled
          ? "KICK TEST MODE ON"
          : "KICK TEST MODE OFF",
        backgroundColor: snapshot.physicalContactDiagnosticsEnabled
          ? "#185d3a"
          : "#111a1f",
        borderColor: snapshot.physicalContactDiagnosticsEnabled
          ? "#58e48d"
          : "#3b525c",
        color: snapshot.physicalContactDiagnosticsEnabled
          ? "#a8ffc8"
          : "#dbe7eb",
      });
    };
    this.cleanupFuncs.push(
      simulation.subscribe((snapshot) => {
        updateVisibility();
        updateDiagnosticsButton(snapshot);
      }),
      this.world.visibilityState.subscribe(updateVisibility),
    );
    updateVisibility();
  }

  private renderContactDiagnostic(
    diagnostic: PhysicalContactDiagnostic,
    element: UIKit.Text,
  ) {
    const color =
      diagnostic.state === "accepted"
        ? "#58e48d"
        : diagnostic.state === "contact"
          ? "#ffd966"
          : diagnostic.state.startsWith("waiting")
            ? "#ff9b87"
            : "#f2f0e9";
    element.setProperties({ text: diagnostic.message, color });
  }

  private configurePanel(document: UIKitDocument, panelRoot?: Object3D) {
    const simulation = this.simulation!;
    this.feedback = document.getElementById("status") as UIKit.Text;
    const application = document.getElementById("application") as UIKit.Text;
    const xrStatus = document.getElementById("xr-status") as UIKit.Text;
    const captureButton = document.getElementById(
      "capture-button",
    ) as UIKit.Text;
    const confirmButton = document.getElementById(
      "confirm-button",
    ) as UIKit.Text;
    const portalButton = document.getElementById("portal-button") as UIKit.Text;
    const bypassButton = document.getElementById("bypass-button") as UIKit.Text;
    const bypassContinueButton = document.getElementById(
      "bypass-continue-button",
    ) as UIKit.Text;
    const depthDebugButton = document.getElementById(
      "depth-debug-button",
    ) as UIKit.Text | null;
    const nextButton = document.getElementById("next-button") as UIKit.Text;
    const restartButton = document.getElementById(
      "restart-button",
    ) as UIKit.Text;
    const exitButton = document.getElementById("exit-button") as UIKit.Text;

    captureButton.addEventListener("click", () =>
      this.runCommand(() => {
        const capture = this.world.getSystem(RoomCaptureSystem)?.capture();
        if (!capture || capture.observations.length === 0) {
          throw new Error("No room geometry yet. Wait for the scan and retry.");
        }
        simulation.loadRoomObservations(
          capture.observations,
          capture.playerPosition,
        );
      }),
    );
    confirmButton.addEventListener("click", () =>
      this.runCommand(() => simulation.confirmRoomSafety()),
    );
    bypassButton.addEventListener("click", () =>
      this.runCommand(() =>
        simulation.setSafetyBypass(!simulation.snapshot.safetyBypassEnabled),
      ),
    );
    bypassContinueButton.addEventListener("click", () =>
      this.runCommand(() => simulation.continueWithoutRoomSafety()),
    );
    const contactSystem = this.world.getSystem(KickCombatSystem);
    if (contactSystem && depthDebugButton) {
      depthDebugButton.addEventListener("click", () =>
        contactSystem.setDebugVisible(!contactSystem.isDebugVisible),
      );
      this.cleanupFuncs.push(
        contactSystem.subscribeDebugVisibility((enabled) =>
          depthDebugButton.setProperties({
            text: enabled ? "DEPTH CUBES: ON" : "DEPTH CUBES: OFF",
            backgroundColor: enabled ? "#185d3a" : "#111a1f",
            borderColor: enabled ? "#58e48d" : "#3b525c",
            color: enabled ? "#a8ffc8" : "#dbe7eb",
          }),
        ),
      );
    }
    portalButton.addEventListener("click", () =>
      this.runCommand(() => simulation.openPortal()),
    );
    nextButton.addEventListener("click", () =>
      this.runCommand(() => simulation.nextStage()),
    );
    restartButton.addEventListener("click", () =>
      this.runCommand(() => {
        simulation.restart();
        simulation.enterRoomSetup("Immersive room setup restarted");
      }),
    );
    exitButton.addEventListener("click", () => this.world.exitXR());

    this.cleanupFuncs.push(
      simulation.subscribe((snapshot) => {
        this.renderSnapshot(snapshot, application, {
          captureButton,
          confirmButton,
          bypassButton,
          bypassContinueButton,
          portalButton,
          nextButton,
        });
        if (panelRoot) {
          panelRoot.visible = snapshot.application !== "PLAYING";
        }
      }),
    );

    const runtimeBridge = this.world.getSystem(XRRuntimeBridgeSystem);
    if (runtimeBridge) {
      this.cleanupFuncs.push(
        runtimeBridge.subscribe((status) =>
          this.renderXRStatus(status, xrStatus),
        ),
      );
    }
    this.cleanupFuncs.push(
      this.world.visibilityState.subscribe((visibilityState) => {
        if (panelRoot) {
          panelRoot.visible =
            visibilityState !== VisibilityState.NonImmersive &&
            simulation.application.state !== "PLAYING";
        }
      }),
    );
  }

  private renderSnapshot(
    snapshot: SimulationSnapshot,
    application: UIKit.Text,
    buttons: {
      captureButton: UIKit.Text;
      confirmButton: UIKit.Text;
      bypassButton: UIKit.Text;
      bypassContinueButton: UIKit.Text;
      portalButton: UIKit.Text;
      nextButton: UIKit.Text;
    },
  ) {
    application.setProperties({ text: snapshot.application });
    this.feedback?.setProperties({ text: snapshot.status });
    buttons.captureButton.setProperties({
      display: snapshot.application === "SCANNING_ROOM" ? "flex" : "none",
    });
    buttons.confirmButton.setProperties({
      display: snapshot.application === "SEMANTIC_REVIEW" ? "flex" : "none",
    });
    buttons.bypassButton.setProperties({
      text: snapshot.safetyBypassEnabled
        ? "DEBUG SAFETY: BYPASSED"
        : "DEBUG SAFETY: ENFORCED",
      display: ["SCANNING_ROOM", "SEMANTIC_REVIEW"].includes(
        snapshot.application,
      )
        ? "flex"
        : "none",
    });
    buttons.bypassContinueButton.setProperties({
      display:
        snapshot.safetyBypassEnabled &&
        ["SCANNING_ROOM", "SEMANTIC_REVIEW"].includes(snapshot.application)
          ? "flex"
          : "none",
    });
    buttons.portalButton.setProperties({
      display: snapshot.application === "STAGE_READY" ? "flex" : "none",
    });
    buttons.nextButton.setProperties({
      display: snapshot.encounter === "STAGE_CLEAR" ? "flex" : "none",
    });
  }

  private renderXRStatus(status: LiveXRStatus, element: UIKit.Text) {
    const hands = Number(status.leftHand) + Number(status.rightHand);
    element.setProperties({
      text: `${hands}/2 hands | ${status.planeCount} planes | ${status.meshCount} meshes | ${status.depth} depth`,
    });
  }

  private runCommand(command: () => void) {
    try {
      command();
    } catch (error) {
      this.feedback?.setProperties({
        text: error instanceof Error ? error.message : "Command failed",
      });
    }
  }
}
