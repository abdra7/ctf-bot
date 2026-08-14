import { Challenge, ChallengeParticipant, ChallengeStatus, ParticipantStatus } from "@prisma/client";
import { prisma } from "../database/prisma";
import { hashFlag, verifyFlag } from "../utils/crypto";
import { minutesToMs } from "../utils/time";
import { pointsForRank } from "../config/scoring";

export class ChallengeError extends Error {}

export interface CreateChallengeInput {
  guildId: string;
  channelId: string;
  hostId: string;
  hostUsername: string;
  name: string;
  description?: string;
  url: string;
  platform?: string;
  timeLimitMinutes: number;
  prize: string;
  flag: string;
  maxParticipants?: number;
}

async function ensureUser(id: string, username: string) {
  return prisma.user.upsert({
    where: { id },
    update: { username },
    create: { id, username },
  });
}

async function nextChallengeCode(): Promise<string> {
  const count = await prisma.challenge.count();
  return `CTF-${(count + 1).toString().padStart(3, "0")}`;
}

export async function createChallenge(input: CreateChallengeInput): Promise<Challenge> {
  if (input.timeLimitMinutes <= 0 || input.timeLimitMinutes > 24 * 60) {
    throw new ChallengeError("Time limit must be between 1 and 1440 minutes.");
  }
  if (!input.flag || input.flag.trim().length === 0) {
    throw new ChallengeError("A flag is required to verify submissions.");
  }

  await ensureUser(input.hostId, input.hostUsername);
  const challengeCode = await nextChallengeCode();

  return prisma.challenge.create({
    data: {
      challengeCode,
      name: input.name,
      description: input.description,
      url: input.url,
      platform: input.platform ?? "Other",
      correctFlagHash: hashFlag(input.flag),
      timeLimitMinutes: input.timeLimitMinutes,
      prize: input.prize,
      maxParticipants: input.maxParticipants,
      hostId: input.hostId,
      guildId: input.guildId,
      channelId: input.channelId,
      status: ChallengeStatus.WAITING,
    },
  });
}

export async function attachMessageId(challengeId: string, messageId: string) {
  await prisma.challenge.update({ where: { id: challengeId }, data: { messageId } });
}

export async function getChallenge(id: string) {
  return prisma.challenge.findUnique({
    where: { id },
    include: { participants: { include: { user: true } }, host: true },
  });
}

export async function getChallengeByMessageId(messageId: string) {
  return prisma.challenge.findFirst({
    where: { messageId },
    include: { participants: { include: { user: true } }, host: true },
  });
}

export async function joinChallenge(challengeId: string, userId: string, username: string) {
  const challenge = await prisma.challenge.findUnique({
    where: { id: challengeId },
    include: { participants: true },
  });
  if (!challenge) throw new ChallengeError("Challenge not found.");
  if (challenge.status !== ChallengeStatus.WAITING) {
    throw new ChallengeError("This challenge is no longer accepting new players.");
  }
  if (challenge.maxParticipants && challenge.participants.length >= challenge.maxParticipants) {
    throw new ChallengeError("This challenge is full.");
  }
  const already = challenge.participants.some((p) => p.userId === userId);
  if (already) {
    throw new ChallengeError("ALREADY_JOINED");
  }

  await ensureUser(userId, username);
  await prisma.challengeParticipant.create({
    data: { challengeId, userId, status: ParticipantStatus.JOINED },
  });

  return getChallenge(challengeId);
}

export async function leaveChallenge(challengeId: string, userId: string) {
  const challenge = await prisma.challenge.findUnique({ where: { id: challengeId } });
  if (!challenge) throw new ChallengeError("Challenge not found.");
  if (challenge.status !== ChallengeStatus.WAITING) {
    throw new ChallengeError("You can no longer leave — the challenge has already started.");
  }

  const participant = await prisma.challengeParticipant.findUnique({
    where: { challengeId_userId: { challengeId, userId } },
  });
  if (!participant) {
    throw new ChallengeError("NOT_JOINED");
  }

  await prisma.challengeParticipant.delete({ where: { id: participant.id } });
  return getChallenge(challengeId);
}

