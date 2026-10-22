BEGIN TRY
    BEGIN TRANSACTION;

    CREATE TABLE [dbo].[product_options] (
        [id] INT NOT NULL IDENTITY(1,1),
        [product_id] INT NOT NULL,
        [name] NVARCHAR(100) NOT NULL,
        [position] INT NOT NULL,
        [is_active] BIT NOT NULL CONSTRAINT [product_options_is_active_df] DEFAULT 1,
        CONSTRAINT [product_options_pkey] PRIMARY KEY CLUSTERED ([id]),
        CONSTRAINT [product_options_product_id_name_key] UNIQUE NONCLUSTERED ([product_id], [name]),
        CONSTRAINT [product_options_product_id_position_key] UNIQUE NONCLUSTERED ([product_id], [position]),
        CONSTRAINT [product_options_product_id_fkey] FOREIGN KEY ([product_id]) REFERENCES [dbo].[products]([id]) ON DELETE NO ACTION ON UPDATE CASCADE
    );

    CREATE NONCLUSTERED INDEX [product_options_product_id_is_active_position_idx]
        ON [dbo].[product_options]([product_id], [is_active], [position]);

    CREATE TABLE [dbo].[product_option_values] (
        [id] INT NOT NULL IDENTITY(1,1),
        [option_id] INT NOT NULL,
        [value] NVARCHAR(100) NOT NULL,
        [position] INT NOT NULL,
        [is_active] BIT NOT NULL CONSTRAINT [product_option_values_is_active_df] DEFAULT 1,
        CONSTRAINT [product_option_values_pkey] PRIMARY KEY CLUSTERED ([id]),
        CONSTRAINT [product_option_values_option_id_value_key] UNIQUE NONCLUSTERED ([option_id], [value]),
        CONSTRAINT [product_option_values_option_id_position_key] UNIQUE NONCLUSTERED ([option_id], [position]),
        CONSTRAINT [product_option_values_option_id_fkey] FOREIGN KEY ([option_id]) REFERENCES [dbo].[product_options]([id]) ON DELETE NO ACTION ON UPDATE CASCADE
    );

    CREATE NONCLUSTERED INDEX [product_option_values_option_id_is_active_position_idx]
        ON [dbo].[product_option_values]([option_id], [is_active], [position]);

    CREATE TABLE [dbo].[product_variants] (
        [id] INT NOT NULL IDENTITY(1,1),
        [product_id] INT NOT NULL,
        [sku] NVARCHAR(100) NOT NULL,
        [combination_key] CHAR(64) NOT NULL,
        [price] DECIMAL(18,2) NOT NULL,
        [stock] INT NOT NULL,
        [is_active] BIT NOT NULL CONSTRAINT [product_variants_is_active_df] DEFAULT 1,
        [created_at] DATETIME2(3) NOT NULL CONSTRAINT [product_variants_created_at_df] DEFAULT SYSUTCDATETIME(),
        [updated_at] DATETIME2(3) NOT NULL CONSTRAINT [product_variants_updated_at_df] DEFAULT SYSUTCDATETIME(),
        CONSTRAINT [product_variants_pkey] PRIMARY KEY CLUSTERED ([id]),
        CONSTRAINT [product_variants_sku_key] UNIQUE NONCLUSTERED ([sku]),
        CONSTRAINT [product_variants_product_id_combination_key_key] UNIQUE NONCLUSTERED ([product_id], [combination_key]),
        CONSTRAINT [product_variants_stock_check] CHECK ([stock] >= 0),
        CONSTRAINT [product_variants_price_check] CHECK ([price] > 0),
        CONSTRAINT [product_variants_product_id_fkey] FOREIGN KEY ([product_id]) REFERENCES [dbo].[products]([id]) ON DELETE NO ACTION ON UPDATE CASCADE
    );

    CREATE NONCLUSTERED INDEX [product_variants_product_id_is_active_idx]
        ON [dbo].[product_variants]([product_id], [is_active]);

    CREATE TABLE [dbo].[product_variant_option_values] (
        [variant_id] INT NOT NULL,
        [option_value_id] INT NOT NULL,
        CONSTRAINT [product_variant_option_values_pkey] PRIMARY KEY CLUSTERED ([variant_id], [option_value_id]),
        CONSTRAINT [product_variant_option_values_variant_id_fkey] FOREIGN KEY ([variant_id]) REFERENCES [dbo].[product_variants]([id]) ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT [product_variant_option_values_option_value_id_fkey] FOREIGN KEY ([option_value_id]) REFERENCES [dbo].[product_option_values]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION
    );

    CREATE NONCLUSTERED INDEX [product_variant_option_values_option_value_id_idx]
        ON [dbo].[product_variant_option_values]([option_value_id]);

    DECLARE @emptyCombinationKey CHAR(64) = '4F53CDA18C2BA0C0354BB5F9A3ECBE5ED12AB4D8E11BA873C2F11161202B945';

    INSERT INTO [dbo].[product_variants] ([product_id], [sku], [combination_key], [price], [stock], [is_active], [created_at], [updated_at])
    SELECT [id], [sku], @emptyCombinationKey, [price], [stock], 1, [created_at], [updated_at]
    FROM [dbo].[products];

    ALTER TABLE [dbo].[cart_items] ADD [variant_id] INT NULL;
    ALTER TABLE [dbo].[order_items] ADD [variant_id] INT NULL;
    ALTER TABLE [dbo].[order_items] ADD [sku_snapshot] NVARCHAR(100) NULL;
    ALTER TABLE [dbo].[order_items] ADD [options_snapshot] NVARCHAR(MAX) NULL;

    UPDATE cartItem
    SET [variant_id] = variant.[id]
    FROM [dbo].[cart_items] AS cartItem
    INNER JOIN [dbo].[product_variants] AS variant ON variant.[product_id] = cartItem.[product_id];

    UPDATE orderItem
    SET [variant_id] = variant.[id],
        [sku_snapshot] = product.[sku],
        [options_snapshot] = N'{}'
    FROM [dbo].[order_items] AS orderItem
    INNER JOIN [dbo].[products] AS product ON product.[id] = orderItem.[product_id]
    INNER JOIN [dbo].[product_variants] AS variant ON variant.[product_id] = orderItem.[product_id];

    ALTER TABLE [dbo].[cart_items] DROP CONSTRAINT [cart_items_product_id_fkey];
    DROP INDEX [cart_items_cart_id_product_id_key] ON [dbo].[cart_items];
    ALTER TABLE [dbo].[cart_items] DROP COLUMN [product_id];
    ALTER TABLE [dbo].[cart_items] ALTER COLUMN [variant_id] INT NOT NULL;
    ALTER TABLE [dbo].[cart_items]
        ADD CONSTRAINT [cart_items_variant_id_fkey]
        FOREIGN KEY ([variant_id]) REFERENCES [dbo].[product_variants]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
    CREATE UNIQUE NONCLUSTERED INDEX [cart_items_cart_id_variant_id_key]
        ON [dbo].[cart_items]([cart_id], [variant_id]);

    ALTER TABLE [dbo].[order_items] DROP CONSTRAINT [order_items_product_id_fkey];
    ALTER TABLE [dbo].[order_items] DROP COLUMN [product_id];
    ALTER TABLE [dbo].[order_items] ALTER COLUMN [variant_id] INT NOT NULL;
    ALTER TABLE [dbo].[order_items] ALTER COLUMN [sku_snapshot] NVARCHAR(100) NOT NULL;
    ALTER TABLE [dbo].[order_items] ALTER COLUMN [options_snapshot] NVARCHAR(MAX) NOT NULL;
    ALTER TABLE [dbo].[order_items]
        ADD CONSTRAINT [order_items_variant_id_fkey]
        FOREIGN KEY ([variant_id]) REFERENCES [dbo].[product_variants]([id]) ON DELETE NO ACTION ON UPDATE CASCADE;

    ALTER TABLE [dbo].[products] DROP CONSTRAINT [products_sku_key];
    ALTER TABLE [dbo].[products] DROP CONSTRAINT [products_stock_check];
    ALTER TABLE [dbo].[products] DROP CONSTRAINT [products_price_check];
    ALTER TABLE [dbo].[products] DROP COLUMN [sku], [stock], [price];

    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0
        ROLLBACK TRANSACTION;
    THROW;
END CATCH;
