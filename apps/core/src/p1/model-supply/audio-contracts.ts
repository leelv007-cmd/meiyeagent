import { z } from 'zod';

export const AUDIO_OUTPUT_FORMATS = ['mp3', 'wav'] as const;

const audioSpeechContractSchema = z.strictObject({
  format: z.enum(AUDIO_OUTPUT_FORMATS),
  language: z.string().trim().min(2).max(35),
  maxDurationSeconds: z.number().int().min(1).max(600),
  speed: z.number().min(0.5).max(2),
  tone: z.string().trim().min(1).max(80),
  voice: z.string().trim().min(1).max(120),
});

const audioSfxContractSchema = z.strictObject({
  description: z.string().trim().min(1).max(2_000),
  durationSeconds: z.number().int().min(1).max(120),
  format: z.enum(AUDIO_OUTPUT_FORMATS),
});

export type AudioSpeechContract = z.infer<typeof audioSpeechContractSchema>;
export type AudioSfxContract = z.infer<typeof audioSfxContractSchema>;

export function parseAudioSpeechContract(
  input: unknown,
): AudioSpeechContract {
  const parsed = audioSpeechContractSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error('audio.speech parameters are invalid.');
  }
  return parsed.data;
}

export function parseAudioSfxContract(input: unknown): AudioSfxContract {
  const parsed = audioSfxContractSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error('audio.sfx parameters are invalid.');
  }
  return parsed.data;
}