export async function startChallenge(challengeId: string) {
  const challenge = await prisma.challenge.findUnique({
    where: { id: challengeId },
    include: { participants: true },
  });
  if (!challenge) throw new ChallengeError("Challenge not found.");
  if (challenge.status === ChallengeStatus.CANCELLED) {
    throw new ChallengeError("This challenge was cancelled.");
  }
  if (challenge.status !== ChallengeStatus.WAITING) {
    throw new ChallengeError("This challenge has already started or ended.");
  }
  if (challenge.participants.length < 2) {
    throw new ChallengeError("At least 2 players must join before starting.");
  }

  const startTime = new Date();
  const deadline = new Date(startTime.getTime() + minutesToMs(challenge.timeLimitMinutes));

  return prisma.challenge.update({
    where: { id: challengeId },
    data: { status: ChallengeStatus.IN_PROGRESS, startTime, deadline },
    include: { participants: { include: { user: true } }, host: true },
  });
}

export async function cancelChallenge(challengeId: string) {
  const challenge = await prisma.challenge.findUnique({ where: { id: challengeId } });
  if (!challenge) throw new ChallengeError("Challenge not found.");
  if (challenge.status === ChallengeStatus.IN_PROGRESS) {
    throw new ChallengeError("Cannot cancel a challenge that is already in progress. Use END instead.");
  }
  if (challenge.status !== ChallengeStatus.WAITING) {
    throw new ChallengeError("This challenge can no longer be cancelled.");
  }
  return prisma.challenge.update({
    where: { id: challengeId },
    data: { status: ChallengeStatus.CANCELLED, endedAt: new Date() },
  });
}

export interface FinishResult {
  correct: boolean;
  completionTimeMs?: number;
  challenge?: Challenge;
}

/**
 * Attempts to record a finish for a participant. Verifies:
 * - the challenge is IN_PROGRESS
 * - the deadline has not passed
 * - the user is a participant
 * - the user has not already finished
 * - the submitted flag matches the stored hash
 *
 * All checks are server-side; the finish timestamp is taken from the
 * server clock at the moment this function runs (i.e. when the
 * interaction is received), never from client-supplied data.
 */
export async function attemptFinish(
  challengeId: string,
  userId: string,
  submittedFlag: string
): Promise<FinishResult> {
  const challenge = await prisma.challenge.findUnique({ where: { id: challengeId } });
  if (!challenge) throw new ChallengeError("Challenge not found.");
  if (challenge.status !== ChallengeStatus.IN_PROGRESS) {
    throw new ChallengeError("This challenge is not currently in progress.");
  }

  const now = new Date();
  if (challenge.deadline && now > challenge.deadline) {
    throw new ChallengeError("TIME_EXPIRED");
  }

  const participant = await prisma.challengeParticipant.findUnique({
    where: { challengeId_userId: { challengeId, userId } },
  });
  if (!participant) {
    throw new ChallengeError("NOT_A_PARTICIPANT");
  }
  if (participant.status === ParticipantStatus.FINISHED) {
    throw new ChallengeError("ALREADY_FINISHED");
  }

  // Always record the attempt count, even on incorrect guesses, to allow
  // future rate-limiting / anti-brute-force logic.
  await prisma.challengeParticipant.update({
    where: { id: participant.id },
    data: { flagAttempts: { increment: 1 } },
  });

  const correct = verifyFlag(submittedFlag, challenge.correctFlagHash);
  if (!correct) {
    return { correct: false };
  }

  const completionTimeMs = challenge.startTime ? now.getTime() - challenge.startTime.getTime() : 0;

  await prisma.challengeParticipant.update({
    where: { id: participant.id },
    data: {
      status: ParticipantStatus.FINISHED,
      finishedAt: now,
      completionTimeMs,
    },
  });

  return { correct: true, completionTimeMs, challenge };
}

export interface RankedParticipant extends ChallengeParticipant {
  user: { id: string; username: string };
}

/**
 * Computes final rankings. Ties (identical completionTimeMs) are broken by
 * the earlier finishedAt server timestamp, per spec section 12.
 */
