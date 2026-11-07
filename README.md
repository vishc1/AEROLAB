# Slipstream

A browser-based 2D wind tunnel for paper, clay, hands, and quick physical prototypes.

## Run locally

```bash
npm install
npm run dev
```

## What is implemented

- Stable D2Q9 lattice Boltzmann solver at 300 × 120 cells with automatic non-finite recovery
- Mouse-drawn and preset obstacles
- Momentum-exchange drag and lift estimates
- Red/blue vorticity field and persistent advected smoke trails
- Click-to-sample detection for any object or backdrop color
- Camera starts automatically when Camera mode is selected
- Hue, saturation, and chromaticity matching that keeps glossy objects selected while rejecting nearby colors such as skin beside red plastic
- Live tolerance tuning, largest-object cleanup, hole filling, temporal mask smoothing, and outline-quality diagnostics
- Camera silhouettes normalized to a safe 25% tunnel height with protected inlet/outlet padding
- Three-frame presence confirmation and automatic obstacle/wake clearing when the object leaves the camera
- Frozen-shape five-second test runs
- Height-normalized local leaderboard and design feedback

The values are relative comparisons from a low-speed 2D model, not real-world drag coefficients.
