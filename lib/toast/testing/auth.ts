import { db } from "../../db";
import { authorizeLocation } from "../../inventory/shared";

/** Test-only auth boundary; never imported by production modules. */
export function requireAuthorizedLocation(locationId: string, userId: string) {
  return authorizeLocation(db, locationId, userId);
}