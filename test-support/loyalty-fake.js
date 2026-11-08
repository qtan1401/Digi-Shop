// Fake-Prisma pieces for Loyalty points, shared by the integration tests that run checkout / payments / cancels.
// `getState` returns the current in-memory state (it is swapped on transaction start and restored on rollback).
// The user balance enforces the same CHECK as the database (loyalty_points >= 0).

const userPointsMethods = (getState) => ({
    updateMany: async ({ where, data }) => {
        const row = getState().users.get(where.id);
        if (!row) return { count: 0 };
        const balance = row.loyaltyPoints ?? 0;
        if (where.loyaltyPoints?.gte !== undefined && balance < where.loyaltyPoints.gte) return { count: 0 };
        let next = balance;
        if (data.loyaltyPoints?.increment !== undefined) next += data.loyaltyPoints.increment;
        if (data.loyaltyPoints?.decrement !== undefined) next -= data.loyaltyPoints.decrement;
        if (next < 0) throw Object.assign(new Error("CHECK constraint users_loyalty_points_check"), { code: "CHECK_VIOLATION" });
        row.loyaltyPoints = next;
        return { count: 1 };
    }
});

/** Result of the `SELECT ... FROM [dbo].[users] WITH (UPDLOCK ...)` balance lock; also records that the lock was taken. */
const lockUserRows = (state, userId) => {
    state.userLocks = [...(state.userLocks || []), userId];
    const row = state.users.get(userId);
    return row ? [{ loyaltyPoints: row.loyaltyPoints ?? 0 }] : [];
};

module.exports = { userPointsMethods, lockUserRows };
