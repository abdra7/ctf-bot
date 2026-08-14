import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  GuildMember,
  SlashCommandBuilder,
  TextChannel,
} from "discord.js";
import {
  getLeaderboard,
  getUserStats,
  getChallengeHistory,
  findWaitingChallenges,
  findActiveChallenges,
  cancelChallenge,
  getChallenge,
  ChallengeError,
} from "../services/challengeService";
import { buildCreateChallengeButtonRow, buildChallengeEmbed } from "../services/embeds";
import { canManageChallenge } from "../utils/permissions";
import { formatDurationPrecise } from "../utils/time";

export const data = new SlashCommandBuilder()
  .setName("ctf")
  .setDescription("CTF challenge bot commands")
  .addSubcommand((sub) =>
    sub.setName("create").setDescription("Open the panel to create a new CTF challenge")
  )
  .addSubcommand((sub) =>
    sub.setName("leaderboard").setDescription("Show the server CTF leaderboard")
  )
  .addSubcommand((sub) =>
    sub
      .setName("stats")
      .setDescription("Show a player's CTF statistics")
      .addUserOption((opt) => opt.setName("user").setDescription("Player to look up").setRequired(false))
  )
  .addSubcommand((sub) => sub.setName("history").setDescription("Show recent completed challenges"))
  .addSubcommand((sub) => sub.setName("active").setDescription("Show currently active/waiting challenges"))
  .addSubcommand((sub) =>
    sub
      .setName("cancel")
      .setDescription("Cancel a waiting challenge you host (or any, if admin)")
      .addStringOption((opt) =>
        opt.setName("challenge_code").setDescription("e.g. CTF-001").setRequired(true)
      )
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  const sub = interaction.options.getSubcommand();

  switch (sub) {
    case "create":
      await interaction.reply({
        content: "Click below to create a new CTF challenge:",
        components: [buildCreateChallengeButtonRow()],
      });
      return;
    case "leaderboard":
      await handleLeaderboard(interaction);
      return;
    case "stats":
      await handleStats(interaction);
      return;
    case "history":
      await handleHistory(interaction);
      return;
    case "active":
      await handleActive(interaction);
      return;
    case "cancel":
      await handleCancelCommand(interaction);
      return;
  }
}

async function handleLeaderboard(interaction: ChatInputCommandInteraction) {
  const top = await getLeaderboard(10);
  if (top.length === 0) {
    await interaction.reply("No leaderboard data yet — play a challenge first!");
    return;
  }

  const medals = ["🥇", "🥈", "🥉"];
  const lines = top.map((u, i) => {
    const prefix = medals[i] ?? `${i + 1}\u20e3`;
    return `${prefix} <@${u.id}> — ${u.totalPoints} Points`;
  });

  const embed = new EmbedBuilder()
    .setTitle("🏆 CTF LEADERBOARD")
    .setColor(0xf1c40f)
    .setDescription(lines.join("\n"));

  await interaction.reply({ embeds: [embed] });
}

async function handleStats(interaction: ChatInputCommandInteraction) {
  const target = interaction.options.getUser("user") ?? interaction.user;
  const stats = await getUserStats(target.id);

  if (!stats) {
    await interaction.reply({ content: `${target.username} hasn't played any challenges yet.`, ephemeral: true });
    return;
  }

  const embed = new EmbedBuilder()
    .setTitle(`🏆 Player Stats — ${target.username}`)
    .setColor(0x3498db)
    .addFields(
      { name: "Challenges", value: `${stats.challengesPlayed}`, inline: true },
      { name: "Completed", value: `${stats.challengesCompleted}`, inline: true },
      { name: "🥇 Wins", value: `${stats.challengesWon}`, inline: true },
      { name: "🥈 2nd", value: `${stats.challengesSecond}`, inline: true },
      { name: "🥉 3rd", value: `${stats.challengesThird}`, inline: true },
      { name: "Points", value: `${stats.totalPoints}`, inline: true },
      {
        name: "Best Time",
        value: stats.bestCompletionMs ? formatDurationPrecise(stats.bestCompletionMs) : "—",
        inline: true,
      }
    );

  await interaction.reply({ embeds: [embed] });
}

async function handleHistory(interaction: ChatInputCommandInteraction) {
  if (!interaction.guildId) return;
  const history = await getChallengeHistory(interaction.guildId, 10);

  if (history.length === 0) {
    await interaction.reply({ content: "No completed challenges yet.", ephemeral: true });
    return;
  }

  const lines = history.map((c) => {
    const winner = c.participants.find((p) => p.rank === 1);
    const winnerText = winner ? `🥇 <@${winner.userId}>` : "No winner";
    return `**${c.challengeCode}** — ${c.name} (${c.status}) — ${winnerText}`;
  });

  const embed = new EmbedBuilder()
    .setTitle("📜 Challenge History")
    .setColor(0x3498db)
    .setDescription(lines.join("\n"));

  await interaction.reply({ embeds: [embed] });
}

async function handleActive(interaction: ChatInputCommandInteraction) {
  const [waiting, active] = await Promise.all([findWaitingChallenges(), findActiveChallenges()]);
  const all = [...waiting, ...active];

  if (all.length === 0) {
    await interaction.reply({ content: "No active or waiting challenges right now.", ephemeral: true });
    return;
  }

  const lines = all.map(
    (c) => `**${c.challengeCode}** — ${c.name} — ${c.status} — ${c.participants.length} players`
  );

  await interaction.reply({ content: lines.join("\n") });
}

async function handleCancelCommand(interaction: ChatInputCommandInteraction) {
  const code = interaction.options.getString("challenge_code", true);
  const waiting = await findWaitingChallenges();
  const match = waiting.find((c) => c.challengeCode.toLowerCase() === code.toLowerCase());

  if (!match) {
    await interaction.reply({
      content: `❌ No waiting challenge found with code \`${code}\`.`,
      ephemeral: true,
    });
    return;
  }

  if (!canManageChallenge(interaction.user.id, match.hostId, interaction.member as GuildMember)) {
    await interaction.reply({ content: "❌ Only the host (or an admin) can cancel this challenge.", ephemeral: true });
    return;
  }

  try {
    await cancelChallenge(match.id);
    const channel = await interaction.client.channels.fetch(match.channelId).catch(() => null);
    if (channel && match.messageId && (channel as TextChannel).isTextBased()) {
      const message = await (channel as TextChannel).messages.fetch(match.messageId).catch(() => null);
      const full = await getChallenge(match.id);
      if (message && full) {
        await message.edit({ embeds: [buildChallengeEmbed(full as any)], components: [] });
      }
    }
    await interaction.reply(`🛑 Challenge \`${match.challengeCode}\` cancelled.`);
  } catch (err) {
    if (err instanceof ChallengeError) {
      await interaction.reply({ content: `❌ ${err.message}`, ephemeral: true });
      return;
    }
    console.error("[handleCancelCommand]", err);
    await interaction.reply({ content: "❌ Something went wrong.", ephemeral: true });
  }
}
