/**
 * Mock renderer for building and testing the workflow without spending credits.
 * Stateless: the job id carries its start time, so "rendering" advances with the
 * clock and completes after RENDER_MS with a bundled sample clip (public/mock/).
 * Enabled only when AVATAR_MOCK=1. A line containing MOCK_FAIL fails, to test failure handling.
 */
import { ProviderError, type AvatarProvider } from "./provider";

const RENDER_MS = 8000;
const TEST_RENDER_MS = 4000;
/** Length of public/mock/avatar-sample.webm */
const SAMPLE_SECONDS = 6;

export const MockAvatarProvider: AvatarProvider = {
  id: "mock",
  label: "Mock renderer (testing, no credits)",
  capabilities: { qualities: ["preview", "standard", "high"], backgrounds: ["transparent", "provider"], gestures: true, cancel: true, paid: false },

  configured: env => env.AVATAR_MOCK === "1",

  async renderAvatarScene(_env, req) {
    const flags = `${req.test ? "t" : ""}${/MOCK_FAIL/.test(req.text) ? "f" : ""}`;
    return { providerJobId: `${Date.now()}-${flags || "n"}`, status: "queued", alpha: req.background === "transparent", gestures: !!req.motion?.prompt };
  },

  async getRenderStatus(_env, id) {
    const m = id.match(/^(\d{10,16})-([tfn]+)$/);
    if (!m) throw new ProviderError("Unknown render.", 404);
    const elapsed = Date.now() - Number(m[1]);
    const total = m[2].includes("t") ? TEST_RENDER_MS : RENDER_MS;
    if (elapsed < 1000) return { status: "queued", progress: 0, mediaUrl: null, duration: null, error: null };
    if (elapsed < total) return { status: "rendering", progress: Math.min(0.99, elapsed / total), mediaUrl: null, duration: null, error: null };
    if (m[2].includes("f")) return { status: "failed", progress: null, mediaUrl: null, duration: null, error: "The mock renderer failed this line on purpose (MOCK_FAIL)." };
    return { status: "completed", progress: 1, mediaUrl: "/mock/avatar-sample.webm", duration: SAMPLE_SECONDS, error: null };
  },

  getAvailableAvatars: async () => [{ id: "mock-victor", name: "Victor (mock)", image: null }],
  getAvailableVoices: async () => [{ id: "mock-voice", name: "Mock voice", language: "English", gender: "male" }],
  fetchRenderedMedia: async () => new Response(null, { status: 302, headers: { Location: "/mock/avatar-sample.webm" } }),
  cancelRender: async () => true
};
