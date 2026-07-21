import type { ComponentType } from "react";

import { RestaurantAppRoot } from "@/apps/restaurant/routes/RestaurantAppRoot";
import { RetailAppRoot } from "@/apps/retail/routes/RetailAppRoot";
import { LoyaltyAppRoot } from "@/apps/loyalty/routes/LoyaltyAppRoot";

export type AppRootProps = { companyId: string; slug?: string[] };

// The routeKey -> Component map App Registry itself never sees -- App
// Registry stays a pure, UI-independent data catalog (only a `routeKey`
// string, never a ComponentType). This map lives at the Next.js route
// layer instead, the one layer already permitted to depend on everything
// below it. A routeKey with no entry here falls back to AppMountPage's
// existing "not available" placeholder rather than crashing; a future App
// is added the same way, one new entry, no change to App Registry itself.
export const APP_ROOT_COMPONENTS: Partial<Record<string, ComponentType<AppRootProps>>> = {
  restaurant: RestaurantAppRoot,
  retail: RetailAppRoot,
  loyalty: LoyaltyAppRoot,
};
