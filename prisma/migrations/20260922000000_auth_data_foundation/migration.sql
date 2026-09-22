BEGIN TRY
    BEGIN TRANSACTION;

    ALTER TABLE [dbo].[orders]
        ADD [user_id] NVARCHAR(36) NULL;

    CREATE TABLE [dbo].[users] (
        [id] NVARCHAR(36) NOT NULL,
        [email] NVARCHAR(320) NULL,
        [username] NVARCHAR(64) NULL,
        [password_hash] NVARCHAR(255) NULL,
        [role] NVARCHAR(16) NOT NULL CONSTRAINT [users_role_df] DEFAULT N'user',
        [status] NVARCHAR(20) NOT NULL CONSTRAINT [users_status_df] DEFAULT N'UNVERIFIED',
        [email_verified_at] DATETIME2(3) NULL,
        [failed_password_attempts] INT NOT NULL CONSTRAINT [users_failed_password_attempts_df] DEFAULT 0,
        [password_locked_at] DATETIME2(3) NULL,
        [force_password_change] BIT NOT NULL CONSTRAINT [users_force_password_change_df] DEFAULT 0,
        [auth_version] INT NOT NULL CONSTRAINT [users_auth_version_df] DEFAULT 1,
        [created_at] DATETIME2(3) NOT NULL CONSTRAINT [users_created_at_df] DEFAULT SYSUTCDATETIME(),
        [updated_at] DATETIME2(3) NOT NULL CONSTRAINT [users_updated_at_df] DEFAULT SYSUTCDATETIME(),
        CONSTRAINT [users_pkey] PRIMARY KEY CLUSTERED ([id]),
        CONSTRAINT [users_role_check] CHECK ([role] IN (N'user', N'admin')),
        CONSTRAINT [users_status_check] CHECK ([status] IN (N'UNVERIFIED', N'ACTIVE')),
        CONSTRAINT [users_role_identity_check] CHECK (
            ([role] = N'user' AND [email] IS NOT NULL)
            OR ([role] = N'admin' AND [username] IS NOT NULL)
        ),
        CONSTRAINT [users_identity_check] CHECK ([email] IS NOT NULL OR [username] IS NOT NULL),
        CONSTRAINT [users_failed_password_attempts_check] CHECK ([failed_password_attempts] >= 0),
        CONSTRAINT [users_auth_version_check] CHECK ([auth_version] > 0)
    );

    CREATE TABLE [dbo].[oauth_identities] (
        [id] NVARCHAR(36) NOT NULL,
        [user_id] NVARCHAR(36) NOT NULL,
        [provider] NVARCHAR(32) NOT NULL,
        [provider_subject] NVARCHAR(255) NOT NULL,
        [email_snapshot] NVARCHAR(320) NOT NULL,
        [created_at] DATETIME2(3) NOT NULL CONSTRAINT [oauth_identities_created_at_df] DEFAULT SYSUTCDATETIME(),
        [updated_at] DATETIME2(3) NOT NULL CONSTRAINT [oauth_identities_updated_at_df] DEFAULT SYSUTCDATETIME(),
        CONSTRAINT [oauth_identities_pkey] PRIMARY KEY CLUSTERED ([id]),
        CONSTRAINT [oauth_identities_provider_check] CHECK ([provider] = N'google'),
        CONSTRAINT [oauth_identities_user_id_fkey] FOREIGN KEY ([user_id]) REFERENCES [dbo].[users]([id]) ON DELETE CASCADE ON UPDATE NO ACTION
    );

    CREATE TABLE [dbo].[refresh_sessions] (
        [id] NVARCHAR(36) NOT NULL,
        [user_id] NVARCHAR(36) NOT NULL,
        [family_id] NVARCHAR(36) NOT NULL,
        [token_hash] CHAR(64) NOT NULL,
        [replaced_by_id] NVARCHAR(36) NULL,
        [remembered] BIT NOT NULL CONSTRAINT [refresh_sessions_remembered_df] DEFAULT 0,
        [expires_at] DATETIME2(3) NOT NULL,
        [revoked_at] DATETIME2(3) NULL,
        [created_at] DATETIME2(3) NOT NULL CONSTRAINT [refresh_sessions_created_at_df] DEFAULT SYSUTCDATETIME(),
        [last_used_at] DATETIME2(3) NOT NULL CONSTRAINT [refresh_sessions_last_used_at_df] DEFAULT SYSUTCDATETIME(),
        CONSTRAINT [refresh_sessions_pkey] PRIMARY KEY CLUSTERED ([id]),
        CONSTRAINT [refresh_sessions_user_id_fkey] FOREIGN KEY ([user_id]) REFERENCES [dbo].[users]([id]) ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT [refresh_sessions_replaced_by_id_fkey] FOREIGN KEY ([replaced_by_id]) REFERENCES [dbo].[refresh_sessions]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION
    );

    CREATE TABLE [dbo].[email_verification_tokens] (
        [id] NVARCHAR(36) NOT NULL,
        [user_id] NVARCHAR(36) NOT NULL,
        [token_hash] CHAR(64) NOT NULL,
        [expires_at] DATETIME2(3) NOT NULL,
        [used_at] DATETIME2(3) NULL,
        [created_at] DATETIME2(3) NOT NULL CONSTRAINT [email_verification_tokens_created_at_df] DEFAULT SYSUTCDATETIME(),
        CONSTRAINT [email_verification_tokens_pkey] PRIMARY KEY CLUSTERED ([id]),
        CONSTRAINT [email_verification_tokens_user_id_fkey] FOREIGN KEY ([user_id]) REFERENCES [dbo].[users]([id]) ON DELETE CASCADE ON UPDATE NO ACTION
    );

    CREATE TABLE [dbo].[carts] (
        [id] NVARCHAR(36) NOT NULL,
        [user_id] NVARCHAR(36) NOT NULL,
        [created_at] DATETIME2(3) NOT NULL CONSTRAINT [carts_created_at_df] DEFAULT SYSUTCDATETIME(),
        [updated_at] DATETIME2(3) NOT NULL CONSTRAINT [carts_updated_at_df] DEFAULT SYSUTCDATETIME(),
        CONSTRAINT [carts_pkey] PRIMARY KEY CLUSTERED ([id]),
        CONSTRAINT [carts_user_id_fkey] FOREIGN KEY ([user_id]) REFERENCES [dbo].[users]([id]) ON DELETE CASCADE ON UPDATE NO ACTION
    );

    CREATE TABLE [dbo].[cart_items] (
        [id] BIGINT NOT NULL IDENTITY(1,1),
        [cart_id] NVARCHAR(36) NOT NULL,
        [product_id] INT NOT NULL,
        [quantity] INT NOT NULL,
        [created_at] DATETIME2(3) NOT NULL CONSTRAINT [cart_items_created_at_df] DEFAULT SYSUTCDATETIME(),
        [updated_at] DATETIME2(3) NOT NULL CONSTRAINT [cart_items_updated_at_df] DEFAULT SYSUTCDATETIME(),
        CONSTRAINT [cart_items_pkey] PRIMARY KEY CLUSTERED ([id]),
        CONSTRAINT [cart_items_quantity_check] CHECK ([quantity] > 0),
        CONSTRAINT [cart_items_cart_id_fkey] FOREIGN KEY ([cart_id]) REFERENCES [dbo].[carts]([id]) ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT [cart_items_product_id_fkey] FOREIGN KEY ([product_id]) REFERENCES [dbo].[products]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION
    );

    CREATE TABLE [dbo].[cart_merge_operations] (
        [operation_id] NVARCHAR(64) NOT NULL,
        [user_id] NVARCHAR(36) NOT NULL,
        [request_hash] CHAR(64) NOT NULL,
        [status] NVARCHAR(16) NOT NULL,
        [result_json] NVARCHAR(MAX) NULL,
        [created_at] DATETIME2(3) NOT NULL CONSTRAINT [cart_merge_operations_created_at_df] DEFAULT SYSUTCDATETIME(),
        [completed_at] DATETIME2(3) NULL,
        CONSTRAINT [cart_merge_operations_pkey] PRIMARY KEY CLUSTERED ([operation_id]),
        CONSTRAINT [cart_merge_operations_status_check] CHECK ([status] IN (N'IN_PROGRESS', N'COMPLETED')),
        CONSTRAINT [cart_merge_operations_user_id_fkey] FOREIGN KEY ([user_id]) REFERENCES [dbo].[users]([id]) ON DELETE CASCADE ON UPDATE NO ACTION
    );

    ALTER TABLE [dbo].[orders]
        ADD CONSTRAINT [orders_user_id_fkey]
        FOREIGN KEY ([user_id]) REFERENCES [dbo].[users]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

    CREATE UNIQUE NONCLUSTERED INDEX [users_email_unique]
        ON [dbo].[users]([email])
        WHERE [email] IS NOT NULL;

    CREATE UNIQUE NONCLUSTERED INDEX [users_username_unique]
        ON [dbo].[users]([username])
        WHERE [username] IS NOT NULL;

    CREATE UNIQUE NONCLUSTERED INDEX [oauth_identities_provider_subject_key]
        ON [dbo].[oauth_identities]([provider], [provider_subject]);
    CREATE UNIQUE NONCLUSTERED INDEX [oauth_identities_user_id_provider_key]
        ON [dbo].[oauth_identities]([user_id], [provider]);

    CREATE NONCLUSTERED INDEX [oauth_identities_user_id_idx]
        ON [dbo].[oauth_identities]([user_id]);

    CREATE UNIQUE NONCLUSTERED INDEX [refresh_sessions_token_hash_key]
        ON [dbo].[refresh_sessions]([token_hash]);

    CREATE NONCLUSTERED INDEX [refresh_sessions_user_id_revoked_at_idx]
        ON [dbo].[refresh_sessions]([user_id], [revoked_at]);

    CREATE NONCLUSTERED INDEX [refresh_sessions_family_id_revoked_at_idx]
        ON [dbo].[refresh_sessions]([family_id], [revoked_at]);

    CREATE NONCLUSTERED INDEX [refresh_sessions_expires_at_idx]
        ON [dbo].[refresh_sessions]([expires_at]);

    CREATE UNIQUE NONCLUSTERED INDEX [email_verification_tokens_token_hash_key]
        ON [dbo].[email_verification_tokens]([token_hash]);

    CREATE NONCLUSTERED INDEX [email_verification_tokens_user_id_used_at_expires_at_idx]
        ON [dbo].[email_verification_tokens]([user_id], [used_at], [expires_at]);

    CREATE UNIQUE NONCLUSTERED INDEX [carts_user_id_key]
        ON [dbo].[carts]([user_id]);

    CREATE UNIQUE NONCLUSTERED INDEX [cart_items_cart_id_product_id_key]
        ON [dbo].[cart_items]([cart_id], [product_id]);

    CREATE NONCLUSTERED INDEX [cart_merge_operations_user_id_created_at_idx]
        ON [dbo].[cart_merge_operations]([user_id], [created_at]);

    CREATE NONCLUSTERED INDEX [orders_user_id_created_at_idx]
        ON [dbo].[orders]([user_id], [created_at]);

    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0
        ROLLBACK TRANSACTION;
    THROW;
END CATCH;
