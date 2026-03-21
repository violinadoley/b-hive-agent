/**
 * Entry: smoke test. Run: cd agents && node test-main.js
 */
const { runSmoke } = require("./src/run-smoke");

runSmoke()
  .then((out) => console.log(out))
  .catch((err) => {
    console.error("\nSmoke test failed:", err.message);
    process.exit(1);
  });
