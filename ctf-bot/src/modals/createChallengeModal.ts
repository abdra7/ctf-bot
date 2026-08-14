import {
  ActionRowBuilder,
  ModalBuilder,
  ModalSubmitInteraction,
  TextChannel,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import { createChallenge, attachMessageId, ChallengeError, getChallenge } from "../services/challengeService";
import { buildChallengeEmbed, buildWaitingButtons, buildWaitingManagementRow } from "../services/embeds";
import { sanitizeText, isValidUrl } from "../utils/sanitize";

export const CREATE_MODAL_ID = "ctf:createModal";

export function buildCreateChallengeModal(): ModalBuilder {
  const modal = new ModalBuilder().setCustomId(CREATE_MODAL_ID).setTitle("Create CTF Challenge");

  const name = new TextInputBuilder()
    .setCustomId("name")
    .setLabel("Challenge Name")
    .setStyle(TextInputStyle.Short)
    .setPlaceholder("SQL Injection Basics")
    .setRequired(true)
    .setMaxLength(100);

  const url = new TextInputBuilder()
    .setCustomId("url")
    .setLabel("Challenge URL")
    .setStyle(TextInputStyle.Short)
    .setPlaceholder("https://tryhackme.com/room/example")
    .setRequired(true)
    .setMaxLength(300);

  const timeAndPrize = new TextInputBuilder()
    .setCustomId("timeAndPrize")
    .setLabel("Time Limit (minutes) | Prize")
    .setStyle(TextInputStyle.Short)
    .setPlaceholder("60 | 100 SAR")
    .setRequired(true)
    .setMaxLength(100);

  const flag = new TextInputBuilder()
    .setCustomId("flag")
    .setLabel("Correct Flag (kept secret)")
    .setStyle(TextInputStyle.Short)
    .setPlaceholder("THM{example_flag}")
    .setRequired(true)
    .setMaxLength(200);

  const description = new TextInputBuilder()
    .setCustomId("description")
    .setLabel("Description (optional)")
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder("First person to successfully complete the challenge wins.")
    .setRequired(false)
    .setMaxLength(500);

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(name),
    new ActionRowBuilder<TextInputBuilder>().addComponents(url),
    new ActionRowBuilder<TextInputBuilder>().addComponents(timeAndPrize),
    new ActionRowBuilder<TextInputBuilder>().addComponents(flag),
    new ActionRowBuilder<TextInputBuilder>().addComponents(description)
  );

  return modal;
}

export async function handleCreateChallengeModalSubmit(interaction: ModalSubmitInteraction) {
  if (!interaction.guildId || !interaction.channel || !interaction.channelId) {
    await interaction.reply({ content: "This can only be used inside a server channel.", ephemeral: true });
    return;
  }

  const rawName = interaction.fields.getTextInputValue("name");
  const rawUrl = interaction.fields.getTextInputValue("url").trim();
  const timeAndPrize = interaction.fields.getTextInputValue("timeAndPrize");
  const flag = interaction.fields.getTextInputValue("flag");
  const rawDescription = interaction.fields.getTextInputValue("description");

  const name = sanitizeText(rawName, 100);
  const description = rawDescription ? sanitizeText(rawDescription, 500) : undefined;

  if (!isValidUrl(rawUrl)) {
    await interaction.reply({
      content: "❌ The Challenge URL must be a valid http(s) link.",
      ephemeral: true,
    });
    return;
  }

  const [timePart, ...prizeParts] = timeAndPrize.split("|");
  const timeLimitMinutes = parseInt((timePart ?? "").trim(), 10);
  const prizeRaw = prizeParts.join("|").trim();

  if (!Number.isFinite(timeLimitMinutes) || timeLimitMinutes <= 0) {
    await interaction.reply({
      content: '❌ Please format the time/prize field as `60 | 100 SAR` (minutes first, then prize, separated by `|`).',
      ephemeral: true,
    });
    return;
  }
  if (!prizeRaw) {
    await interaction.reply({
      content: '❌ Please include a prize after the `|`, e.g. `60 | 100 SAR`.',
      ephemeral: true,
    });
    return;
  }
  const prize = sanitizeText(prizeRaw, 100);

  try {
    const challenge = await createChallenge({
      guildId: interaction.guildId,
      channelId: interaction.channelId,
      hostId: interaction.user.id,
      hostUsername: interaction.user.username,
      name,
      description,
      url: rawUrl,
      timeLimitMinutes,
      prize,
      flag,
    });

    const full = await getChallenge(challenge.id);
    if (!full) throw new ChallengeError("Failed to load created challenge.");

    const embed = buildChallengeEmbed(full as any);
    const message = await (interaction.channel as TextChannel).send({
      embeds: [embed],
      components: [buildWaitingButtons(challenge.id), buildWaitingManagementRow(challenge.id)],
    });

    await attachMessageId(challenge.id, message.id);

    await interaction.reply({
      content: `✅ Challenge **${challenge.challengeCode}** created! Players can now join.`,
      ephemeral: true,
    });
  } catch (err) {
    if (err instanceof ChallengeError) {
      await interaction.reply({ content: `❌ ${err.message}`, ephemeral: true });
      return;
    }
    console.error("[createChallengeModal] Unexpected error:", err);
    await interaction.reply({
      content: "❌ Something went wrong while creating the challenge.",
      ephemeral: true,
    });
  }
}
