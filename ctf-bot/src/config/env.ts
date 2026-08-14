import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(
      `Missing required environment variable: ${name}. Copy .env.example to .env and fill it in.`
    );
  }
  return value;
}

export const env = {
  DISCORD_TOKEN: required("DISCORD_TOKEN"),
  CLIENT_ID: required("CLIENT_ID"),
  GUILD_ID: required("GUILD_ID"),
  DATABASE_URL: required("DATABASE_URL"),
  ADMIN_ROLE_IDS: (process.env.ADMIN_ROLE_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  CTF_CHANNEL_NAME: process.env.CTF_CHANNEL_NAME ?? "اختيار-التحدي-والمشاركين",
};
