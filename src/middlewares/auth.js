// ===== AUTH MIDDLEWARE =====
// Stub implementation for P0 - O1
// TODO: Replace with real JWT verification when auth system is implemented

/**
 * Middleware to require specific role(s)
 * @param {...string} roles - Allowed roles (e.g., "admin", "user")
 * @returns {Function} Express middleware
 */
const requireRole = (...roles) => (req, res, next) => {
  // Stub: Check for admin key in header
  // In production: verify JWT token, extract user.role, check against roles
  const adminKey = req.headers["x-admin-key"] || req.query.admin_key;
  const isAdmin = adminKey === "dev-secret";

  if (!isAdmin) {
    return res.status(401).json({
      success: false,
      message: "Yêu cầu quyền admin"
    });
  }

  req.user = { role: "admin" };
  next();
};

/**
 * Optional: Middleware to attach user from token (for future use)
 * Currently returns null user
 */
const attachUser = (req, res, next) => {
  // TODO: Implement JWT verify
  // const token = req.headers.authorization?.replace("Bearer ", "");
  // if (token) { req.user = verifyToken(token); }
  req.user = null;
  next();
};

module.exports = {
  requireRole,
  attachUser
};