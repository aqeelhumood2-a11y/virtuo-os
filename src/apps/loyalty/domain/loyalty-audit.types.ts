// Loyalty's own closed audit vocabulary. Core's own order.created/
// completed/voided/etc. audits (already atomic, since 1G) are never
// duplicated here -- these are the events only Loyalty can know about.
export type LoyaltyAuditAction = "loyalty.memberEnrolled" | "loyalty.pointsEarned";
