BEGIN TRY
    BEGIN TRANSACTION;

    CREATE TABLE [dbo].[categories] (
        [id] INT NOT NULL IDENTITY(1,1),
        [name] NVARCHAR(100) NOT NULL,
        [slug] NVARCHAR(160) NOT NULL,
        [description] NVARCHAR(1000),
        [created_at] DATETIME2(3) NOT NULL CONSTRAINT [categories_created_at_df] DEFAULT SYSUTCDATETIME(),
        CONSTRAINT [categories_pkey] PRIMARY KEY CLUSTERED ([id]),
        CONSTRAINT [categories_slug_key] UNIQUE NONCLUSTERED ([slug])
    );

    CREATE TABLE [dbo].[products] (
        [id] INT NOT NULL IDENTITY(1,1),
        [category_id] INT NOT NULL,
        [name] NVARCHAR(200) NOT NULL,
        [slug] NVARCHAR(240) NOT NULL,
        [sku] NVARCHAR(100) NOT NULL,
        [stock] INT NOT NULL,
        [price] DECIMAL(18,2) NOT NULL,
        [image] NVARCHAR(500) NOT NULL,
        [description] NVARCHAR(MAX) NOT NULL,
        [is_deleted] BIT NOT NULL CONSTRAINT [products_is_deleted_df] DEFAULT 0,
        [deleted_at] DATETIME2(3),
        [created_at] DATETIME2(3) NOT NULL CONSTRAINT [products_created_at_df] DEFAULT SYSUTCDATETIME(),
        [updated_at] DATETIME2(3) NOT NULL CONSTRAINT [products_updated_at_df] DEFAULT SYSUTCDATETIME(),
        CONSTRAINT [products_pkey] PRIMARY KEY CLUSTERED ([id]),
        CONSTRAINT [products_slug_key] UNIQUE NONCLUSTERED ([slug]),
        CONSTRAINT [products_sku_key] UNIQUE NONCLUSTERED ([sku]),
        CONSTRAINT [products_stock_check] CHECK ([stock] >= 0),
        CONSTRAINT [products_price_check] CHECK ([price] > 0),
        CONSTRAINT [products_category_id_fkey] FOREIGN KEY ([category_id]) REFERENCES [dbo].[categories]([id]) ON DELETE NO ACTION ON UPDATE CASCADE
    );

    CREATE TABLE [dbo].[orders] (
        [id] NVARCHAR(64) NOT NULL,
        [subtotal] DECIMAL(18,2) NOT NULL,
        [shipping_fee] DECIMAL(18,2) NOT NULL,
        [discount] DECIMAL(18,2) NOT NULL,
        [total_price] DECIMAL(18,2) NOT NULL,
        [customer_name] NVARCHAR(200) NOT NULL,
        [customer_phone] NVARCHAR(32) NOT NULL,
        [customer_address] NVARCHAR(500) NOT NULL,
        [customer_note] NVARCHAR(1000),
        [payment_method] NVARCHAR(64) NOT NULL,
        [order_status] NVARCHAR(32) NOT NULL,
        [payment_status] NVARCHAR(32) NOT NULL,
        [created_at] DATETIME2(3) NOT NULL CONSTRAINT [orders_created_at_df] DEFAULT SYSUTCDATETIME(),
        [updated_at] DATETIME2(3) NOT NULL CONSTRAINT [orders_updated_at_df] DEFAULT SYSUTCDATETIME(),
        CONSTRAINT [orders_pkey] PRIMARY KEY CLUSTERED ([id])
    );

    CREATE TABLE [dbo].[order_items] (
        [id] BIGINT NOT NULL IDENTITY(1,1),
        [order_id] NVARCHAR(64) NOT NULL,
        [product_id] INT NOT NULL,
        [name_snapshot] NVARCHAR(200) NOT NULL,
        [image_snapshot] NVARCHAR(500) NOT NULL,
        [unit_price] DECIMAL(18,2) NOT NULL,
        [quantity] INT NOT NULL,
        [line_total] DECIMAL(18,2) NOT NULL,
        CONSTRAINT [order_items_pkey] PRIMARY KEY CLUSTERED ([id]),
        CONSTRAINT [order_items_quantity_check] CHECK ([quantity] > 0),
        CONSTRAINT [order_items_order_id_fkey] FOREIGN KEY ([order_id]) REFERENCES [dbo].[orders]([id]) ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT [order_items_product_id_fkey] FOREIGN KEY ([product_id]) REFERENCES [dbo].[products]([id]) ON DELETE NO ACTION ON UPDATE CASCADE
    );

    CREATE TABLE [dbo].[audit_logs] (
        [id] NVARCHAR(80) NOT NULL,
        [actor] NVARCHAR(120) NOT NULL,
        [action] NVARCHAR(40) NOT NULL,
        [entity] NVARCHAR(40) NOT NULL,
        [entity_id] NVARCHAR(80) NOT NULL,
        [changes_json] NVARCHAR(MAX) NOT NULL,
        [timestamp] DATETIME2(3) NOT NULL CONSTRAINT [audit_logs_timestamp_df] DEFAULT SYSUTCDATETIME(),
        CONSTRAINT [audit_logs_pkey] PRIMARY KEY CLUSTERED ([id])
    );

    CREATE NONCLUSTERED INDEX [products_category_id_is_deleted_idx]
        ON [dbo].[products]([category_id], [is_deleted]);

    CREATE NONCLUSTERED INDEX [products_is_deleted_updated_at_idx]
        ON [dbo].[products]([is_deleted], [updated_at]);

    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0
        ROLLBACK TRANSACTION;
    THROW;
END CATCH;
