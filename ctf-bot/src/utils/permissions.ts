import { GuildMember, PermissionFlagsBits } from "discord.js";
import { env } from "../config/env";

/**
 * Returns true if the member is a server admin (either via the
 * Administrator permission or one of the configured ADMIN_ROLE_IDS).
 */
export function isAdmin(member: GuildMember | null): boolean {
  if (!member) return false;
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  return member.roles.cache.some((role) => env.ADMIN_ROLE_IDS.includes(role.id));
}

/**
 * Returns true if the given user is allowed to manage the challenge:
 * either the original host, or a server admin.
 */
export function canManageChallenge(
  userId: string,
  hostId: string,
  member: GuildMember | null
): boolean {
  return userId === hostId || isAdmin(member);
}
