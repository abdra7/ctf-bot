import { Client, Events } from "discord.js";
import { findActiveChallenges } from "../services/challengeService";
import { watchChallenge } from "../services/timerService";

export function registerReady(client: Client) {
  client.once(Events.ClientReady, async (readyClient) => {
    console.log(`✅ Logged in as ${readyClient.user.tag}`);

    // Restart-safety (spec section 28): resume tracking every challenge
    // that was IN_PROGRESS when the bot last stopped. Deadlines are read
    // straight from the database, so no timer is ever reset by a restart.
    try {
      const active = await findActiveChallenges();
      for (const challenge of active) {
        watchChallenge(readyClient, challenge.id);
      }
      if (active.length > 0) {
        console.log(`🔄 Resumed ${active.length} active challenge timer(s) after restart.`);
      }
    } catch (err) {
      console.error("[ready] Failed to resume active challenges:", err);
    }
  });
}
