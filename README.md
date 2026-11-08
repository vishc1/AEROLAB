# AEROLAB

A real-time, browser-based wind tunnel in 2D and 3D. Draw a silhouette (or hold
an object up to your webcam), and watch a GPU Navier–Stokes solver — or a 3D
lattice-Boltzmann solver — reveal the wake, vortices and pressure loads. No
meshes, no server, no simulation dependencies.

A real wind tunnel costs more than a classroom. AEROLAB puts one in a browser
tab, then teaches with it: five guided missions each isolate one aerodynamic
idea (wakes, lift, bluff bodies, Reynolds number, testing a physical object)
with a live target you have to hit in the tunnel. A road panel converts the
drag you measure into fuel and CO₂ at highway speed, and a pin-and-compare tool
shows exactly how many litres a shape change saves.

**Live:** <https://slipstream-indol.vercel.app>

## Tracks

- **Education** — a hands-on fluid dynamics lab with no hardware. Missions turn
  the tunnel into a lesson sequence; the coach explains every test result; the
  Numerics panel shows the maths behind every number.
- **Sustainability** — drag is fuel. The road panel scales the measured drag
  coefficient onto a car at 100 km/h and reports kW, L/100 km and g CO₂/km, so
  a 20% drag cut is shown in litres, not just a coefficient.
- **New Frontiers** — a GPU Navier–Stokes solver and a 3D lattice-Boltzmann
  solver running at 60 FPS in WebGL2, Google MediaPipe hand tracking, and
  Blender-to-AR, all client side.

AEROLAB also includes everything from the earlier Slipstream prototype: camera
shape capture, vorticity view, Card/Car presets, the 5-second test, a local
leaderboard and the flow coach.

![AEROLAB](scripts/new-viewport.png)

## Run

```bash
npm install
npm run dev -- --port 5190
```

Open <http://localhost:5190>. Production build:

```bash
npm run build
npm run preview
```

## Highlights

- Five guided missions with a settled baseline, live progress and a lesson on completion
- Road panel: drag coefficient → kW, L/100 km and g CO₂/km for a car at 100 km/h
- Pin any shape as a baseline and read the live drag change and litres saved per 10,000 km
- Share a design as a link: the silhouette is run-length encoded into the URL (about 200 characters), no upload, and the recipient gets it pinned as the baseline to beat
- Export a PNG report card with the live tunnel frame, coefficients, road numbers and mission progress
- AI flow coach: after each five-second test a serverless function asks Claude to explain what the air did to this shape and suggest one change; the rule-based coach stays as the fallback
- First-visit tour and a classroom section with three lessons mapped to NGSS standards
- Physics primer at `/physics.html`: seven concepts with equations, diagrams, where each shows up in the app, judge Q&A, numbers to memorise and a 60-second pitch
- Class rooms: a four-letter code puts a whole class on one live leaderboard (Vercel Blob with ETag-conditional writes); invite links join on open
- Link previews (Open Graph and Twitter cards) and a submission write-up in `SUBMISSION.md`
- WebGL2 fractional-step fluid solver with 65,536 live GPU tracers
- Red/blue vorticity view, pressure telemetry and finite drag/lift readings
- Mouse drawing plus airfoil, cylinder, plate, card and car presets
- 2D wind tunnel and interactive 3D D3Q19 lattice-Boltzmann mode
- Camera starts automatically when Camera mode is selected
- Google MediaPipe Hand Landmarker mode turns 21 tracked hand landmarks into a stable tunnel silhouette
- Click-to-sample color isolation using hue, saturation and chromaticity, tuned to reject skin beside a red object
- Largest-object cleanup, hole filling, temporal smoothing and outline-quality diagnostics
- Three-frame presence confirmation and automatic obstacle/wake clearing when the object leaves
- Vertical tracking: moving the real object up or down moves its tunnel silhouette too
- Blender glTF (`.glb`) upload with mesh statistics and front, side and top wind projections
- Interactive 3D model inspection plus phone AR placement through `<model-viewer>`
- PNG, JPG, WebP and SVG uploads become textured palm decals
- Hand AR anchors the uploaded model or image to MediaPipe palm position, rotation and scale
- Frozen-shape five-second tests, local leaderboard and design feedback

