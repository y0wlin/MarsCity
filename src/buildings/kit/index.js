// Public API of the building construction kit (worker-safe). Import from here in type files:
//   import * as K from '../kit/index.js';   or   import { wallWithOpenings, windowUnit } from '../kit/index.js';
// See kit/README.md for the material vocabulary, frames and recipes. Every function listed in the
// README tables is re-exported here (importing the module files directly keeps working too).
// Name note: `SIDES` is the MeshBuilder face mask (PX|NX|PZ|NZ); the side-name array
// ['front','right','back','left'] of plan.js is exported as `SIDE_NAMES`.

export { MeshBuilder, EXTRA_ATTRIBUTES, PX, NX, PY, NY, PZ, NZ, ALL, SIDES, clearBuilderPools } from './MeshBuilder.js';
export * from './math.js';
export { sweep, tube, lathe, cylinder, prism, extrudeX, blob, circleProfile, triangulate2, capIndices } from './primitives.js';
export { wallWithOpenings, gridFace, facadeFrame, facadePoint, facadeNormal, perimeterU, solidWall } from './walls.js';
export { ringPolygon, facadeOrder, polyEdges, edgeFrame, polyWalls, polyPlinth, polyParapet, insetPolygon, ringBandPath, radialProjector, radialInside } from './polyfacade.js';
export { windowUnit, glassPane, setGlassRoom, clearGlassRoom, sill, bar, frameRect, shopfront, louvrePanel, ROOM_KIND } from './windows.js';
export { doorUnit, vestibule, leverHandle, pullBar } from './doors.js';
export { risers, handrail, steps, rampAlong, stairFlights, stairTop, liftStorey } from './stairs.js';
export { stairLength, groundSplit, coreLayout, coreLayoutX, stairLengthX, stairFrame, stairPoint, stairAlongX } from './cores.js';
export { columnRound, columnSquare, columnGrid, canopyFlat, canopyCurved, porch, awning, pergola, roundedSlab, arcade } from './structure.js';
export { downpipe, scupper, gutter, roofDrain } from './drainage.js';
export { coping, parapets, roofDeck, deckArea, hvacUnit, acUnit, ventMushroom, ventStack, roofHatch, ladder, stairHouse, liftOverrun, waterTank, antennaMast, solarArray, skylight, plantRoom, roofGarden, bench, pitchedRoof } from './roof.js';
export { plinth, retainingSteps, sideGround, groundAlong, frameSide } from './plinth.js';
export { bandPaths, curvedBand, railing, bandPlanter, railLine, ribbonToWall, glassStrip, disc } from './balconies.js';
export { leafCluster, shrub, smallTree, trailing, plantBed, planterBox } from './vegetation.js';
export { ribbonFin, catmull, verticalFins, sunshade, signPanel, plaque, wallLight, storeyLine, acScreen } from './facade.js';
export { binStore, bikeRacks, bikeShelter, mailboxWall, bollard, pavingPad } from './site.js';
export { STYLES, STYLE_ID, resolveStyle, styleInstance, roofSpec, roofFarColor } from './styles.js';
export { normalizeSpec, groundAt, sideBearing, daylightScore, occProfile } from './spec.js';
export { emitMass, defaultMassing } from './mass.js';
// plan-first helpers (PlanModel, README §4)
export { SIDES as SIDE_NAMES, planToU, uToPlan, roomFacades, roomW, roomD, roomCenter, room, resetRoomIds, deriveOpenings, kindCode, sharedEdges, connected, openTo } from './plan.js';
// assemble passes (facades, bands, roof, base, anchors from a PlanModel)
export { wallKeys, emitFacades, emitBands, outerRect, rectOf, emitRoof, solidSpot, emitArcade, emitBase, emitAnchors } from './assemble.js';
// interiors ('full' LOD): rooms, partitions, cores, furniture
export { emitInterior, roomPaint } from '../interior/index.js';
export { furnishRoom } from '../interior/rooms.js';
export * as furniture from '../interior/furniture.js';
// procedural textures (materials.js / the 'buildingTextures' worker job)
export { generateTexture } from './texgen.js';
