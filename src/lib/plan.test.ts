/** Plan → project tests — run with `node src/lib/plan.test.ts` */
import assert from "node:assert/strict";
import { parseScript } from "./parser.ts";
import { planToProject, spokenLines, type ProductionPlan } from "./plan.ts";
import { defaultProject, layoutFor } from "./project.ts";

const plan: ProductionPlan = {
  title: "Haven Memory OS™ for Independent Hotels",
  objective: "Introduce Haven to GMs", audience: "Independent hotel general managers",
  estimated_duration_seconds: 60, captions: true, outro: { cta: "Start your pilot", url: "haven-mos.org" },
  scenes: [
    { start_seconds: 0, end_seconds: 12, purpose: "Intro", voiceover: "Welcome to Haven Memory OS™. ZOOM: this is spoken, not an effect.",
      avatar: { appears: true, placement: "full", scale_percent: 100, direction: "Victor smiles and gestures toward the camera" },
      visual: "Branded opening", overlays: [{ type: "TITLE", text: "HAVEN MEMORY OS™" }], effects: [], transition: "fade", broll: null },
    { start_seconds: 12, end_seconds: 45, purpose: "Demo: dashboard", voiceover: 'Here the dashboard tracks every "open promise".',
      avatar: { appears: true, placement: "bottom-right", scale_percent: 27, direction: "points at the dashboard" },
      visual: "Haven dashboard", overlays: [], effects: [{ type: "HIGHLIGHT", target: "Open Promises" }], transition: null, broll: "Front desk at night" },
    { start_seconds: 45, end_seconds: 52, purpose: "Demo continues", voiceover: "Every shift sees the same context.",
      avatar: { appears: false, placement: "bottom-right", scale_percent: 27, direction: "" },
      visual: "Shift handoff screen", overlays: [], effects: [], transition: null, broll: null },
    { start_seconds: 52, end_seconds: 60, purpose: "CTA", voiceover: "Start your pilot at haven-mos.org.",
      avatar: { appears: true, placement: "full", scale_percent: 100, direction: "" },
      visual: "", overlays: [{ type: "CAPTION", text: "haven-mos.org" }], effects: [], transition: null, broll: null }
  ]
};

