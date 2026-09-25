-- Rename the existing phone_number column to phone_mobile_money
ALTER TABLE public.payout_methods RENAME COLUMN phone_number TO phone_mobile_money;

-- Add a new column for the Cash on Delivery phone number
ALTER TABLE public.payout_methods ADD COLUMN phone_cash_on_delivery text;
