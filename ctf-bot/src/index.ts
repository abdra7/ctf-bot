import { Client, GatewayIntentBits, Partials } from "discord.js";
import { env } from "./config/env";
import { registerReady } from "./events/ready";
import { registerInteractionCreate } from "./events/interactionCreate";
import { prisma } from "./database/prisma";

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
  partials: [Partials.Channel],
});

registerReady(client);
registerInteractionCreate(client);

async function main() {
  // Fail fast if the database is unreachable rather than starting the bot
  // in a broken state.
  await prisma.$connect();
  await client.login(env.DISCORD_TOKEN);
}

main().catch((err) => {
  console.error("Fatal error during startup:", err);
  process.exit(1);
});

process.on("SIGINT", async () => {
  console.log("Shutting down...");
  await prisma.$disconnect();
  client.destroy();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await prisma.$disconnect();
  client.destroy();
  process.exit(0);
});
