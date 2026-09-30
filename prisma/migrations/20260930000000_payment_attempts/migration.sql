BEGIN TRY
    BEGIN TRANSACTION;

    CREATE TABLE [dbo].[payment_attempts] (
        [id] NVARCHAR(64) NOT NULL,
        [order_id] NVARCHAR(64) NOT NULL,
        [provider] NVARCHAR(16) NOT NULL,
        [amount] DECIMAL(18,2) NOT NULL,
        [status] NVARCHAR(32) NOT NULL,
        [provider_transaction_id] NVARCHAR(100),
        [qr_payload] NVARCHAR(2000),
        [payment_url] NVARCHAR(2048),
        [expires_at] DATETIME2(3) NOT NULL,
        [inventory_released_at] DATETIME2(3),
        [completed_at] DATETIME2(3),
        [created_at] DATETIME2(3) NOT NULL CONSTRAINT [payment_attempts_created_at_df] DEFAULT SYSUTCDATETIME(),
        [updated_at] DATETIME2(3) NOT NULL CONSTRAINT [payment_attempts_updated_at_df] DEFAULT SYSUTCDATETIME(),
        CONSTRAINT [payment_attempts_pkey] PRIMARY KEY CLUSTERED ([id]),
        CONSTRAINT [payment_attempts_order_id_fkey] FOREIGN KEY ([order_id]) REFERENCES [dbo].[orders]([id]) ON DELETE NO ACTION ON UPDATE CASCADE,
        CONSTRAINT [payment_attempts_amount_check] CHECK ([amount] > 0),
        CONSTRAINT [payment_attempts_provider_check] CHECK ([provider] IN (N'MOMO', N'VNPAY')),
        CONSTRAINT [payment_attempts_status_check] CHECK ([status] IN (N'PENDING', N'FAILED', N'EXPIRED', N'SUCCEEDED', N'LATE_SUCCESS'))
    );

    CREATE NONCLUSTERED INDEX [payment_attempts_order_id_created_at_idx]
        ON [dbo].[payment_attempts]([order_id], [created_at]);

    CREATE NONCLUSTERED INDEX [payment_attempts_status_expires_at_idx]
        ON [dbo].[payment_attempts]([status], [expires_at]);

    CREATE NONCLUSTERED INDEX [payment_attempts_provider_transaction_id_idx]
        ON [dbo].[payment_attempts]([provider_transaction_id])
        WHERE [provider_transaction_id] IS NOT NULL;

    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0
        ROLLBACK TRANSACTION;
    THROW;
END CATCH;
