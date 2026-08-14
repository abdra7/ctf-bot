import { ButtonInteraction, GuildMember, TextChannel } from "discord.js";
import {
  joinChallenge,
  leaveChallenge,
  startChallenge,
  cancelChallenge,
  closeChallenge,
  getChallenge,
  ChallengeError,
} from "../services/challengeService";
import {
  buildChallengeEmbed,
  buildWaitingButtons,
  buildWaitingManagementRow,
  buildInProgressButtons,
  buildStartConfirmRow,
  buildResultsEmbed,
} from "../services/embeds";
import { buildCreateChallengeModal } from "../modals/createChallengeModal";
import { buildFinishFlagModal } from "../modals/finishFlagModal";
import { canManageChallenge } from "../utils/permissions";
import { watchChallenge, stopTimer } from "../services/timerService";

// customId format: ctf:<action>:<challengeId>   (ctf:create has no id)
export async function routeButtonInteraction(interaction: ButtonInteraction) {
  const [, action, challengeId] = interaction.customId.split(":");

  switch (action) {
    case "create":
      await interaction.showModal(buildCreateChallengeModal());
      return;
    case "join":
      await handleJoin(interaction, challengeId);
      return;
    case "leave":
      await handleLeave(interaction, challengeId);
      return;
    case "start":
      await handleStartRequest(interaction, challengeId);
      return;
    case "confirmstart":
      await handleConfirmStart(interaction, challengeId);
      return;
    case "cancelstart":
      await interaction.update({ content: "Start cancelled.", components: [] });
      return;
    case "cancel":
      await handleCancel(interaction, challengeId);
      return;
    case "finish":
      await handleFinishRequest(interaction, challengeId);
      return;
    case "end":
      await handleEnd(interaction, challengeId);
      return;
    case "viewplayers":
      await handleViewPlayers(interaction, challengeId);
      return;
    default:
      await interaction.reply({ content: "Unknown action.", ephemeral: true });
  }
}

async function refreshMainEmbed(interaction: ButtonInteraction, challengeId: string) {
  const challenge = await getChallenge(challengeId);
  if (!challenge || !challenge.messageId) return;
  const channel = interaction.channel as TextChannel;
  const message = await channel.messages.fetch(challenge.messageId).catch(() => null);
  if (!message) return;

  if (challenge.status === "WAITING") {
    await message.edit({
      embeds: [buildChallengeEmbed(challenge as any)],
      components: [buildWaitingButtons(challengeId), buildWaitingManagementRow(challengeId)],
    });
  } else if (challenge.status === "IN_PROGRESS") {
    await message.edit({
      embeds: [buildChallengeEmbed(challenge as any)],
      components: buildInProgressButtons(challengeId),
    });
  } else {
    await message.edit({ embeds: [buildChallengeEmbed(challenge as any)], components: [] });
  }
}

async function handleJoin(interaction: ButtonInteraction, challengeId: string) {
  try {
    await joinChallenge(challengeId, interaction.user.id, interaction.user.username);
    await refreshMainEmbed(interaction, challengeId);
    await interaction.reply({ content: "✅ You have joined the challenge!", ephemeral: true });
  } catch (err) {
    if (err instanceof ChallengeError) {
      if (err.message === "ALREADY_JOINED") {
        await interaction.reply({
          content: "⚠️ You are already participating in this challenge.",
          ephemeral: true,
        });
        return;
      }
      await interaction.reply({ content: `❌ ${err.message}`, ephemeral: true });
      return;
    }
    console.error("[handleJoin]", err);
    await interaction.reply({ content: "❌ Something went wrong.", ephemeral: true });
  }
}

async function handleLeave(interaction: ButtonInteraction, challengeId: string) {
  try {
    await leaveChallenge(challengeId, interaction.user.id);
    await refreshMainEmbed(interaction, challengeId);
    await interaction.reply({ content: "You have left the challenge.", ephemeral: true });
  } catch (err) {
    if (err instanceof ChallengeError) {
      if (err.message === "NOT_JOINED") {
        await interaction.reply({ content: "⚠️ You had not joined this challenge.", ephemeral: true });
        return;
      }
      await interaction.reply({ content: `❌ ${err.message}`, ephemeral: true });
      return;
    }
    console.error("[handleLeave]", err);
    await interaction.reply({ content: "❌ Something went wrong.", ephemeral: true });
  }
}

async function handleStartRequest(interaction: ButtonInteraction, challengeId: string) {
  const challenge = await getChallenge(challengeId);
  if (!challenge) {
    await interaction.reply({ content: "❌ Challenge not found.", ephemeral: true });
    return;
  }
  if (!canManageChallenge(interaction.user.id, challenge.hostId, interaction.member as GuildMember)) {
    await interaction.reply({
      content: "❌ Only the host (or an admin) can start this challenge.",
      ephemeral: true,
    });
    return;
  }
  if (challenge.participants.length < 2) {
    await interaction.reply({ content: "❌ At least 2 players must join before starting.", ephemeral: true });
    return;
  }

  await interaction.reply({
    content:
      "⚠️ Are you sure you want to start the challenge?\n\nThe timer will start immediately and all participants will be locked in.",
    components: [buildStartConfirmRow(challengeId)],
    ephemeral: true,
  });
}

