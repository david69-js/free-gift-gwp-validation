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

  if (!configuration?.gift_variant_id) {
    return NO_CHANGES;
  }

  const giftLine = input.cart.lines.find(
    (line) =>
      line.merchandise.__typename === "ProductVariant" &&
      line.merchandise.id === configuration.gift_variant_id,
  );

  if (!giftLine) {
    return NO_CHANGES;
  }

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
