const jwt = require("jsonwebtoken");

function authenticateUser(req, res, next) {
    try {
        // Get token from Authorization header: "Bearer <token>"
        const authHeader = req.headers["authorization"];
        const token = authHeader && authHeader.split(" ")[1];

        if (!token) {
            return res.status(401).json({ error: "Access denied. No token provided." });
        }

        // Verify token
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        // Attach decoded payload (usually { id, email, role }) to request
        req.user = decoded;

        // Pass control to next middleware/route
        next();
    } catch (error) {
        console.error("JWT verification failed:", error.message);
        return res.status(401).json({ error: "Invalid or expired token." });
    }
}

module.exports = authenticateUser;
