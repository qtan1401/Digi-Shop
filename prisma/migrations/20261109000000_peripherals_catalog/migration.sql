/* The shop sells computers and computer peripherals only: replace the brand / device type vocabulary.
   Brands: Apple, Samsung, MSI, Aula, Logitech, Razer, Keychron, Asus.
   Device types: laptop, keyboard, mouse, headphone, monitor, storage.
   Products of the retired device types (phone, tablet) are kept so order history, carts and reviews that point at them
   stay valid, but they are soft-deleted; the device type CHECK still accepts the two retired values for deleted rows
   only, so such a product can never be restored into the storefront. Fresh databases never contain them. */
BEGIN TRY
    BEGIN TRANSACTION;

    ALTER TABLE [dbo].[products] DROP CONSTRAINT [products_brand_check];
    ALTER TABLE [dbo].[products] DROP CONSTRAINT [products_device_type_check];

    UPDATE [dbo].[products]
    SET [is_deleted] = 1,
        [deleted_at] = COALESCE([deleted_at], SYSUTCDATETIME()),
        [updated_at] = SYSUTCDATETIME()
    WHERE [device_type] IN (N'phone', N'tablet') AND [is_deleted] = 0;

    ALTER TABLE [dbo].[products] ADD CONSTRAINT [products_brand_check]
        CHECK ([brand] IN (N'Apple', N'Samsung', N'MSI', N'Aula', N'Logitech', N'Razer', N'Keychron', N'Asus'));
    ALTER TABLE [dbo].[products] ADD CONSTRAINT [products_device_type_check]
        CHECK ([device_type] IN (N'laptop', N'keyboard', N'mouse', N'headphone', N'monitor', N'storage')
            OR ([is_deleted] = 1 AND [device_type] IN (N'phone', N'tablet')));

    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0
        ROLLBACK TRANSACTION;
    THROW;
END CATCH;
