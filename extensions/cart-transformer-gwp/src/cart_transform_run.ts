import type {
  CartTransformRunInput,
  CartTransformRunResult,
  Operation,
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

  console.log("[GWP cart-transform] clamping price to 0.00 for line", giftLine.id);

  // Defensive clamp: the gift is expected to already be $0 in the catalog,
  // but this guarantees it regardless of manual pricing changes or bugs.
  // Requires a Shopify Plus plan (`lineUpdate` price overrides are Plus-only).
  const operations: Operation[] = [
    {
      lineUpdate: {
        cartLineId: giftLine.id,
        price: {
          adjustment: {
            fixedPricePerUnit: {
              amount: "0.00",
            },
          },
        },
      },
    },
  ];

  return { operations };
}
