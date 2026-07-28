import type {
  CartValidationsGenerateRunInput,
  CartValidationsGenerateRunResult,
  ValidationError,
} from "../generated/api";

type Configuration = {
  min_subtotal: number;
  gift_variant_id: string;
};

export function cartValidationsGenerateRun(input: CartValidationsGenerateRunInput): CartValidationsGenerateRunResult {
  const configuration = input.shop.metafield?.jsonValue as Configuration | undefined;

  console.log("[GWP validation] config", JSON.stringify(configuration));
  console.log(
    "[GWP validation] lines",
    JSON.stringify(
      input.cart.lines.map((line) => ({
        quantity: line.quantity,
        variantId: line.merchandise.__typename === "ProductVariant" ? line.merchandise.id : null,
        giftMarker: line.giftMarker?.value ?? null,
      })),
    ),
  );
  console.log("[GWP validation] subtotal", input.cart.cost.subtotalAmount.amount);

  if (!configuration?.gift_variant_id) {
    console.log("[GWP validation] no config set, allowing checkout");
    return { operations: [] };
  }

  // This offer only applies to US orders in USD - everywhere else, don't
  // enforce anything.
  const isUsInUsd =
    input.localization.country.isoCode === "US" && input.cart.cost.subtotalAmount.currencyCode === "USD";

  if (!isUsInUsd) {
    console.log("[GWP validation] not US/USD, allowing checkout", {
      country: input.localization.country.isoCode,
      currency: input.cart.cost.subtotalAmount.currencyCode,
    });
    return { operations: [] };
  }

  // No test-mode check needed here: the storefront script already gates
  // adding the "_gwp_gift"-marked line to logged-in customers with the
  // configured tag, so a non-qualifying customer's cart never has a
  // gift-marked line for this to act on in the first place.

  // Match on the "_gwp_gift" line property (set when the storefront script
  // auto-adds the gift), not just the variant id - otherwise a customer who
  // separately buys the same product for real would be miscounted as an
  // extra free gift.
  const giftQuantity = input.cart.lines
    .filter(
      (line) =>
        line.merchandise.__typename === "ProductVariant" &&
        line.merchandise.id === configuration.gift_variant_id &&
        line.giftMarker?.value === "true",
    )
    .reduce((total, line) => total + line.quantity, 0);

  console.log("[GWP validation] giftQuantity", giftQuantity);

  const errors: ValidationError[] = [];

  if (giftQuantity > 0) {
    const subtotal = parseFloat(input.cart.cost.subtotalAmount.amount);

    if (subtotal < configuration.min_subtotal) {
      errors.push({
        message: `Your order must be at least $${configuration.min_subtotal.toFixed(2)} to qualify for the free gift.`,
        target: "$.cart",
      });
    }
  }

  if (giftQuantity > 1) {
    errors.push({
      message: "Only one free gift is allowed per order.",
      target: "$.cart",
    });
  }

  console.log("[GWP validation] errors", JSON.stringify(errors));

  return {
    operations: [
      {
        validationAdd: {
          errors,
        },
      },
    ],
  };
}
