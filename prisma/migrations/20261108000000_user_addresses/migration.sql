/* Customer full name and saved delivery addresses. Additive only: one nullable column and one new table.
   The filtered unique index guarantees at most one default address per user; the service keeps exactly one. */

ALTER TABLE [dbo].[users] ADD [full_name] NVARCHAR(200) NULL;

CREATE TABLE [dbo].[user_addresses] (
    [id] NVARCHAR(36) NOT NULL,
    [user_id] NVARCHAR(36) NOT NULL,
    [recipient_name] NVARCHAR(200) NOT NULL,
    [phone] NVARCHAR(20) NOT NULL,
    [address_line] NVARCHAR(500) NOT NULL,
    [is_default] BIT NOT NULL CONSTRAINT [user_addresses_is_default_df] DEFAULT 0,
    [created_at] DATETIME2 NOT NULL CONSTRAINT [user_addresses_created_at_df] DEFAULT SYSUTCDATETIME(),
    [updated_at] DATETIME2 NOT NULL CONSTRAINT [user_addresses_updated_at_df] DEFAULT SYSUTCDATETIME(),
    CONSTRAINT [user_addresses_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [user_addresses_user_id_fkey] FOREIGN KEY ([user_id]) REFERENCES [dbo].[users]([id]) ON DELETE CASCADE ON UPDATE NO ACTION
);

CREATE NONCLUSTERED INDEX [user_addresses_user_id_idx] ON [dbo].[user_addresses]([user_id]);

CREATE UNIQUE NONCLUSTERED INDEX [user_addresses_one_default_per_user]
    ON [dbo].[user_addresses]([user_id])
    WHERE [is_default] = 1;
