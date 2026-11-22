# Sandfire browser E2E harness

Headless Microsoft Edge is driven through the Chrome DevTools Protocol (CDP) with **real**
`Input.dispatchTouchEvent` / mouse / keyboard events. The game is served over a local HTTP static
server (`server.mjs`); CDP connects via the `DevToolsActivePort` WebSocket file in a temporary
Edge profile.

**Requirements:** Node 22+ (global `fetch` / `WebSocket`), Windows Edge at  
`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`. No npm packages. Edge is launched with
`--no-proxy-server` so `HTTP_PROXY` / system proxy settings do not break localhost loads.

## Commands

From the game repo root (or any checkout via `--root`):

```text
node tools/e2e/run.mjs
node tools/e2e/run.mjs desktop
node tools/e2e/run.mjs touch --root C:\path\to\sandfire
node tools/e2e/run.mjs views --out C:\temp\my-run
node tools/e2e/run.mjs desktop touch views --no-sandbox
```

| Flag | Meaning |
|------|---------|
| `--root <dir>` | Directory containing `index.html` (default: repo root two levels above `tools/e2e`) |
| `--out <dir>` | Output folder (default: `tools/e2e/out/<timestamp>/`) |
| `--no-sandbox` | Pass `--no-sandbox` to Edge (restricted shells only) |

Exit code **0** if every requested scenario passes; **1** otherwise.

## Scenarios

### `desktop`

1600×900, DPR 1. Waits for menu (`#btnAtk` enabled), screenshots, then loads
`index.html?autostart=atk`, waits until `G.Game.phase` is past `menu`, runs ~4 s, screenshots again.

### `touch`

Phone landscape (740×360, DPR 2), Android UA, touch emulation. Presets `localStorage` touch mode if
needed. Starts a match via **加入进攻方** using touch tap, then CDP mouse, then `btnAtk.click()` until
`G.Game.phase` leaves `menu`, `G.Player.agent` exists, and `G.paused` is false (`startMethod` in the
report). Waits until freeze ends and `#touchLayer` is visible, then exercises stick (×3),
look drag, simultaneous stick+look, `[data-action]` buttons (jump, crouch, reload, cycle, fire),
pause → `#btnResume`. Records `G.Touch.joystick`, pointer map, movement, and PNGs per step.

### `views`

Desktop 1600×900, `?autostart=atk`, then places the camera at each viewpoint in `views.json`
(uses `G.debugView(x,y,z,yaw,pitch)` when present, otherwise sets `G.Player.agent` + `G.camera` and
calls `G.frame(0, t)` with `G.loopOn = false`). One PNG per view.

## Reading `report.json`

Written to `--out` (alongside PNGs). Top-level fields:

- `graphics.renderer` — WebGL2 renderer string from the temp Edge session (SwiftShader vs D3D11 ANGLE).
- `angle` — `--use-angle=` flag that worked (`swiftshader` or `d3d11`).
- `scenarios.<name>.pass` — boolean; `status` is `PASS`, `FAIL`, or `INVALID`.
- `scenarios.touch.invalid` / `reason` — match never reached playable touch UI (no stick assertions run).
- `scenarios.touch.startMethod` — which start path worked: `touch-tap`, `cdp-mouse`, or `dom-click`.
- `scenarios.touch.assertions` — each entry has a `name` (stick, look, dual-touch, buttons, pause).
- `scenarios.touch.steps` — joystick / pointer snapshots to diagnose the `touchLayer` pointer-capture bug.

**Stick diagnosis:** If `joystick` stays `{x:0,y:0}` while the finger moves but `touchStart` fired,
`pointermove` likely never reaches `#touchLayer` (`pointer-events:none` + `setPointerCapture`). Check
`pointers` for stale entries blocking later sticks.

## Timing notes

Boot on a software WebGL VM can take **30–120 s**; scenario timeouts are generous (up to 5 min each).
First shader compile and lightmap load dominate cold starts.