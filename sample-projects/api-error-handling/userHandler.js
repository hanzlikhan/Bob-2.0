/**
 * Formats a user response object for API returns.
 */
function formatUserProfile(user) {
  return {
    userId: user.id,
    username: user.username,
    profileId: user.profile ? user.profile.id : null,
    bio: user.profile ? user.profile.bio : "No bio provided",
  };
}

module.exports = { formatUserProfile };