const checks: [string, () => void | Promise<void>][] = [
  ["only voiceover becomes speech (stage directions, visuals, keywords never spoken)", () => {
    const p = planToProject(plan, { prompt: "", duration: 60, format: "16:9", style: "Professional", presenter: "Victor", usage: "DirectorAI decides", voice: "default" }, defaultProject());
    assert.deepEqual(spokenLines(p), [
      "Welcome to Haven Memory OS™. ZOOM: this is spoken, not an effect.",
      "Here the dashboard tracks every ”open promise”.",
      "Every shift sees the same context.",
      "Start your pilot at haven-mos.org."
    ]);
    assert.match(p.script, /^AVATAR: Victor smiles and gestures toward the camera$/m);
    assert.match(p.script, /^AVATAR: Victor points at the dashboard$/m);
    assert.match(p.script, /^HIGHLIGHT: Open Promises$/m);
  }],
  ["production notes never become presenter gestures", async () => {
    const { lineDirections, motionPlan } = await import("./gestures.ts");
    const { parseScript } = await import("./parser.ts");
    const p = planToProject(plan, { prompt: "", duration: 60, format: "16:9", style: "", presenter: "Victor", usage: "DirectorAI decides", voice: "default" }, defaultProject());
    const parse = parseScript(p.script, "Victor", 60);
    const byLine = lineDirections(parse);
    const prompts = parse.scenes.filter(s => s.spoken).map(s => motionPlan(s, byLine.get(s.index) ?? [], "presenter", {}, "right").prompt).join(" ");
    assert.doesNotMatch(prompts, /Scene:|Visual:|B-roll:/);
    assert.match(prompts, /smiles and gestures toward the camera/i);
  }],
  ["per-line layouts: full → bottom-right 27% → hidden → full", () => {
    const p = planToProject(plan, { prompt: "", duration: 60, format: "16:9", style: "", presenter: "Victor", usage: "DirectorAI decides", voice: "default" }, defaultProject());
    const l = spokenLines(p).map(t => layoutFor(p, t));
    assert.deepEqual(l.map(x => [x.visible, x.preset, x.scale]), [[true, "full", 1], [true, "bottom-right", 0.27], [false, "bottom-right", 0.27], [true, "full", 1]]);
  }],
  ["no presenter → avatar hidden everywhere, no AVATAR lines", () => {
    const p = planToProject(plan, { prompt: "", duration: 60, format: "9:16", style: "", presenter: null, usage: "Full video", voice: "default" }, defaultProject());
    assert.ok(spokenLines(p).every(t => !layoutFor(p, t).visible));
    assert.doesNotMatch(p.script, /^AVATAR:/m);
    assert.equal(p.format, "9:16");
  }],
  ["a stage sentence accidentally placed in voiceover is kept out of speech", () => {
    const contaminated = { ...plan, scenes: [{ ...plan.scenes[0], voiceover: "Welcome to Haven. Victor gestures toward the dashboard.", avatar: { ...plan.scenes[0].avatar, direction: "" } }] };
    const p = planToProject(contaminated, { prompt:"", duration:60, format:"16:9", style:"", presenter:"Victor", usage:"DirectorAI decides", voice:"default" }, defaultProject());
    assert.deepEqual(spokenLines(p), ["Welcome to Haven."]);
    assert.match(p.script, /^AVATAR: Victor gestures toward the dashboard$/m);
  }],
  ["selected output format survives into export frame dimensions", async () => {
    const { outputDimensions } = await import("./export.ts");
    assert.deepEqual(outputDimensions("1080p", "16:9"), { w: 1920, h: 1080 });
    assert.deepEqual(outputDimensions("1080p", "9:16"), { w: 608, h: 1080 });
    assert.deepEqual(outputDimensions("1080p", "1:1"), { w: 1080, h: 1080 });
  }],
  ["multi-sentence captions, titles, effects and stage directions never become speech", () => {
    const multi: ProductionPlan = { ...plan, scenes: [{ ...plan.scenes[0], voiceover: "Only this is spoken.",
      overlays: [{ type: "CAPTION", text: "Scattered data. Missed moments. Lost loyalty." }, { type: "TITLE", text: "One hub. Every team." }],
      effects: [{ type: "HIGHLIGHT", target: "Alerts panel. Green badges." }], transition: "Fade. Then slide.",
      avatar: { ...plan.scenes[0].avatar, direction: "Victor smiles. He points at the screen." } }] };
    const p = planToProject(multi, { prompt: "", duration: 60, format: "16:9", style: "", presenter: "Victor", usage: "Full video", voice: "default" }, defaultProject());
    assert.deepEqual(spokenLines(p), ["Only this is spoken."]);
    assert.match(p.script, /^CAPTION: Scattered data · Missed moments · Lost loyalty$/m);
    assert.match(p.script, /^AVATAR: Victor smiles · He points at the screen$/m);
  }],
  ["timestamps, duration, branding carried over", () => {
    const p = planToProject(plan, { prompt: "", duration: 60, format: "16:9", style: "", presenter: "Victor", usage: "DirectorAI decides", voice: "default" }, defaultProject());
    assert.deepEqual(p.script.match(/^\[\d+:\d+\]/gm), ["[0:00]", "[0:12]", "[0:45]", "[0:52]"]);
    // voiceover starts exactly at each scene's timestamp
    const parsed = parseScript(p.script, "Victor", 60).scenes.filter(x => x.spoken).map(x => x.start);
    assert.deepEqual(parsed, [0, 12, 45, 52]);
    assert.equal(p.durationInput, 60);
    assert.equal(p.branding.outro.url, "haven-mos.org");
    assert.equal(p.branding.captions.enabled, true);
    assert.equal(p.startedWith, "ai");
  }]
];

let failed = 0;
for (const [name, fn] of checks) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (err) {
    failed++;
    console.log(`✗ ${name}\n  ${(err as Error).message.split("\n").join("\n  ")}`);
  }
}
console.log(`\n${checks.length - failed}/${checks.length} plan checks passed`);
process.exit(failed ? 1 : 0);
