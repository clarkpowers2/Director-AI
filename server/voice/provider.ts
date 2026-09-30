/**
 * Voice is separate from avatar identity: an avatar renderer may bring its own
 * voice, or speech can come from a standalone TTS provider like this one.
 */
import type { Env } from "../shared";

export interface Voice { id: string; name: string; language: string; gender: string }

export interface VoiceProvider {
  id: string;
  configured(env: Env): boolean;
  getVoices(): Voice[];
  /** Audio for one line, or null if the provider couldn't make it */
  generateSpeech(env: Env, text: string, voiceId: string): Promise<Response | null>;
  /** Seconds of speech, before any audio exists */
  estimateDuration(text: string, rate?: number): number;
}

/** Typical narration pace — the same estimate the studio uses before a line is rendered */
export const estimateSpeechSeconds = (text: string, rate = 1) => text.split(/\s+/).filter(Boolean).length / (2.6 * rate);

const AURA: Voice[] = [
  ["angus", "male"], ["asteria", "female"], ["arcas", "male"], ["orion", "male"], ["orpheus", "male"], ["athena", "female"],
  ["luna", "female"], ["zeus", "male"], ["perseus", "male"], ["helios", "male"], ["hera", "female"], ["stella", "female"]
].map(([id, gender]) => ({ id, name: id[0].toUpperCase() + id.slice(1), language: "English", gender }));

/** Free voices on Cloudflare Workers AI (Deepgram Aura), MP3 out */
export const WorkersAIVoice: VoiceProvider = {
  id: "workers-ai",
  configured: env => !!env.AI,
  getVoices: () => AURA,
  estimateDuration: estimateSpeechSeconds,
  async generateSpeech(env, text, voiceId) {
    const speaker = AURA.some(v => v.id === voiceId) ? voiceId : "asteria";
    // The bundled Ai types don't list Aura yet; call it through a narrow signature
    const ai = env.AI as unknown as { run(model: string, input: object, options: object): Promise<Response> };
    const audio = await ai.run("@cf/deepgram/aura-1", { text, speaker, encoding: "mp3" }, { returnRawResponse: true });
    return audio.ok && audio.body ? audio : null;
  }
};
