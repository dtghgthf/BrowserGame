/** Fixed simulation rate. Physics and game rules always advance in steps of SIM_DT. */
export const SIM_HZ = 60;
export const SIM_DT = 1 / SIM_HZ;

/** Size of one layout tile in meters (simulation units). */
export const TILE_SIZE = 0.5;
/**
 * Pixels per tile in the art assets. This is part of the asset contract:
 * the hull PNGs are exactly (layout width * 8) x (layout height * 8) pixels.
 */
export const PIXELS_PER_TILE = 8;
/** Pixels per meter, derived from the two values above. */
export const PIXELS_PER_METER = PIXELS_PER_TILE / TILE_SIZE;

/** Base gravity magnitude in m/s^2 (stylised, stronger than earth for snappy platforming). */
export const GRAVITY = 22;

/** Maximum supported number of players. */
export const MAX_PLAYERS = 4;
