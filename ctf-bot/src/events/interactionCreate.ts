import { Client, Events, Interaction } from "discord.js";
import { routeButtonInteraction } from "../buttons/challengeButtons";
import {
  CREATE_MODAL_ID,
  handleCreateChallengeModalSubmit,
} from "../modals/createChallengeModal";
import { FINISH_MODAL_PREFIX, handleFinishFlagModalSubmit } from "../modals/finishFlagModal";
import * as ctfCommand from "../commands/ctf";

export function registerInteractionCreate(client: Client) {
  client.on(Events.InteractionCreate, async (interaction: Interaction) => {
    try {
      if (interaction.isChatInputCommand()) {
        if (interaction.commandName === "ctf") {
          await ctfCommand.execute(interaction);
        }
        return;
      }

      if (interaction.isButton()) {
        // Every button click is validated server-side inside the handler
        // (permission checks, state checks) — the customId alone never
        // grants authority to act.
        await routeButtonInteraction(interaction);
        return;
      }

      if (interaction.isModalSubmit()) {
        if (interaction.customId === CREATE_MODAL_ID) {
          await handleCreateChallengeModalSubmit(interaction);
          return;
        }
        if (interaction.customId.startsWith(FINISH_MODAL_PREFIX)) {
          const challengeId = interaction.customId.slice(FINISH_MODAL_PREFIX.length);
          await handleFinishFlagModalSubmit(interaction, challengeId);
          return;
        }
      }
    } catch (err) {
      console.error("[interactionCreate] Unhandled error:", err);
      const message = "❌ An unexpected error occurred. Please try again.";
      try {
        if (interaction.isRepliable()) {
          if (interaction.replied || interaction.deferred) {
            await interaction.followUp({ content: message, ephemeral: true });
          } else {
            await interaction.reply({ content: message, ephemeral: true });
          }
        }
      } catch {
        // Interaction may have expired — nothing more we can do.
      }
    }
  });
}
