import {
  ActionRowBuilder,
  ModalBuilder,
  ModalSubmitInteraction,
  TextChannel,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import { attemptFinish, closeChallenge, getChallenge, ChallengeError } from "../services/challengeService";
import { buildChallengeEmbed, buildResultsEmbed } from "../services/embeds";
import { formatDurationPrecise } from "../utils/time";
import { stopTimer } from "../services/timerService";

export const FINISH_MODAL_PREFIX = "ctf:finishModal:";

export function buildFinishFlagModal(challengeId: string): ModalBuilder {
  const modal = new ModalBuilder()
    .setCustomId(`${FINISH_MODAL_PREFIX}${challengeId}`)
    .setTitle("Submit Your Flag");

  const flagInput = new TextInputBuilder()
    .setCustomId("flag")
    .setLabel("Enter the Flag you obtained:")
    .setStyle(TextInputStyle.Short)
    .setPlaceholder("THM{...}")
    .setRequired(true)
    .setMaxLength(300);

  modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(flagInput));
  return modal;
}

export async function handleFinishFlagModalSubmit(interaction: ModalSubmitInteraction, challengeId: string) {
  const submittedFlag = interaction.fields.getTextInputValue("flag");

  try {
    // NOTE: the finish timestamp used for ranking is taken server-side at
    // the moment attemptFinish() runs below — never from client input.
    const result = await attemptFinish(challengeId, interaction.user.id, submittedFlag);

    if (!result.correct) {
      await interaction.reply({
        content: "❌ **Incorrect Flag.**\n\nYour finish was not recorded. You can try again.",
        ephemeral: true,
      });
      return;
    }

    await interaction.reply({
      content: `✅ **Correct Flag!**\n\n🏁 Your finish has been recorded!\n\nCompletion Time: **${formatDurationPrecise(
        result.completionTimeMs ?? 0
      )}**\n\nWait for the challenge to close to see the final ranking.`,
      ephemeral: true,
    });
  } catch (err) {
    if (err instanceof ChallengeError) {
      if (err.message === "TIME_EXPIRED") {
        // The deadline passed between the button click and modal submit —
        // close the challenge now rather than leaving it stuck.
        await interaction.reply({
          content: "⏰ Time's up! The deadline passed before your submission was received.",
          ephemeral: true,
        });
        await autoCloseIfNeeded(interaction, challengeId);
        return;
      }
      if (err.message === "ALREADY_FINISHED") {
        await interaction.reply({
          content: "⚠️ You have already recorded a finish for this challenge.",
          ephemeral: true,
        });
        return;
      }
      if (err.message === "NOT_A_PARTICIPANT") {
        await interaction.reply({
          content: "⚠️ You are not a participant in this challenge.",
          ephemeral: true,
        });
        return;
      }
      await interaction.reply({ content: `❌ ${err.message}`, ephemeral: true });
      return;
    }
    console.error("[finishFlagModal] Unexpected error:", err);
    await interaction.reply({ content: "❌ Something went wrong recording your finish.", ephemeral: true });
  }
}

async function autoCloseIfNeeded(interaction: ModalSubmitInteraction, challengeId: string) {
  try {
    const challenge = await getChallenge(challengeId);
    if (!challenge || challenge.status !== "IN_PROGRESS") return;

    stopTimer(challengeId);
    const finalChallenge = await closeChallenge(challengeId, true);

    const channel = await interaction.client.channels.fetch(challenge.channelId).catch(() => null);
    if (channel && channel.isTextBased()) {
      if (challenge.messageId) {
        const message = await (channel as TextChannel).messages.fetch(challenge.messageId).catch(() => null);
        if (message) {
          await message.edit({ embeds: [buildChallengeEmbed(finalChallenge as any)], components: [] });
        }
      }
      await (channel as TextChannel).send({
        content: "⏰ **TIME'S UP!** The challenge has ended. Calculating results...",
        embeds: [buildResultsEmbed(finalChallenge as any)],
      });
    }
  } catch (err) {
    console.error("[finishFlagModal] Error auto-closing expired challenge:", err);
  }
}
