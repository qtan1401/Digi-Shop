/* Loyalty points: a balance per user and the points an Order redeemed / earned.
   1 point = 1.000 VND; an Order earns floor(total_price * 10% / 1000) points.
   points_released_at / points_credited_at make give-back and credit idempotent (same idea as order_vouchers.released_at).
   Existing orders keep the defaults (nothing redeemed, nothing earned). The CHECK runs through EXEC so it compiles
   after the column exists (same batch). */

ALTER TABLE [dbo].[users] ADD [loyalty_points] INT NOT NULL CONSTRAINT [users_loyalty_points_df] DEFAULT 0;

ALTER TABLE [dbo].[orders] ADD
    [points_redeemed] INT NOT NULL CONSTRAINT [orders_points_redeemed_df] DEFAULT 0,
    [points_discount] DECIMAL(18,2) NOT NULL CONSTRAINT [orders_points_discount_df] DEFAULT 0,
    [points_earned] INT NOT NULL CONSTRAINT [orders_points_earned_df] DEFAULT 0,
    [points_released_at] DATETIME2 NULL,
    [points_credited_at] DATETIME2 NULL;

EXEC(N'ALTER TABLE [dbo].[users] ADD CONSTRAINT [users_loyalty_points_check] CHECK ([loyalty_points] >= 0);');
EXEC(N'ALTER TABLE [dbo].[orders] ADD CONSTRAINT [orders_points_check] CHECK ([points_redeemed] >= 0 AND [points_discount] >= 0 AND [points_earned] >= 0);');
