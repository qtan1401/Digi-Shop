/* Color swatch metadata per option value, and a per-variant image override so the storefront can switch the product photo by selected color. */
ALTER TABLE [dbo].[product_option_values] ADD [color_hex] NVARCHAR(7) NULL;
ALTER TABLE [dbo].[product_variants] ADD [image] NVARCHAR(500) NULL;
