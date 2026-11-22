/**
 * The 3D page's data on the wire (audit R6). A hospital's rooms and devices made the page's HTML about 1.5 MB: every
 * device repeated its type, category and group names and every field name, and most rooms carried empty site data.
 * The server packs them (device types once, devices as short rows, rooms without empty fields); the client unpacks
 * them back into the same `TwinData`, so nothing past the view's entry point changes. Pure; safe on server and client.
 */
import type { TwinAsset, TwinData, TwinRoom } from "./types";

/** [deviceType, typeCode, category, categoryCode, groupCode] */
type TypeRow = [string, string, string, string, string | null];
/** [id, tag, type index, status, criticality, roomId, posX, posY, manufacturer, model, serial, l, w, h, rot, lib] */
type AssetRow = [number, string, number, string, string | null, number | null, number | null, number | null,
  string | null, string | null, string | null, number, number, number, number | null, string | null];
/** A room without the fields that hold nothing (null zone, not a workshop, no site data, not verified). */
type RoomRow = Omit<TwinRoom, "site"> & { site?: TwinRoom["site"] };

export type PackedTwinData = Omit<TwinData, "rooms" | "assets" | "unplaced"> & {
  packed: { types: TypeRow[]; rooms: RoomRow[]; assets: AssetRow[]; unplaced: AssetRow[] };
};

const siteEmpty = (s: TwinRoom["site"]) => !s || (s.ceilingM == null && s.doorWidthM == null && s.doorHeightM == null && s.floorLoadKgM2 == null && s.services == null);
const EMPTY_SITE = { ceilingM: null, doorWidthM: null, doorHeightM: null, floorLoadKgM2: null, services: null };

export function packTwin(data: TwinData): PackedTwinData {
  const { rooms, assets, unplaced, ...rest } = data;
  const types: TypeRow[] = [], index = new Map<string, number>();
  const typeOf = (a: TwinAsset) => {
    const key = [a.deviceType, a.typeCode, a.category, a.categoryCode, a.groupCode ?? ""].join("\u0000");
    let i = index.get(key);
    if (i == null) { i = types.length; index.set(key, i); types.push([a.deviceType, a.typeCode, a.category, a.categoryCode, a.groupCode]); }
    return i;
  };
  const row = (a: TwinAsset): AssetRow => [a.id, a.tag, typeOf(a), a.status, a.criticality, a.roomId, a.posX, a.posY,
    a.manufacturer, a.model, a.serial, a.dims.l, a.dims.w, a.dims.h, a.rot, a.lib ?? null];
  const room = (r: TwinRoom): RoomRow => {
    const { site, zone, workshop, verified, outlineSource, template, ...keep } = r;
    return {
      ...keep, ...(zone != null ? { zone } : {}), ...(workshop ? { workshop } : {}), ...(verified ? { verified } : {}),
      ...(outlineSource != null ? { outlineSource } : {}), ...(template !== undefined ? { template } : {}), ...(siteEmpty(site) ? {} : { site }),
    };
  };
  return { ...rest, packed: { types, rooms: rooms.map(room), assets: assets.map(row), unplaced: unplaced.map(row) } };
}

export function unpackTwin(p: PackedTwinData): TwinData {
  const { packed, ...rest } = p;
  const asset = (r: AssetRow): TwinAsset => {
    const [id, tag, t, status, criticality, roomId, posX, posY, manufacturer, model, serial, l, w, h, rot, lib] = r;
    const [deviceType, typeCode, category, categoryCode, groupCode] = packed.types[t];
    return { id, tag, deviceType, typeCode, category, categoryCode, groupCode, status, criticality, roomId, posX, posY, manufacturer, model, serial,
      dims: { l, w, h }, rot, ...(lib != null ? { lib } : {}) };
  };
  const room = (r: RoomRow): TwinRoom => ({ zone: null, workshop: false, outlineSource: null, verified: false, ...r, site: r.site ?? { ...EMPTY_SITE } });
  return { ...rest, rooms: packed.rooms.map(room), assets: packed.assets.map(asset), unplaced: packed.unplaced.map(asset) };
}
