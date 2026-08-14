import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from "discord.js";
import { Challenge, ChallengeParticipant, ChallengeStatus, User } from "@prisma/client";
import { formatDuration, formatDurationPrecise } from "../utils/time";

const COLORS = {
  WAITING: 0x2ecc71, // green
  IN_PROGRESS: 0xf1c40f, // yellow
  COMPLETED: 0x3498db, // blue
  EXPIRED: 0xe74c3c, // red
  CANCELLED: 0xe74c3c, // red
};

type ChallengeWithParticipants = Challenge & {
  participants: (ChallengeParticipant & { user: User })[];
};

export function buildChallengeEmbed(challenge: ChallengeWithParticipants): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle("🔐 CTF Challenge")
    .setColor(COLORS[challenge.status])
    .addFields(
      { name: "Challenge", value: challenge.name, inline: false },
      { name: "Platform", value: challenge.platform, inline: true },
      { name: "Link", value: `[Open Challenge](${challenge.url})`, inline: true },
      { name: "Host", value: `<@${challenge.hostId}>`, inline: true },
      { name: "Prize", value: challenge.prize, inline: true },
      { name: "Time Limit", value: `${challenge.timeLimitMinutes} minutes`, inline: true },
      { name: "Players", value: `${challenge.participants.length}`, inline: true }
    )
    .setFooter({ text: `${challenge.challengeCode}` })
    .setTimestamp();

  if (challenge.description) {
    embed.setDescription(challenge.description);
  }

  if (challenge.status === ChallengeStatus.WAITING) {
    embed.addFields({ name: "Status", value: "🟢 WAITING FOR PLAYERS", inline: false });
    if (challenge.participants.length > 0) {
      embed.addFields({
        name: "Joined",
        value: challenge.participants.map((p) => `<@${p.userId}>`).join(", "),
      });
    }
  } else if (challenge.status === ChallengeStatus.IN_PROGRESS) {
    const remaining = challenge.deadline ? challenge.deadline.getTime() - Date.now() : 0;
    embed.addFields(
      { name: "Status", value: "🟡 IN PROGRESS", inline: false },
      { name: "Time Remaining", value: `⏱️ ${formatDuration(Math.max(remaining, 0))}`, inline: true }
    );
  } else if (challenge.status === ChallengeStatus.CANCELLED) {
    embed.addFields({ name: "Status", value: "🔴 CANCELLED", inline: false });
  } else if (challenge.status === ChallengeStatus.EXPIRED) {
    embed.addFields({ name: "Status", value: "⏰ TIME EXPIRED — see results below", inline: false });
  } else if (challenge.status === ChallengeStatus.COMPLETED) {
    embed.addFields({ name: "Status", value: "🔵 COMPLETED — see results below", inline: false });
  }

  return embed;
}

export function buildWaitingButtons(challengeId: string) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`ctf:join:${challengeId}`)
      .setLabel("JOIN CHALLENGE")
      .setEmoji("🟢")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`ctf:leave:${challengeId}`)
      .setLabel("LEAVE CHALLENGE")
      .setEmoji("🔴")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`ctf:start:${challengeId}`)
      .setLabel("START CHALLENGE")
      .setEmoji("▶️")
      .setStyle(ButtonStyle.Primary)
  );
}

export function buildWaitingManagementRow(challengeId: string) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`ctf:cancel:${challengeId}`)
      .setLabel("CANCEL")
      .setEmoji("🛑")
      .setStyle(ButtonStyle.Secondary)
  );
}

export function buildInProgressButtons(challengeId: string) {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`ctf:finish:${challengeId}`)
        .setLabel("FINISH CHALLENGE")
        .setEmoji("🏁")
        .setStyle(ButtonStyle.Success)
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`ctf:end:${challengeId}`)
        .setLabel("END CHALLENGE")
        .setEmoji("⛔")
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(`ctf:viewplayers:${challengeId}`)
        .setLabel("VIEW PLAYERS")
        .setEmoji("👥")
        .setStyle(ButtonStyle.Secondary)
    ),
  ];
}

export function buildStartConfirmRow(challengeId: string) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`ctf:confirmstart:${challengeId}`)
      .setLabel("CONFIRM START")
      .setEmoji("✅")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`ctf:cancelstart:${challengeId}`)
      .setLabel("CANCEL")
      .setEmoji("❌")
      .setStyle(ButtonStyle.Secondary)
  );
}

function medal(rank: number): string {
  if (rank === 1) return "🥇";
  if (rank === 2) return "🥈";
  if (rank === 3) return "🥉";
  return `${rank}\u20e3`;
}

export function buildResultsEmbed(challenge: ChallengeWithParticipants): EmbedBuilder {
  const finished = challenge.participants
    .filter((p) => p.rank !== null)
    .sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0));
  const notFinished = challenge.participants.filter((p) => p.rank === null);

  const embed = new EmbedBuilder()
    .setTitle("🏆 CTF CHALLENGE RESULTS")
    .setColor(COLORS.COMPLETED)
    .addFields(
      { name: "Challenge", value: `🔐 ${challenge.name}`, inline: false },
      { name: "Host", value: `👑 <@${challenge.hostId}>`, inline: true },
      { name: "Duration", value: `⏱️ ${challenge.timeLimitMinutes} Minutes`, inline: true },
      { name: "Prize", value: `🎁 ${challenge.prize}`, inline: true }
    )
    .setFooter({ text: challenge.challengeCode })
    .setTimestamp();

  if (finished.length === 0) {
    embed.addFields({ name: "Final Ranking", value: "No one submitted a correct flag in time." });
  } else {
    const lines = finished.map((p) => {
      const time = p.completionTimeMs !== null ? formatDurationPrecise(p.completionTimeMs) : "?";
      const prizeLine = p.rank === 1 ? `\n🎁 Prize: ${challenge.prize}` : "";
      return `${medal(p.rank as number)} <@${p.userId}> — ⏱️ ${time}${prizeLine}`;
    });
    embed.addFields({ name: "🏆 Final Ranking", value: lines.join("\n\n") });
  }

  if (notFinished.length > 0) {
    embed.addFields({
      name: "❌ Did Not Complete",
      value: notFinished.map((p) => `<@${p.userId}>`).join("\n"),
    });
  }

  return embed;
}

export function buildCreateChallengeButtonRow() {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("ctf:create")
      .setLabel("CREATE CTF CHALLENGE")
      .setEmoji("🆕")
      .setStyle(ButtonStyle.Primary)
  );
}
