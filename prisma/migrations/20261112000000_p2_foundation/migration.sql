/* P2 foundation: product gallery, cost price, BANNED users and guest comments.
   Existing rows get cost_price / unit_cost = 80% of the selling price so profit figures are usable immediately;
   the admin edits real costs afterwards. */

CREATE TABLE [dbo].[product_images] (
    [id] INT NOT NULL IDENTITY(1,1),
    [product_id] INT NOT NULL,
    [url] NVARCHAR(500) NOT NULL,
    [position] INT NOT NULL,
    [created_at] DATETIME2 NOT NULL CONSTRAINT [product_images_created_at_df] DEFAULT SYSUTCDATETIME(),
    CONSTRAINT [product_images_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [product_images_product_id_fkey] FOREIGN KEY ([product_id]) REFERENCES [dbo].[products]([id]) ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT [product_images_product_id_position_key] UNIQUE NONCLUSTERED ([product_id], [position])
);

ALTER TABLE [dbo].[product_variants] ADD [cost_price] DECIMAL(18,2) NOT NULL CONSTRAINT [product_variants_cost_price_df] DEFAULT 0;
ALTER TABLE [dbo].[order_items] ADD [unit_cost] DECIMAL(18,2) NOT NULL CONSTRAINT [order_items_unit_cost_df] DEFAULT 0;

/* New columns are not visible to the batch that adds them, so statements that use them run through EXEC. */
EXEC(N'UPDATE [dbo].[product_variants] SET [cost_price] = ROUND([price] * 0.8, 0)');
EXEC(N'UPDATE [dbo].[order_items] SET [unit_cost] = ROUND([unit_price] * 0.8, 0)');

EXEC(N'ALTER TABLE [dbo].[product_variants] ADD CONSTRAINT [product_variants_cost_price_check] CHECK ([cost_price] >= 0)');
EXEC(N'ALTER TABLE [dbo].[order_items] ADD CONSTRAINT [order_items_unit_cost_check] CHECK ([unit_cost] >= 0)');

ALTER TABLE [dbo].[users] DROP CONSTRAINT [users_status_check];
ALTER TABLE [dbo].[users] ADD CONSTRAINT [users_status_check] CHECK ([status] IN (N'UNVERIFIED', N'ACTIVE', N'BANNED'));

ALTER TABLE [dbo].[product_reviews] DROP CONSTRAINT [product_reviews_product_user_key];
ALTER TABLE [dbo].[product_reviews] ALTER COLUMN [user_id] NVARCHAR(36) NULL;
ALTER TABLE [dbo].[product_reviews] ADD [guest_name] NVARCHAR(60) NULL;

/* Filtered index: guests (user_id NULL) may comment many times; a signed-in user keeps one review per product. */
CREATE UNIQUE NONCLUSTERED INDEX [product_reviews_product_user_key] ON [dbo].[product_reviews]([product_id], [user_id]) WHERE [user_id] IS NOT NULL;

EXEC(N'ALTER TABLE [dbo].[product_reviews] ADD CONSTRAINT [product_reviews_guest_rating_check] CHECK ([rating] IS NULL OR [user_id] IS NOT NULL)');
EXEC(N'ALTER TABLE [dbo].[product_reviews] ADD CONSTRAINT [product_reviews_author_check] CHECK ([user_id] IS NOT NULL OR [guest_name] IS NOT NULL)');
