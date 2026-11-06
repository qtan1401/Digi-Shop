/* Vouchers, per-order voucher snapshots, and product reviews. Additive only: no existing table or row changes. */

CREATE TABLE [dbo].[vouchers] (
    [id] INT NOT NULL IDENTITY(1,1),
    [code] NVARCHAR(20) NOT NULL,
    [description] NVARCHAR(200) NOT NULL,
    [type] NVARCHAR(16) NOT NULL,
    [percent] INT NULL,
    [max_discount] DECIMAL(18,2) NULL,
    [starts_at] DATETIME2 NOT NULL,
    [ends_at] DATETIME2 NOT NULL,
    [quantity] INT NOT NULL,
    [redeemed_count] INT NOT NULL CONSTRAINT [vouchers_redeemed_count_df] DEFAULT 0,
    [is_enabled] BIT NOT NULL CONSTRAINT [vouchers_is_enabled_df] DEFAULT 1,
    [is_listed] BIT NOT NULL CONSTRAINT [vouchers_is_listed_df] DEFAULT 1,
    [created_at] DATETIME2 NOT NULL CONSTRAINT [vouchers_created_at_df] DEFAULT SYSUTCDATETIME(),
    [updated_at] DATETIME2 NOT NULL CONSTRAINT [vouchers_updated_at_df] DEFAULT SYSUTCDATETIME(),
    CONSTRAINT [vouchers_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [vouchers_code_key] UNIQUE NONCLUSTERED ([code]),
    CONSTRAINT [vouchers_code_check] CHECK (LEN([code]) BETWEEN 3 AND 20 AND [code] NOT LIKE N'%[^A-Z0-9]%' COLLATE Latin1_General_BIN),
    CONSTRAINT [vouchers_type_check] CHECK ([type] IN (N'PERCENT', N'FREE_SHIPPING')),
    -- A percentage voucher carries a percent and a maximum Discount (at most 500,000 VND); a free-shipping one carries neither.
    CONSTRAINT [vouchers_shape_check] CHECK (
        ([type] = N'PERCENT' AND [percent] BETWEEN 1 AND 100 AND [max_discount] BETWEEN 1000 AND 500000)
        OR ([type] = N'FREE_SHIPPING' AND [percent] IS NULL AND [max_discount] IS NULL)
    ),
    CONSTRAINT [vouchers_period_check] CHECK ([ends_at] > [starts_at]),
    CONSTRAINT [vouchers_quantity_check] CHECK ([quantity] >= 0 AND [redeemed_count] >= 0 AND [redeemed_count] <= [quantity])
);

CREATE TABLE [dbo].[order_vouchers] (
    [order_id] NVARCHAR(64) NOT NULL,
    [voucher_id] INT NOT NULL,
    [code_snapshot] NVARCHAR(20) NOT NULL,
    [type_snapshot] NVARCHAR(16) NOT NULL,
    [percent_snapshot] INT NULL,
    [discount_amount] DECIMAL(18,2) NOT NULL,
    [released_at] DATETIME2 NULL,
    CONSTRAINT [order_vouchers_pkey] PRIMARY KEY CLUSTERED ([order_id], [voucher_id]),
    CONSTRAINT [order_vouchers_order_id_fkey] FOREIGN KEY ([order_id]) REFERENCES [dbo].[orders]([id]) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT [order_vouchers_voucher_id_fkey] FOREIGN KEY ([voucher_id]) REFERENCES [dbo].[vouchers]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT [order_vouchers_amount_check] CHECK ([discount_amount] >= 0 AND [discount_amount] <= 500000)
);
CREATE NONCLUSTERED INDEX [order_vouchers_voucher_id_idx] ON [dbo].[order_vouchers]([voucher_id]);

CREATE TABLE [dbo].[product_reviews] (
    [id] INT NOT NULL IDENTITY(1,1),
    [product_id] INT NOT NULL,
    [user_id] NVARCHAR(36) NOT NULL,
    [rating] TINYINT NULL,
    [comment] NVARCHAR(1000) NULL,
    [is_hidden] BIT NOT NULL CONSTRAINT [product_reviews_is_hidden_df] DEFAULT 0,
    [created_at] DATETIME2 NOT NULL CONSTRAINT [product_reviews_created_at_df] DEFAULT SYSUTCDATETIME(),
    [updated_at] DATETIME2 NOT NULL CONSTRAINT [product_reviews_updated_at_df] DEFAULT SYSUTCDATETIME(),
    CONSTRAINT [product_reviews_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [product_reviews_product_id_fkey] FOREIGN KEY ([product_id]) REFERENCES [dbo].[products]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT [product_reviews_user_id_fkey] FOREIGN KEY ([user_id]) REFERENCES [dbo].[users]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT [product_reviews_product_user_key] UNIQUE NONCLUSTERED ([product_id], [user_id]),
    CONSTRAINT [product_reviews_rating_check] CHECK ([rating] IS NULL OR [rating] BETWEEN 1 AND 5),
    CONSTRAINT [product_reviews_content_check] CHECK ([rating] IS NOT NULL OR ([comment] IS NOT NULL AND LEN(LTRIM(RTRIM([comment]))) > 0))
);
CREATE NONCLUSTERED INDEX [product_reviews_product_idx] ON [dbo].[product_reviews]([product_id], [is_hidden], [created_at]);
