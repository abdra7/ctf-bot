import { REST, Routes } from "discord.js";
import { env } from "./config/env";
import { data as ctfCommand } from "./commands/ctf";

async function main() {
  const commands = [ctfCommand.toJSON()];
  const rest = new REST({ version: "10" }).setToken(env.DISCORD_TOKEN);

  console.log(`Registering ${commands.length} slash command(s) to guild ${env.GUILD_ID}...`);

  await rest.put(Routes.applicationGuildCommands(env.CLIENT_ID, env.GUILD_ID), {
    body: commands,
  });

  console.log("✅ Slash commands registered.");
}

main().catch((err) => {
  console.error("Failed to register commands:", err);
  process.exit(1);
});
