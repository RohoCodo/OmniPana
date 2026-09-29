import { inventoryService } from "../inventory";
export { calculateVariance } from "../inventory/math";
export const varianceService = { getVariance: inventoryService.getVariance, getInventory: inventoryService.getInventory };