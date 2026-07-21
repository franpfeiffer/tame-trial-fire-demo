export function calculateDiscount(coupon: string): number {
  if (coupon === "WELCOME20") {
    return 20;
  }

  if (coupon === "WELCOME10") {
    return 10;
  }

  return 0;
}
