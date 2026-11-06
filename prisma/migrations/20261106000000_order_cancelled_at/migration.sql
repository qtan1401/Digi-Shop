/* When an Order was cancelled. Existing cancelled orders take their last update time, the closest record available.
   The backfill runs through EXEC so it is compiled after the column exists (same batch). */

ALTER TABLE [dbo].[orders] ADD [cancelled_at] DATETIME2 NULL;

EXEC(N'UPDATE [dbo].[orders] SET [cancelled_at] = [updated_at] WHERE [order_status] = N''CANCELLED'' AND [cancelled_at] IS NULL;');
