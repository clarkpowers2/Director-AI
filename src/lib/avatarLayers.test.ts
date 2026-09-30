/** Avatar layer tests (Phase D) — run with `node src/lib/avatarLayers.test.ts` */
import assert from "node:assert/strict";
import {
  activeSegment, applyPreset, avatarSegments, dragTo, layoutBox, motionAt, moveSegment, resizeTo, trimSegment, withLayout,
  MIN_SCALE, type AvatarSegment
} from "./avatarLayers.ts";
import { planToProject, type ProductionPlan } from "./plan.ts";
import { defaultProject, hydrateProject, layoutFor, lineKey, speechSchedule, type Project } from "./project.ts";
import { parseScript } from "./parser.ts";

// The live Phase C acceptance plan: Victor full → bottom-right (~22–25%) → full
const HAVEN: ProductionPlan = {
  title: "Introducing Haven Memory OS™", objective: "Introduce Haven", audience: "Independent hotel GMs",
  estimated_duration_seconds: 60, captions: true, outro: null,
  scenes: [
    [0, 10, "full", 100, "What if your hotel remembered every guest the moment they walked back in?"],
    [10, 20, "bottom-right", 25, "Most independent hotels are leaving guest loyalty on the table."],
    [20, 35, "bottom-right", 22, "Haven Memory OS™ changes all of that."],
    [35, 48, "bottom-right", 24, "Haven Memory OS™ pushes real-time alerts to your team."],
    [48, 60, "full", 100, "Haven Memory OS™ was built for independent hotels exactly like yours."]
  ].map(([start, end, placement, scale, voiceover]) => ({
    start_seconds: start as number, end_seconds: end as number, purpose: "Scene", voiceover: voiceover as string,
    avatar: { appears: true, placement: placement as "full", scale_percent: scale as number, direction: "Victor smiles" },
    visual: "Haven interface", overlays: [], effects: [], transition: null, broll: null
  }))
};

const havenProject = () =>
  planToProject(HAVEN, { prompt: "", duration: 60, format: "16:9", style: "Professional", presenter: "Victor", usage: "Selected scenes", voice: "default" }, defaultProject());
const segmentsOf = (p: Project) => avatarSegments(parseScript(p.script, p.avatarName, p.durationInput), p, {}, p.durationInput ?? 60);
const near = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

