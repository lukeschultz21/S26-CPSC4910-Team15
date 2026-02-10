// Helper: generate bcrypt hashes for seeding USERS.password
// Usage (locally): node scripts/hash_password.js "MyPassword123!"
const bcrypt = require("bcryptjs");

async function main() {
  const pw = process.argv[2];
  if (!pw) {
    console.error('Usage: node scripts/hash_password.js "Password"');
    process.exit(1);
  }
  const hash = await bcrypt.hash(pw, 10);
  console.log(hash);
}

main();
