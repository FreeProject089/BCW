-- Carry a site-wide sale onto SUBSCRIPTION checkouts (catalog hosting).
--
-- A one-time charge can be multiplied; a subscription cannot — a discounted unit_amount
-- would bill the sale price every month for as long as the item is hosted, long after the
-- campaign ended. Stripe's coupon with `duration: 'once'` discounts the first invoice and
-- nothing after it, which is what a sale means on a recurring product.
ALTER TABLE "PromoCampaign" ADD COLUMN "stripeCouponId" TEXT;
