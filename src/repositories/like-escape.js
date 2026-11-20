// Escapes LIKE metacharacters so user search text is matched literally (backslash is PostgreSQL's default escape).
const escapeLike = (value) => String(value).replace(/[\\%_]/g, "\\$&");

module.exports = { escapeLike };
