export { createItem, deactivateItem, getItem, getItemByBarcode, listItems, updateItem } from "./application/items";
export type { CreateItemInput, UpdateItemInput } from "./application/items";

export {
  adjustStock,
  applyStockChangeInTransaction,
  commitStockChangePlan,
  getStockLevel,
  listMovementsForBranch,
  listStockForBranch,
  planStockChange,
  receiveStock,
  recordStockCount,
  transferStock,
  wasteStock,
} from "./application/stock";
export type { ApplyStockChangeParams, StockChangePlan } from "./application/stock";

export { InsufficientStockError, ItemNotFoundError } from "./domain/errors";
export type { InventoryAuditAction, InventoryItem, InventoryMovement, MovementType, Stock } from "./domain/types";