## Controls

| Input | Action |
| --- | --- |
| Drag on the test section | Sculpt solid geometry |
| `Shift` + drag / right-drag | Erase |
| `Space` | Pause / resume |
| Quick shape pills | Airfoil, cylinder, plate, card, car |
| 2D / 3D | Switch between the GPU 2D solver and the D3Q19 3D solver (drag to orbit, scroll to zoom, double-click to reset) |
| Wing / Extrude / Revolve | How the 2D silhouette is lifted into 3D |
| Camera tab | Webcam colour-key silhouette with smoothing, hole fill and quality diagnostics; freeze before testing |
| Vorticity | Red/blue signed vorticity overlay (2D) |
| Bottom sliders | Wind speed, viscosity, tracer density, brush radius, solver grid |
| Run 5-second test | Time-average `Cd` and `Cl` from the live force signal |

## Architecture

```
src/
  sim3d.js         D3Q19 BGK lattice-Boltzmann solver + orbit-camera renderer
  camera.js        Webcam silhouette tracker
  model-import.js  Blender GLB preview, silhouette projection and WebXR/AR handoff
  leaderboard.js   Efficiency score, localStorage board, flow coach
  missions.js      Guided challenges: baseline settle, live goal tracking, lessons
  impact.js        Road-speed fuel/CO₂ translation and pinned-baseline compare
  share.js         Silhouette ↔ URL hash codec and the shared-design banner
  report.js        PNG report card composed from the live frame and telemetry
  tour.js          Three-step first-visit tour
  classroom.js     Shared class-room board: join, create, post runs, poll
api/
  coach.js         Vercel function: Claude explains a test result (needs ANTHROPIC_API_KEY)
  board.js         Vercel function: class-room leaderboard on Vercel Blob (needs BLOB_READ_WRITE_TOKEN)
  gl/
    utils.js       WebGL2 context, programs, FBOs, fullscreen quad
    shaders.js     GLSL ES 3.00 solver, background and particle shaders
    fluid.js       fractional-step solver orchestration
    mask.js        obstacle canvas + RGBA8 mask texture
    particles.js   65,536-tracer GPGPU update and streak renderer
    renderer.js    background + particle composite
  telemetry.js     async pressure readback and boundary force integral
  state.js         store, defaults, slider mappings
  ui.js            DOM bindings, chart, benchmark state
  main.js          bootstrap, frame loop, benchmark timer
```

### Field layout

The physical test section is **2 × 1** (a wide 2:1 domain). `size` is the
vertical grid resolution, so a `192` setting allocates `384 × 192` float
textures.

| Field | Format | Purpose |
| --- | --- | --- |
| velocity | RGBA16F, ping-pong | `(u, v, 0, 1)` in physical units / s |
| pressure | RGBA32F, ping-pong | Jacobi pressure solve + async readback |
| divergence | RGBA16F | `∇·u` |
| obstacle | RGBA8 | solid mask uploaded from a 2D canvas |
| particles | RGBA32F ×2 | `(x, y, speed, life)` in UV space |

`uCell = 1 / size` is the physical cell size on both axes.
`uInvDomain = (size / width, size / height) = (0.5, 1.0)` converts physical
velocity into UV displacement.

### Fractional-step solver

Each frame, in order:

1. **Semi-Lagrangian advection** — trace each cell backwards through the
   velocity field, sample, and apply dissipation/viscosity.
2. **Divergence** — central differences over the physical cell size.
3. **Jacobi pressure** — 32–44 iterations of
   `p = (pₗ + pᵣ + p_b + p_t − ∇·u · Δx²) / 4`, with Neumann pressure at solids.
