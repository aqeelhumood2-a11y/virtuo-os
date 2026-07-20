export { createItem, deactivateItem, getItem, listItems, updateItem } from "./application/items";
export type { CreateItemInput, UpdateItemInput } from "./application/items";

export {
  adjustStock,
  getStockLevel,
  listMovementsForBranch,
  listStockForBranch,
  receiveStock,
  recordStockCount,
  transferStock,
  wasteStock,
} from "./application/stock";

export { BranchAccessDeniedError, InsufficientStockError, ItemNotFoundError } from "./domain/errors";
export type { InventoryItem, InventoryMovement, MovementType, Stock } from "./domain/types";
