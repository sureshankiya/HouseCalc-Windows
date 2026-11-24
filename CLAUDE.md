# HouseCalc (Windows) — primary repository

- This repo is **the** HouseCalc / house calculator. All new HouseCalc work goes here.
- `sureshankiya/CAL` is the old browser version: leave it as it is (no changes, no merges into it).
- Desktop: Electron (`electron/main.cjs`) around the static build; Windows installer built by
  `.github/workflows/windows.yml` on every push to `main`.
- Calculation sources are version-locked: after engine/data changes, bump `src/engine/version.ts`
  and run `node scripts/lock.mjs` (tests/lock.test.ts fails otherwise).
