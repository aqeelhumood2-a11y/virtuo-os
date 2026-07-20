export class InsufficientStockError extends Error {
  constructor() {
    super("This movement would reduce quantity on hand below zero.");
    this.name = "InsufficientStockError";
  }
}

export class ItemNotFoundError extends Error {
  constructor() {
    super("Inventory item not found.");
    this.name = "ItemNotFoundError";
  }
}