export function computeRankings(participants: RankedParticipant[]): RankedParticipant[] {
  const finished = participants
    .filter((p) => p.status === ParticipantStatus.FINISHED && p.completionTimeMs !== null)
    .sort((a, b) => {
      const timeDiff = (a.completionTimeMs ?? 0) - (b.completionTimeMs ?? 0);
      if (timeDiff !== 0) return timeDiff;
      const aTime = a.finishedAt?.getTime() ?? 0;
      const bTime = b.finishedAt?.getTime() ?? 0;
      return aTime - bTime;
    });
  return finished;
}

/**
 * Closes a challenge (host-triggered END or automatic expiry): computes
 * final ranks, persists them, updates player statistics/leaderboard
 * points, and returns the fully-populated challenge for rendering results.
 */
export async function closeChallenge(challengeId: string, expired: boolean) {
  const challenge = await prisma.challenge.findUnique({
    where: { id: challengeId },
    include: { participants: { include: { user: true } }, host: true },
  });
  if (!challenge) throw new ChallengeError("Challenge not found.");
  if (challenge.status !== ChallengeStatus.IN_PROGRESS) {
    throw new ChallengeError("This challenge is not currently in progress.");
  }

  const ranked = computeRankings(challenge.participants as RankedParticipant[]);

  for (let i = 0; i < ranked.length; i++) {
    const rank = i + 1;
    const points = pointsForRank(rank);
    await prisma.challengeParticipant.update({
      where: { id: ranked[i].id },
      data: { rank, pointsAwarded: points },
    });

    const isWin = rank === 1;
    const isSecond = rank === 2;
    const isThird = rank === 3;
    const currentBest = ranked[i].user.bestCompletionMs;
    const completion = ranked[i].completionTimeMs ?? undefined;
    const newBest =
      completion !== undefined && (currentBest === null || currentBest === undefined || completion < currentBest)
        ? completion
        : currentBest;

    await prisma.user.update({
      where: { id: ranked[i].userId },
      data: {
        challengesPlayed: { increment: 1 },
        challengesCompleted: { increment: 1 },
        challengesWon: { increment: isWin ? 1 : 0 },
        challengesSecond: { increment: isSecond ? 1 : 0 },
        challengesThird: { increment: isThird ? 1 : 0 },
        totalPoints: { increment: points },
        bestCompletionMs: newBest,
      },
    });
  }

  const notFinished = challenge.participants.filter(
    (p) => p.status !== ParticipantStatus.FINISHED
  );
  for (const p of notFinished) {
    await prisma.challengeParticipant.update({
      where: { id: p.id },
      data: { status: ParticipantStatus.DID_NOT_FINISH },
    });
    await prisma.user.update({
      where: { id: p.userId },
      data: { challengesPlayed: { increment: 1 } },
    });
  }

  return prisma.challenge.update({
    where: { id: challengeId },
    data: {
      status: expired ? ChallengeStatus.EXPIRED : ChallengeStatus.COMPLETED,
      endedAt: new Date(),
    },
    include: { participants: { include: { user: true } }, host: true },
  });
}

/** Finds all challenges still IN_PROGRESS — used to restore timers on boot. */
export async function findActiveChallenges() {
  return prisma.challenge.findMany({
    where: { status: ChallengeStatus.IN_PROGRESS },
    include: { participants: { include: { user: true } }, host: true },
  });
}

/** Finds all challenges still WAITING — used to re-arm buttons on boot. */
export async function findWaitingChallenges() {
  return prisma.challenge.findMany({
    where: { status: ChallengeStatus.WAITING },
    include: { participants: { include: { user: true } }, host: true },
  });
}

export async function getLeaderboard(limit = 10) {
  return prisma.user.findMany({
    orderBy: { totalPoints: "desc" },
    take: limit,
  });
}

export async function getUserStats(userId: string) {
  return prisma.user.findUnique({ where: { id: userId } });
}

export async function getChallengeHistory(guildId: string, limit = 10) {
  return prisma.challenge.findMany({
    where: {
      guildId,
      status: { in: [ChallengeStatus.COMPLETED, ChallengeStatus.EXPIRED] },
    },
    orderBy: { endedAt: "desc" },
    take: limit,
    include: { participants: { include: { user: true } } },
  });
}
