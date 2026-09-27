const { formatUserProfile } = require("./userHandler.js");

let failed = false;

// Test 1: User with complete profile
const userWithProfile = { id: 101, username: "alice", profile: { id: 501, bio: "Developer" } };
try {
  const result = formatUserProfile(userWithProfile);
  if (result.profileId !== 501 || result.bio !== "Developer") {
    console.error("FAIL: Incorrect formatting for valid profile");
    failed = true;
  }
} catch (err) {
  console.error("FAIL: Threw unexpected error for valid profile:", err.message);
  failed = true;
}

// Test 2: User without profile (should handle gracefully without crashing)
const userWithoutProfile = { id: 102, username: "bob", profile: null };
try {
  const result = formatUserProfile(userWithoutProfile);
  if (result.profileId !== null || result.bio !== "No bio provided") {
    console.error("FAIL: Incorrect fallback for missing profile");
    failed = true;
  }
} catch (err) {
  console.error("FAIL: Crashed on missing profile:", err.message);
  failed = true;
}

if (failed) process.exit(1);
console.log("PASS: All user handler tests passed");
