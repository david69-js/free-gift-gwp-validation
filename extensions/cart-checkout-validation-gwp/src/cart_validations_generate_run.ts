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

  if (!configuration?.gift_variant_id) {
    return { operations: [] };
  }

  const giftQuantity = input.cart.lines
    .filter(
      (line) =>
        line.merchandise.__typename === "ProductVariant" &&
        line.merchandise.id === configuration.gift_variant_id,
    )
    .reduce((total, line) => total + line.quantity, 0);

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
