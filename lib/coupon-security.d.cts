export function calculateCouponDiscount(input: {
  subtotalCents: number;
  discountType: "percent" | "fixed" | string;
  discountValue: string | number;
  maxDiscount?: string | number | null;
}): { discountCents: number; totalCents: number } | null;
