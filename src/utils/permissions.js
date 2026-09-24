const { PermissionsBitField } = require('discord.js');

// True Administrator permission on the server (real Discord admins).
function isAdmin(member) {
  return member.permissions.has(PermissionsBitField.Flags.Administrator);
}

// True if the member has at least one of the configured claim roles,
// or is a real admin (admins can always do staff actions too).
function isClaimStaff(member, guildConfig) {
  if (isAdmin(member)) return true;
  if (!guildConfig.claimRoles || guildConfig.claimRoles.length === 0) return false;
  return member.roles.cache.some((r) => guildConfig.claimRoles.includes(r.id));
}

module.exports = { isAdmin, isClaimStaff };
