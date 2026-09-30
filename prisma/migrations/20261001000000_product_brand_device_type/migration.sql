/* Preserve every product while replacing its category foreign key with fixed catalog facets. */
ALTER TABLE [dbo].[products] ADD [brand] NVARCHAR(16) NULL;
ALTER TABLE [dbo].[products] ADD [device_type] NVARCHAR(16) NULL;

UPDATE product
SET [brand] = CASE
        WHEN product.[name] LIKE N'%Samsung%' THEN N'Samsung'
        WHEN product.[name] LIKE N'%MSI%' THEN N'MSI'
        ELSE N'Apple'
    END,
    [device_type] = CASE
        WHEN category.[name] LIKE N'%laptop%' OR product.[name] LIKE N'%laptop%' OR product.[name] LIKE N'%MacBook%' THEN N'laptop'
        WHEN category.[name] LIKE N'%tablet%' OR product.[name] LIKE N'%tablet%' OR product.[name] LIKE N'%iPad%' THEN N'tablet'
        ELSE N'phone'
    END
FROM [dbo].[products] AS product
INNER JOIN [dbo].[categories] AS category ON category.[id] = product.[category_id];

ALTER TABLE [dbo].[products] ALTER COLUMN [brand] NVARCHAR(16) NOT NULL;
ALTER TABLE [dbo].[products] ALTER COLUMN [device_type] NVARCHAR(16) NOT NULL;
ALTER TABLE [dbo].[products] ADD CONSTRAINT [products_brand_check] CHECK ([brand] IN (N'Apple', N'Samsung', N'MSI'));
ALTER TABLE [dbo].[products] ADD CONSTRAINT [products_device_type_check] CHECK ([device_type] IN (N'phone', N'tablet', N'laptop'));

DROP INDEX [products_category_id_is_deleted_idx] ON [dbo].[products];
ALTER TABLE [dbo].[products] DROP CONSTRAINT [products_category_id_fkey];
ALTER TABLE [dbo].[products] DROP COLUMN [category_id];
