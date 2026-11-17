// Planet height & surface-material function (pure, worker-safe, float64).
// OWNER: terrain-fn agent. CONTRACT (ARCHITECTURE.md §5):
//   heightAt(x, y, z, minWavelength = 0) -> metres above sea level at unit direction (x,y,z).
//       minWavelength (metres) band-limits detail: octaves with wavelength < 2*minWavelength fade
//       out smoothly (no pops). 0 = full detail (≈ 0.25 m). Same inputs => identical output on every
//       thread. Land is always > 0, the sea always < 0 (the coast metric decides).
//   sampleTerrain(x, y, z, minWavelength, out) -> out = { h, mat, rock, sand, soil, ice, frost, wet,
//       strata, slopeHint } (TerrainMat enum; base weights rock+basalt+sand+soil+ice+beach+seafloor
//       sum to 1, frost overlays). Extra fields (additive): basalt, beach, seafloor, cliff, dune,
//       park (city crater park), fresh (fresh crater floor/ejecta), lava, mesa, iceCliff, riverbed,
//       waterline (pale old-water-line band at the G02 reservoirs), scree, trough (gully floors),
//       rim (crater rims), farm (irrigated farmland 0..1), coast (signed metres to the sea shore,
//       > 0 land), water (hydro WaterType at the point).
//   heightWithFields(x, y, z, mw, F, M) -> internal: height + the field struct (hydro / fields).
//
// Implementation: world/terrain/* (fields -> relief -> water bodies -> megastructure landforms).
export { heightCore as heightAt, sampleCore as sampleTerrain, heightWithFields, TerrainMat } from './terrain/index.js';
