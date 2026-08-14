import { Client, TextChannel } from "discord.js";
import { closeChallenge, getChallenge } from "./challengeService";
import { buildChallengeEmbed, buildInProgressButtons, buildResultsEmbed } from "./embeds";

const UPDATE_INTERVAL_MS = 15_000;

// In-memory registry of running timers, keyed by challengeId. This is a
// runtime cache only — the database (start/deadline timestamps) remains the
// source of truth, so timers can be safely rebuilt on every process boot.
const activeTimers = new Map<string, NodeJS.Timeout>();

export function isTimerActive(challengeId: string): boolean {
  return activeTimers.has(challengeId);
}

export function stopTimer(challengeId: string) {
  const handle = activeTimers.get(challengeId);
  if (handle) {
    clearInterval(handle);
    activeTimers.delete(challengeId);
  }
}

/**
 * Starts (or resumes, after a restart) the periodic embed-update /
 * auto-expiry loop for a challenge that is IN_PROGRESS. Safe to call
 * multiple times — it no-ops if a timer is already running for this id.
 */
export function watchChallenge(client: Client, challengeId: string) {
  if (activeTimers.has(challengeId)) return;

  const tick = async () => {
    try {
      const challenge = await getChallenge(challengeId);
      if (!challenge) {
        stopTimer(challengeId);
        return;
      }
      if (challenge.status !== "IN_PROGRESS") {
        stopTimer(challengeId);
        return;
      }

      const channel = await client.channels.fetch(challenge.channelId).catch(() => null);
      if (!channel || !channel.isTextBased()) return;

      const now = Date.now();
      const deadline = challenge.deadline?.getTime() ?? now;

      if (now >= deadline) {
        stopTimer(challengeId);
        const finalChallenge = await closeChallenge(challengeId, true);

        if (challenge.messageId) {
          const message = await (channel as TextChannel).messages
            .fetch(challenge.messageId)
            .catch(() => null);
          if (message) {
            await message.edit({
              embeds: [buildChallengeEmbed(finalChallenge as any)],
              components: [],
            });
          }
        }

        await (channel as TextChannel).send({
          content: "⏰ **TIME'S UP!** The challenge has ended. Calculating results...",
          embeds: [buildResultsEmbed(finalChallenge as any)],
        });
        return;
      }

      // Otherwise, just refresh the "time remaining" display.
      if (challenge.messageId) {
        const message = await (channel as TextChannel).messages
          .fetch(challenge.messageId)
          .catch(() => null);
        if (message) {
          await message.edit({
            embeds: [buildChallengeEmbed(challenge as any)],
            components: buildInProgressButtons(challengeId),
          });
        }
      }
    } catch (err) {
      console.error(`[timerService] Error updating challenge ${challengeId}:`, err);
    }
  };

  const handle = setInterval(tick, UPDATE_INTERVAL_MS);
  activeTimers.set(challengeId, handle);
  // Fire once immediately so the embed reflects state right away.
  void tick();
}
