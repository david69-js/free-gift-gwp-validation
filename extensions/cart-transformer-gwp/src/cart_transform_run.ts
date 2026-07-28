import type {
  CartTransformRunInput,
  CartTransformRunResult,
} from "../generated/api";

const NO_CHANGES: CartTransformRunResult = {
  operations: [],
};

type Configuration = {
  min_subtotal: number;
  gift_variant_id: string;
};

export function cartTransformRun(input: CartTransformRunInput): CartTransformRunResult {
  const configuration = input.shop.metafield?.jsonValue as Configuration | undefined;

  console.log("[GWP cart-transform] config", JSON.stringify(configuration));
  console.log(
    "[GWP cart-transform] lines",
    JSON.stringify(
      input.cart.lines.map((line) => ({
        id: line.id,
        variantId: line.merchandise.__typename === "ProductVariant" ? line.merchandise.id : null,
        giftMarker: line.giftMarker?.value ?? null,
      })),
    ),
  );

  if (!configuration?.gift_variant_id) {
    console.log("[GWP cart-transform] no config set, doing nothing");
    return NO_CHANGES;
  }

  // Match on the "_gwp_gift" line property (set when the storefront script
  // auto-adds the gift), not just the variant id - otherwise a customer who
  // separately buys the same product for real would get its price clamped too.
  const giftLine = input.cart.lines.find(
    (line) =>
      line.merchandise.__typename === "ProductVariant" &&
      line.merchandise.id === configuration.gift_variant_id &&
      line.giftMarker?.value === "true",
  );

  if (!giftLine) {
    console.log("[GWP cart-transform] no matching gift line found, doing nothing");
    return NO_CHANGES;
  }

  // Disabled: `lineUpdate` price overrides require a Shopify Plus plan.
  // Attempting one on a non-Plus store can cause a hard cart calculation
  // error (blocking add/remove for the whole cart), not a silent no-op.
  // The gift is expected to already be $0 in the catalog, so this isn't
  // needed for non-Plus stores anyway.
  console.log("[GWP cart-transform] gift line found but price clamp is disabled (non-Plus store)", giftLine.id);
  return NO_CHANGES;
}
