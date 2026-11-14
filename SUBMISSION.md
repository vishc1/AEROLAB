# AEROLAB — submission notes

**Live:** https://slipstream-indol.vercel.app
**Code:** https://github.com/vishc1/TinkerIt
**Tracks:** Education (primary), Sustainability, New Frontiers

## One line

A real wind tunnel costs more than a classroom. AEROLAB puts one in a browser tab and teaches with it.

## Inspiration

Every physics class explains drag and lift with a diagram. Almost none can show it, because a wind tunnel is a room-sized instrument with a six-figure price. We wanted the moment where a student holds up a paper car, watches the air peel off its back edge, and then fixes it with their own hands.

## What it does

- **Live fluid dynamics in the browser.** A WebGL2 Navier–Stokes solver runs a 384×192 pressure projection every frame, with 65,536 GPU tracers riding the same velocity field the force integral feels. A 3D D3Q19 lattice-Boltzmann solver covers finite wings and bodies of revolution.
- **Draw it, hold it up, or import it.** Sculpt directly in the tunnel, point a webcam at a coloured object, let Google MediaPipe track your hand, or upload a Blender `.glb` and test it from three wind directions, then place it on your palm in AR.
- **Five guided missions.** Streamline the cylinder, make a plate fly, cut a car's drag by a fifth, calm a turbulent wake with viscosity, test a real object. Each mission measures a settled baseline, tracks a live target, and reveals the lesson when you hit it.
- **Drag as fuel.** The road panel scales the measured drag coefficient onto a car at 100 km/h and reports kW, litres per 100 km and grams of CO₂ per km. Pin a baseline and every edit shows the litres saved.
- **AI flow coach.** After each five-second test, Claude reads the numbers and the silhouette and explains, in two sentences a 14-year-old can use, what the air did and one change to try.
- **Class rooms.** A four-letter code puts a whole class on one live leaderboard. Share any design as a 200-character link that pins it as the baseline to beat. Export a report card PNG.
- A physics primer page (`/physics.html`) that explains drag, wakes, lift, Reynolds number, vorticity, the solver and the drag-to-fuel chain, each tied to the control that shows it, so students and judges can check the science.
- Describe and race: name two objects and the tunnel draws them, holds them in your palm through the camera if you want, tests each one and tells you which wins and what the difference costs in fuel and CO₂ over 10,000 km. Common objects are built in; anything unusual is drawn by Claude.

## How we built it

Vite and vanilla JavaScript, no framework. The 2D solver is a fractional-step scheme in GLSL ES 3.00 with ping-pong float framebuffers, asynchronous pressure readback through a pixel-pack buffer with a fence, and a CPU boundary walk that integrates −p·n·ds into Cd and Cl at 20 Hz while rendering at 60. The 3D solver is a D3Q19 BGK lattice-Boltzmann model with half-way bounce-back and momentum-exchange forces. Camera silhouettes come from hue-aware colour keying with temporal smoothing, largest-blob cleanup and hole filling, or from 21 MediaPipe hand landmarks. Serverless functions on Vercel back the AI coach (Anthropic SDK) and the class rooms (Vercel Blob with ETag-conditional writes). Designs are shared by run-length encoding the solver mask into the URL hash, so no upload is needed.

## Challenges

Keeping the force signal honest. Vortex shedding makes Cd oscillate, so missions wait for the signal to stabilise before taking a baseline, and the 20% target is relative to that baseline rather than a fixed number. Reading the GPU pressure field without stalling the render loop took a fence-gated pixel-pack buffer. Making the webcam silhouette stable enough to score meant rejecting skin next to a red object and confirming presence over three frames.

## Accomplishments

Sixty frames per second with a real pressure solve on a laptop GPU. A mission system that cannot be gamed by waiting. Fuel numbers a judge can check in the Numerics panel. A whole class on one board with nothing to install.

## What we learned

Students do not need a validated CFD code to learn aerodynamics. They need a fast, honest, relative instrument and a target to hit. Every number in AEROLAB is labelled as a comparison, and that was enough to make the lessons land.

## What's next

Teacher dashboards for the class rooms, a Reynolds-number mission in 3D, accessibility passes for screen readers, and a validation study against published Cd values for the cylinder and plate at matched Reynolds numbers.

## Demo script (90 seconds)

1. Open the link cold. Type "a teardrop" vs "a brick" and press Race. Thirty seconds later: 67% less drag, and the litres and CO₂ that saves over 10,000 km.
2. Start mission 01. Draw a tail behind the cylinder. Watch the HUD complete and the lesson appear.
3. Pick the car preset, pin it as baseline, round the roof. Read the litres saved per 10,000 km.
4. Run the five-second test. The AI coach explains the result.
5. Create a class room, post the score, open the invite link on a phone. Same board.
6. Click Share design, open the link in a new tab: the shape appears with "beat it".
7. Switch on "In my hand", race "a bus" vs "a sports car": each one appears in your palm through the camera before it is tested.
8. Export the report card.
