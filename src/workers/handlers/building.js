// OWNER: building-kit agent. Worker handlers for buildings.
//   'building'          payload {spec, lod:'mass'|'exterior'|'full'} -> BuildingMeshData (buildings/index.js)
//   'buildingTextures'  payload {name, size?} -> {name, size, metres, color, normal, orm} (RGBA Uint8Arrays)
//                       procedural textures for buildings/materials.js (initBuildingMaterials)
import { generateBuilding, transferList } from '../../buildings/index.js';
import { generateTexture } from '../../buildings/kit/texgen.js';

export default {
  building: async ({ spec, lod }) => {
    const data = generateBuilding(spec, lod);
    return { result: data, transfer: transferList(data) };
  },
  buildingTextures: async ({ name, size }) => {
    const t = generateTexture(name, size);
    return { result: t, transfer: [t.color.buffer, t.normal.buffer, t.orm.buffer] };
  },
};