4. **Projection** — `u ← u − ∇p`, free-slip tunnel walls, inlet shear and solid
   no-slip constraints.

A small time-varying inlet shear seeds the Kelvin–Helmholtz instability, so a
nominally symmetric body still sheds a visible vortex street.

### Pressure telemetry

Pressure is copied into a pixel-pack buffer with a fence, so the CPU never
blocks the GPU every frame. When the fence resolves, the CPU walks the
solid/fluid interface and integrates

```
F = ∮ −p n ds          Cd = Fd / (½ ρ U² L)      Cl = Fl / (½ ρ U² L)
```

The reference length `L` is the body's bounding-box extent in physical units.
Metrics update at roughly 20 Hz while rendering continues at 60 FPS.

### Particles

A 256 × 256 RGBA32F texture stores 65,536 tracers. A fragment pass advances each
with midpoint RK2, respawns runaways at the inlet, and the render pass expands
each tracer into a velocity-oriented streak. Color maps normalized speed from
deep blue → cyan → cream, with muted violet in recirculation.

## AI coach setup

The coach endpoint lives at `api/coach.js` and runs as a Vercel function. Set
`ANTHROPIC_API_KEY` in the Vercel project (Settings → Environment Variables)
and redeploy. Without the key the endpoint answers 503 and the browser keeps
the built-in rule-based coach, so the app never depends on it.

## Class rooms setup

The board endpoint at `api/board.js` stores one JSON blob per room in a Vercel
Blob store. The store `aerolab-classrooms` is linked to the Vercel project,
which injects `BLOB_READ_WRITE_TOKEN` into every environment. For local
development run `vercel dev` so the functions and the token are available;
plain `npm run dev` serves the page without the API, and the board falls back
to the local leaderboard.

## Verification scripts

Puppeteer scripts live in `scripts/`. They expect the dev server on port 5190:

```bash
node scripts/check.mjs        # full smoke test + screenshots
node scripts/smoke.mjs        # interaction test
node scripts/cylinder-long.mjs # 20 s wake observation
```

The headless Chrome executable path is configured for macOS in each script.

## Notes

- WebGL2 is required, including `EXT_color_buffer_float`.
- The solver deliberately uses a coarse grid for interactive 60 FPS. The
  telemetry is a relative comparison tool, not a validated CFD result.
- Tailwind v4 is loaded through `@tailwindcss/vite`; the editorial UI itself is
  hand-written CSS in `src/style.css`.


## Hackathon features

CFD without the math: draw a shape, see the physics, get a score.

- **3D sketching**: side-profile and top-view editors beside the 3D tunnel (Sketch build mode); the solid is the intersection of both silhouettes and rebuilds live. Presets: straight, tapered, swept, delta, ellipse; mirror toggle.
- **Vorticity**: 2D overlay, and in 3D tracers coloured by spin (red/blue) plus a mid-span slice.
- **Plain language**: "In plain language" card (Re regime, drag/lift verdict), and an **Equations** overlay with live U, nu and Re.
- **Compare / export**: pin a baseline and see deltas; Snapshot PNG; Results CSV.
- **Leaderboard**: separate 2D and 3D boards, ranked by score or lift/drag, inline name field. Scores are recomputed on the server from Cd/Cl, so they cannot be forged.
- **Guided demo**: press "Auto demo" or open `/?demo=1` (about 45 s: cylinder, airfoil test, vorticity, 3D wing, car). Esc stops it.

### Shared leaderboard

The board is served by `server/scores-api.mjs` (JSON file in `server/data/`).

- `npm run dev` / `npm run preview`: the API is mounted automatically. Run with `--host` and everyone on the LAN shares one board.
- `npm run serve`: builds and serves `dist/` plus the API on `PORT` (default 8787).
- A static-only host cannot run the API, so the board falls back to **LOCAL** (this browser). Point `VITE_LEADERBOARD_URL` at a running server at build time to share it.

Tests: `npx vite --port 5190`, then `npm run test:hackathon`.
