// The only Restaurant-owned audit action. Core already atomically audits
// order creation, line changes, completion, and void -- none of those are
// duplicated here. This fires only when order-ticket.service.ts's
// createTicket() detects it is writing metadata for an order that was
// already worked past "pending" by an earlier, successful call (a
// deterministic signal, not a guess -- see that file), meaning this
// metadata write is a repair of a gap left by a previous attempt that
// crashed between creating the Core order and recording its metadata.
export type RestaurantAuditAction = "restaurant.orderMetaRepaired";
