/* One-time password reset links. Additive only: one new table.
   Only the SHA-256 of the token is stored (token_hash, CHAR(64)); rows go with their user. */

CREATE TABLE [dbo].[password_reset_tokens] (
    [id] NVARCHAR(36) NOT NULL,
    [user_id] NVARCHAR(36) NOT NULL,
    [token_hash] CHAR(64) NOT NULL,
    [expires_at] DATETIME2 NOT NULL,
    [used_at] DATETIME2 NULL,
    [created_at] DATETIME2 NOT NULL CONSTRAINT [password_reset_tokens_created_at_df] DEFAULT SYSUTCDATETIME(),
    CONSTRAINT [password_reset_tokens_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [password_reset_tokens_token_hash_key] UNIQUE NONCLUSTERED ([token_hash]),
    CONSTRAINT [password_reset_tokens_user_id_fkey] FOREIGN KEY ([user_id]) REFERENCES [dbo].[users]([id]) ON DELETE CASCADE ON UPDATE NO ACTION
);

CREATE NONCLUSTERED INDEX [password_reset_tokens_user_id_idx] ON [dbo].[password_reset_tokens]([user_id]);
