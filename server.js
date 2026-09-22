require("dotenv").config();

const app = require("./src/app");
const { runServer } = require("./src/server-lifecycle");

const PORT = process.env.PORT || 3000;

if (require.main === module) {
    void runServer({ app, port: PORT });
}

module.exports = { runServer };