const checks: [string, () => void][] = [
  ["Phase C plan → Studio: 0–10 full, 10–48 bottom-right 22–25%, 48–60 full", () => {
    const segs = segmentsOf(havenProject());
    assert.equal(segs.length, 5);
    const at = (t: number) => activeSegment(segs, t)!;
    assert.equal(at(5).layout.preset, "full");
    for (const t of [10, 15, 30, 47.9]) {
      const l = at(t).layout;
      assert.equal(l.preset, "bottom-right");
      assert.ok(l.scale >= 0.22 && l.scale <= 0.25, `scale ${l.scale}`);
    }
    assert.equal(at(48).layout.preset, "full");
    assert.equal(at(59.9).layout.preset, "full");
    assert.deepEqual(segs.map(s => [s.start, s.end]), [[0, 10], [10, 20], [20, 35], [35, 48], [48, 60]]);
  }],
  ["presets: full, bottom-right, bottom-left, top corners, center", () => {
    assert.deepEqual(applyPreset("full"), { preset: "full", x: 0.5, y: 0.5, scale: 1 });
    const br = applyPreset("bottom-right"), bl = applyPreset("bottom-left");
    assert.ok(br.x > 0.5 && br.y > 0.5 && bl.x < 0.5 && bl.y > 0.5);
    assert.equal(br.scale, bl.scale);
    assert.ok(applyPreset("top-right").y < 0.5 && applyPreset("top-left").x < 0.5);
    assert.equal(applyPreset("center").x, 0.5);
    assert.equal(applyPreset("bottom-right", "16:9", 0.23).scale, 0.23, "explicit scale kept");
  }],
  ["normalized placement: same layout lands in the same relative spot at any resolution", () => {
    const l = applyPreset("bottom-right");
    const a = layoutBox(l, 1280, 720, 0.8), b = layoutBox(l, 3840, 2160, 0.8);
    near(a.x / 1280, b.x / 3840); near(a.y / 720, b.y / 2160); near(a.w / 1280, b.w / 3840);
    near(a.w / 1280, l.scale);
  }],
  ["aspect ratios 16:9, 9:16, 1:1: box keeps the avatar's aspect and stays inside the frame", () => {
    for (const [W, H, format] of [[1920, 1080, "16:9"], [1080, 1920, "9:16"], [1080, 1080, "1:1"]] as const) {
      for (const preset of ["bottom-right", "bottom-left", "top-right", "top-left", "center"] as const) {
        for (const aspect of [0.5, 0.8, 16 / 9]) {
          const box = layoutBox(applyPreset(preset, format), W, H, aspect);
          near(box.w / box.h, aspect, 1e-9);
          assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.w <= W + 1e-9 && box.y + box.h <= H + 1e-9, `${format} ${preset} ${aspect}`);
        }
      }
      assert.deepEqual(layoutBox(applyPreset("full", format), W, H, 0.8), { x: 0, y: 0, w: W, h: H });
    }
    // a narrow 9:16 frame gets a larger corner share than 16:9
    assert.ok(applyPreset("bottom-right", "9:16").scale > applyPreset("bottom-right", "16:9").scale);
  }],
  ["drag: follows the pointer and is kept inside the frame", () => {
    const box = layoutBox(applyPreset("bottom-right"), 1280, 720, 0.8);
    const moved = dragTo(box, 100, 50, 1280, 720);
    assert.equal(moved.preset, "custom");
    near(moved.x, (100 + box.w / 2) / 1280); near(moved.y, (50 + box.h / 2) / 720);
    const out = layoutBox({ ...applyPreset("center"), ...dragTo(box, -500, 9999, 1280, 720) }, 1280, 720, 0.8);
    assert.ok(out.x === 0 && Math.abs(out.y + out.h - 720) < 1e-6, "clamped to the frame");
  }],
  ["resize: aspect kept, minimum size, never past the frame", () => {
    const box = layoutBox(applyPreset("top-left"), 1280, 720, 0.8);
    const bigger = resizeTo(box, box.x + box.w * 1.5, box.y + 5, 1280, 720);
    near(bigger.scale, (box.w * 1.5) / 1280);
    const grown = layoutBox({ ...bigger }, 1280, 720, 0.8);
    near(grown.x, box.x, 1e-6); near(grown.y, box.y, 1e-6); near(grown.w / grown.h, 0.8, 1e-9);
    assert.ok(resizeTo(box, box.x - 50, box.y - 50, 1280, 720).scale >= MIN_SCALE - 1e-9);
    const huge = layoutBox(resizeTo(box, 99999, 99999, 1280, 720), 1280, 720, 0.8);
    assert.ok(huge.x + huge.w <= 1280 + 1e-6 && huge.y + huge.h <= 720 + 1e-6);
  }],
  ["persistence: scale, visibility, start/end, entrance/exit survive save → reload", () => {
    let p = havenProject();
    const seg = segmentsOf(p)[2];
    p = { ...p, avatarLayouts: withLayout(p, seg.key, seg.spoken, { scale: 0.31, visible: false, start: 21, end: 33, entrance: "slide", exit: "none", opacity: 0.8 }) };
    const reloaded = hydrateProject(JSON.parse(JSON.stringify(p)));
    const l = layoutFor(reloaded, seg.spoken);
    assert.deepEqual([l.scale, l.visible, l.start, l.end, l.entrance, l.exit, l.opacity], [0.31, false, 21, 33, "slide", "none", 0.8]);
    const again = segmentsOf(reloaded)[2];
    assert.deepEqual([again.start, again.end], [21, 33]);
    assert.equal(activeSegment(segmentsOf(reloaded), 34), null, "a trimmed window leaves the avatar off screen until the next layer");
    assert.equal(activeSegment(segmentsOf(reloaded), 35)?.index, 3);
  }],
  ["scene visibility: visible/full → bottom-right → hidden → bottom-right → full", () => {
    let p = havenProject();
    const seg = segmentsOf(p)[2];
    p = { ...p, avatarLayouts: withLayout(p, seg.key, seg.spoken, { visible: false }) };
    assert.deepEqual(segmentsOf(p).map(s => s.layout.visible ? s.layout.preset : "hidden"), ["full", "bottom-right", "hidden", "bottom-right", "full"]);
  }],
  ["timing: moving a layer moves its window and its speech; trimming changes the window only", () => {
    let p = havenProject();
    const seg = segmentsOf(p)[1];
    p = { ...p, avatarLayouts: withLayout(p, seg.key, seg.spoken, moveSegment(seg, 2, 60)) };
    const parse = parseScript(p.script, p.avatarName, 60);
    const moved = segmentsOf(p)[1];
    assert.deepEqual([moved.start, moved.end, moved.speechStart], [12, 22, 12]);
    assert.equal(speechSchedule(parse, p, {})[1].start, 12);
    const trimmed = trimSegment(moved, "end", 18, 60);
    assert.equal(trimmed.end, 18);
    assert.equal(trimmed.start, undefined);
    assert.deepEqual(trimSegment(moved, "start", 100, 60), { start: moved.end - 0.25 });
    assert.equal(moveSegment(segmentsOf(p)[4], 30, 60).end, 60, "never moved past the end");
  }],
  ["entrance/exit: fade, slide and pop; none; no animation where the avatar continues in place", () => {
    const base = segmentsOf(havenProject());
    const seg = (layout: Partial<AvatarSegment["layout"]>, extra: Partial<AvatarSegment> = {}): AvatarSegment =>
      ({ ...base[1], layout: { ...base[1].layout, ...layout }, continuesFromPrevious: false, continuesToNext: false, ...extra });
    assert.equal(motionAt(seg({ entrance: "fade", exit: "fade" }), 10, 1280).alpha, 0);
    assert.equal(motionAt(seg({ entrance: "fade", exit: "fade" }), 15, 1280).alpha, 1);
    assert.ok(motionAt(seg({ entrance: "slide", exit: "none" }), 10, 1280).dx > 0, "slides in from its own side");
    assert.ok(motionAt(seg({ entrance: "pop", exit: "none" }), 10.05, 1280).scale < 1);
    assert.deepEqual(motionAt(seg({ entrance: "none", exit: "none" }), 10, 1280), { alpha: 1, dx: 0, scale: 1 });
    assert.equal(motionAt(seg({ entrance: "fade", exit: "fade" }, { continuesFromPrevious: true }), 10, 1280).alpha, 1);
    // bottom-right 25% → 22% → 24% are different sizes, so those boundaries do animate
    assert.equal(base[1].continuesToNext, false);
  }],
  ["existing projects without layouts keep the old project-wide placement", () => {
    const old = hydrateProject({ version: 3, name: "Old", script: '[0:00] Victor says: "Hello there."', avatar: { position: "left", size: "large", enabled: true } });
    const segs = segmentsOf(old);
    assert.equal(segs.length, 1);
    assert.ok(segs[0].layout.x < 0.5 && Math.abs(segs[0].layout.scale - 0.5) < 1e-9 && segs[0].layout.visible);
    assert.deepEqual([segs[0].layout.start, segs[0].layout.end], [null, null]);
    const hidden = hydrateProject({ version: 3, script: "[0:00] Hi.", durationInput: 10, avatar: { enabled: false } });
    assert.equal(segmentsOf(hidden)[0].layout.visible, false);
  }],
  ["layout keys follow the spoken text only (avatar or voice changes keep placement)", () => {
    const p = havenProject();
    const seg = segmentsOf(p)[1];
    assert.equal(seg.key, lineKey(seg.spoken));
    const swapped = { ...p, voice: { ...p.voice, heygenVoice: { id: "other", name: "Other" } } };
    assert.equal(segmentsOf(swapped)[1].layout.scale, seg.layout.scale);
  }]
];

let failed = 0;
for (const [name, fn] of checks) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (err) {
    failed++;
    console.log(`✗ ${name}\n  ${(err as Error).message.split("\n").join("\n  ")}`);
  }
}
console.log(`\n${checks.length - failed}/${checks.length} avatar layer checks passed`);
process.exit(failed ? 1 : 0);