async function handleConfirmStart(interaction: ButtonInteraction, challengeId: string) {
  const challenge = await getChallenge(challengeId);
  if (!challenge) {
    await interaction.update({ content: "❌ Challenge not found.", components: [] });
    return;
  }
  if (!canManageChallenge(interaction.user.id, challenge.hostId, interaction.member as GuildMember)) {
    await interaction.update({ content: "❌ Only the host (or an admin) can start this challenge.", components: [] });
    return;
  }

  try {
    await startChallenge(challengeId);
    await interaction.update({ content: "✅ Challenge started!", components: [] });
    await refreshMainEmbed(interaction, challengeId);
    watchChallenge(interaction.client, challengeId);
  } catch (err) {
    if (err instanceof ChallengeError) {
      await interaction.update({ content: `❌ ${err.message}`, components: [] });
      return;
    }
    console.error("[handleConfirmStart]", err);
    await interaction.update({ content: "❌ Something went wrong starting the challenge.", components: [] });
  }
}

async function handleCancel(interaction: ButtonInteraction, challengeId: string) {
  const challenge = await getChallenge(challengeId);
  if (!challenge) {
    await interaction.reply({ content: "❌ Challenge not found.", ephemeral: true });
    return;
  }
  if (!canManageChallenge(interaction.user.id, challenge.hostId, interaction.member as GuildMember)) {
    await interaction.reply({
      content: "❌ Only the host (or an admin) can cancel this challenge.",
      ephemeral: true,
    });
    return;
  }

  try {
    await cancelChallenge(challengeId);
    await refreshMainEmbed(interaction, challengeId);
    await interaction.reply({ content: "🛑 Challenge cancelled.", ephemeral: true });
  } catch (err) {
    if (err instanceof ChallengeError) {
      await interaction.reply({ content: `❌ ${err.message}`, ephemeral: true });
      return;
    }
    console.error("[handleCancel]", err);
    await interaction.reply({ content: "❌ Something went wrong.", ephemeral: true });
  }
}

async function handleFinishRequest(interaction: ButtonInteraction, challengeId: string) {
  const challenge = await getChallenge(challengeId);
  if (!challenge || challenge.status !== "IN_PROGRESS") {
    await interaction.reply({ content: "❌ This challenge is not currently in progress.", ephemeral: true });
    return;
  }
  const isParticipant = challenge.participants.some((p) => p.userId === interaction.user.id);
  if (!isParticipant) {
    await interaction.reply({ content: "❌ You are not a participant in this challenge.", ephemeral: true });
    return;
  }
  await interaction.showModal(buildFinishFlagModal(challengeId));
}

async function handleEnd(interaction: ButtonInteraction, challengeId: string) {
  const challenge = await getChallenge(challengeId);
  if (!challenge) {
    await interaction.reply({ content: "❌ Challenge not found.", ephemeral: true });
    return;
  }
  if (!canManageChallenge(interaction.user.id, challenge.hostId, interaction.member as GuildMember)) {
    await interaction.reply({ content: "❌ Only the host (or an admin) can end this challenge.", ephemeral: true });
    return;
  }

  try {
    stopTimer(challengeId);
    const finalChallenge = await closeChallenge(challengeId, false);
    await interaction.reply({ embeds: [buildResultsEmbed(finalChallenge as any)] });
    const channel = interaction.channel as TextChannel;
    if (finalChallenge.messageId) {
      const message = await channel.messages.fetch(finalChallenge.messageId).catch(() => null);
      if (message) {
        await message.edit({ embeds: [buildChallengeEmbed(finalChallenge as any)], components: [] });
      }
    }
  } catch (err) {
    if (err instanceof ChallengeError) {
      await interaction.reply({ content: `❌ ${err.message}`, ephemeral: true });
      return;
    }
    console.error("[handleEnd]", err);
    await interaction.reply({ content: "❌ Something went wrong ending the challenge.", ephemeral: true });
  }
}

async function handleViewPlayers(interaction: ButtonInteraction, challengeId: string) {
  const challenge = await getChallenge(challengeId);
  if (!challenge) {
    await interaction.reply({ content: "❌ Challenge not found.", ephemeral: true });
    return;
  }
  const finished = challenge.participants.filter((p) => p.status === "FINISHED");
  const inProgress = challenge.participants.filter((p) => p.status !== "FINISHED");

  const lines = [
    finished.length > 0
      ? `**Finished (${finished.length}):**\n${finished.map((p) => `✅ <@${p.userId}>`).join("\n")}`
      : "",
    inProgress.length > 0
      ? `**Still working (${inProgress.length}):**\n${inProgress.map((p) => `⏳ <@${p.userId}>`).join("\n")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  await interaction.reply({ content: lines || "No participants yet.", ephemeral: true });
}
