export type RestaurantOrderType = "dineIn" | "takeaway" | "delivery";

// Fields Core structurally cannot own -- Core's own Order has no concept of
// a table, a guest count, or a kitchen note. Keyed by draftId (the same
// client-originated idempotency key passed to Core's createOrder), never by
// actor/branch/time-window matching -- see the Phase 3 plan's idempotency
// and consistency model for why the link must be exact.
export type RestaurantOrderMeta = {
  draftId: string;
  orderId: string;
  branchId: string;
  orderType: RestaurantOrderType;
  tableRef: string | null;
  guestCount: number | null;
  kitchenNote: string | null;
  status: "confirmed";
};

export type CreateTicketParams = {
  draftId: string;
  branchId: string;
  orderType: RestaurantOrderType;
  tableRef?: string | null;
  guestCount?: number | null;
  kitchenNote?: string | null;
  lines: { itemId: string; itemNameSnapshot: string; quantity: number; unitPrice: number }[];
};
