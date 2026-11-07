# Slipstream

A browser-based 2D wind tunnel for paper, clay, hands, and quick physical prototypes.

## Run locally

```bash
npm install
npm run dev
```

## What is implemented

- D2Q9 lattice Boltzmann solver at 240 × 96 cells
- Mouse-drawn and preset obstacles
- Momentum-exchange drag and lift estimates
- Speed/vorticity field and advected tracer particles
- Click-to-sample detection for any object or backdrop color
- Live tolerance tuning, largest-object cleanup, temporal mask smoothing, and outline-quality diagnostics
- Frozen-shape five-second test runs
- Height-normalized local leaderboard and design feedback

The values are relative comparisons from a low-speed 2D model, not real-world drag coefficients.
