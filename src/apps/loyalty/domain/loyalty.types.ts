export type LoyaltyMember = {
  id: string;
  name: string;
  contactRef: string | null;
  pointsBalance: number;
};

// "adjusted" is reserved for a future manual-correction action -- not built
// in Phase 4.2 (out of the approved scope), but included in the type now so
// the ledger schema doesn't need a breaking change when it is.
export type LedgerEntryType = "earned" | "adjusted";

export type LoyaltyLedgerEntry = {
  id: string;
  memberId: string;
  type: LedgerEntryType;
  points: number; // signed delta
  orderId: string | null; // set only for type: "earned"
  reason: string | null;
  actorId: string;
};

// Maps a completed Core order to the member it should accrue points for.
// Keyed by orderId (companies/{companyId}/apps/loyalty/attributions/{orderId})
// so a given order can only ever resolve to one member. Deliberately
// decoupled from Restaurant/Retail's own checkout flow -- see the Phase 4.2
// proposal §13.2 -- so attribution is its own staff action, performed any
// time after checkout, never a change to either App's own code.
export type LoyaltyAttribution = {
  orderId: string;
  memberId: string;
  attributedBy: string;
};
