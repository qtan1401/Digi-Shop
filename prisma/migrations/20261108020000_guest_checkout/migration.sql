/* Guest checkout. Additive only: two nullable columns on orders, so every existing Order is unaffected.
   customer_email is the address a guest typed (the order confirmation goes there); guest_access_token_hash is the
   SHA-256 (hex) of the random token returned once at checkout, never the token itself. The guest's account is an
   ordinary users row (role user, status UNVERIFIED, no password_hash), found or created by normalised email;
   users_email_unique already makes concurrent creation for one email end with a single row. */

ALTER TABLE [dbo].[orders] ADD
    [customer_email] NVARCHAR(320) NULL,
    [guest_access_token_hash] NVARCHAR(64) NULL;
