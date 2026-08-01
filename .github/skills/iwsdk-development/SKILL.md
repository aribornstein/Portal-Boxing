---
name: iwsdk-development
description: "Develop, run, inspect, and debug this IWSDK WebXR project with IWER, the iwsdk-runtime MCP server, iwsdk-reference semantic search, and Meta Quest hzdb tools. Use for IWSDK, WebXR, XR sessions, controllers, hands, ECS entities, 3D scenes, spatial UI, or Quest testing."
argument-hint: "Describe the IWSDK feature or debugging task"
user-invocable: true
---

# IWSDK Development

Use the generated project guidance in `../../copilot-instructions.md` for framework conventions and API constraints.

## Workflow

1. Check the existing runtime before starting another server:
   - Prefer `xr_get_session_status` from `iwsdk-runtime` when available.
   - Otherwise run `npx iwsdk dev status` and `npx iwsdk xr status`.
2. If no runtime is active, start it with `npm run dev`. Use the runtime URL reported by IWSDK; do not assume a port.
3. Use `iwsdk-reference` semantic search before guessing IWSDK APIs or component patterns.
4. Use `iwsdk-runtime` tools to accept XR sessions, manipulate headset/controllers/hands, capture screenshots, inspect scenes, and query ECS state.
5. Use `hzdb` only for Quest device management, platform documentation, or Meta asset search.
6. Make the smallest implementation change that fits existing project patterns.
7. Run `npm run build` after code or configuration changes.
8. For runtime behavior, reload through `iwsdk-runtime`, reproduce the interaction, inspect console/scene/ECS state, and capture a screenshot.

## First-Time Reference Setup

If `iwsdk-reference` reports that its corpus is unavailable, run:

```bash
npm run reference:warmup
```

This downloads the pinned semantic model and reference corpus and requires network access.

## Browser Testing

IWSDK injects IWER for local development. Do not also enable the Immersive Web Emulator Chrome extension on the same local page because two WebXR emulators can conflict.
