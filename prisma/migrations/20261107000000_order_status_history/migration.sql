/* Status timeline per Order. Existing orders are backfilled with PENDING at creation and, when they have moved on,
   their current status at the last update time (the closest record available).
   Backfill runs through EXEC so it compiles after the table exists (same batch). */

CREATE TABLE [dbo].[order_status_history] (
    [id] BIGINT NOT NULL IDENTITY(1,1),
    [order_id] NVARCHAR(64) NOT NULL,
    [status] NVARCHAR(32) NOT NULL,
    [created_at] DATETIME2 NOT NULL CONSTRAINT [order_status_history_created_at_df] DEFAULT SYSUTCDATETIME(),
    CONSTRAINT [order_status_history_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [order_status_history_order_id_fkey] FOREIGN KEY ([order_id]) REFERENCES [dbo].[orders]([id]) ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE NONCLUSTERED INDEX [order_status_history_order_id_created_at_idx] ON [dbo].[order_status_history]([order_id], [created_at]);

EXEC(N'INSERT INTO [dbo].[order_status_history] ([order_id], [status], [created_at]) SELECT [id], N''PENDING'', [created_at] FROM [dbo].[orders];');
EXEC(N'INSERT INTO [dbo].[order_status_history] ([order_id], [status], [created_at]) SELECT [id], [order_status], COALESCE([cancelled_at], [updated_at]) FROM [dbo].[orders] WHERE [order_status] <> N''PENDING'';');
