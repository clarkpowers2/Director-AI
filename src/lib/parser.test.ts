/** Parser tests — run with `npm test` (Node 24 runs TypeScript directly). */
import assert from "node:assert/strict";
import { parseScript } from "./parser.ts";

const README_SCRIPT = `[0:00] Victor walks in and says: "Welcome to Haven Memory OS."
ZOOM: Haven logo. HIGHLIGHT: gold border.

[0:10] Victor points to the Promises tile and says:
"Right here — 3 open promises Haven is tracking."
[Promises tile zooms 150%]
[Gold pulse effect on tile]

[0:25] Victor shakes head and says:
"Most hotels lose this at shift change. Not Haven."
TRANSITION: fade to issues view`;

const BLOCK_SCRIPT = `[0:10]

VOICEOVER:
"Hotels already collect enormous amounts of information."

AVATAR:
Victor gestures toward the screen.

[0:25]
VOICEOVER: "Right here are three open promises."
AVATAR:
Victor points.
HIGHLIGHT:
Promises tile.
PULSE:`;

const checks: [string, () => void | Promise<void>][] = [
  ["timestamped lines keep spoken text", () => {
    const r = parseScript("[0:05] Welcome to the demo");
    assert.match(r.voiceover_script, /\[0:05\] Welcome to the demo/);
  }],
  ["plain numbers are not timestamps", () => {
    const r = parseScript("3 reasons to switch\n5s Next line\n1:30 Later line");
    assert.match(r.voiceover_script, /^3 reasons to switch$/m);
    assert.equal(r.scenes[2].start, 90);
  }],
  ["mid-sentence keywords stay spoken", () => {
    const r = parseScript("This button POINTS TO the dashboard, and ZOOM: is a word here.");
    assert.equal(r.counts.directions, 0);
  }],
  ["bracket and keyword syntax count the same", () => {
    const r = parseScript("[ZOOM on chart]\nZOOM: chart\n[HIGHLIGHT: logo]\nPULSE: button\n[TITLE: Intro]\nCAPTION: Hello\n[smile]");
    assert.deepEqual(r.counts, { voiceover: 0, directions: 7, visual: 4, text: 2 });
  }],
  ["duration spreads untimed scenes evenly", () => {
    const r = parseScript("One.\nTwo.\n0:30 Three.\nFour.", "P", 60);
    assert.deepEqual(r.scenes.map(s => [s.start, s.duration, s.estimated]),
      [[0, 15, true], [15, 15, true], [30, 15, false], [45, 15, true]]);
  }],
  ["README example: stage directions, chained keywords, next-line quotes", () => {
    const r = parseScript(README_SCRIPT, "Victor", 134.5);
    assert.deepEqual(r.scenes.map(s => s.spoken), [
      "Welcome to Haven Memory OS.", "", "Right here — 3 open promises Haven is tracking.",
      "", "", "Most hotels lose this at shift change. Not Haven.", ""
    ]);
    const types = r.scenes.flatMap(s => s.directions.map(d => `${d.type}:${d.text}`));
    assert.ok(types.includes("ZOOM:Haven logo"));
    assert.ok(types.includes("HIGHLIGHT:gold border"));
    assert.ok(types.includes("PULSE:Gold pulse effect on tile"));
    assert.ok(types.includes("AVATAR:Victor walks in"));
    assert.equal(r.counts.voiceover, 3);
  }],
  ["single-quoted speech from the editor placeholder", () => {
    const r = parseScript("[0:00] Victor says: 'Welcome to Haven Memory OS.'\nZOOM: Dashboard header\nHIGHLIGHT: gold border");
    assert.equal(r.scenes[0].spoken, "Welcome to Haven Memory OS.");
    assert.equal(r.counts.visual, 2);
  }],
  ["unquoted says: stays spoken", () => {
    const r = parseScript("The front desk says: we lost the booking.");
    assert.equal(r.scenes[0].spoken, "The front desk says: we lost the booking.");
  }],
  ["CALLOUT and LOWER THIRD keywords", () => {
    const r = parseScript("CALLOUT: Save button\nLOWER THIRD: Nathaniel Clarke | Founder\n[lower-third: ARIA]\nlower third: Guest Services");
    assert.deepEqual(r.scenes.flatMap(s => s.directions.map(d => d.display)),
      ["CALLOUT: Save button", "LOWER THIRD: Nathaniel Clarke | Founder", "LOWER THIRD: ARIA", "LOWER THIRD: Guest Services"]);
    assert.deepEqual(r.counts, { voiceover: 0, directions: 4, visual: 1, text: 3 });
  }],
  ["scenes record their source lines", () => {
    const r = parseScript("[0:10]\nVictor waves and says:\n\"Hello there.\"\nZOOM: logo");
    assert.deepEqual(r.scenes[0].lines, [0, 1, 2]);
    assert.equal(r.scenes[0].spokenLine, 2);
    assert.deepEqual(r.scenes[1].lines, [3]);
    assert.equal(r.scenes[1].spokenLine, null);
  }],
  ["VOICEOVER: / AVATAR: blocks — stage directions are never spoken", () => {
    const r = parseScript(BLOCK_SCRIPT, "Victor", 60);
    assert.deepEqual(r.scenes.map(s => s.spoken), ["Hotels already collect enormous amounts of information.", "", "Right here are three open promises.", "", ""]);
    assert.deepEqual(r.scenes.flatMap(s => s.directions.map(d => d.display)),
      ["AVATAR: Victor gestures toward the screen", "AVATAR: Victor points", "HIGHLIGHT: Promises tile"]);
    assert.equal(r.scenes[0].start, 10);
    assert.doesNotMatch(r.voiceover_script, /VOICEOVER:|gestures/);
  }],
  ["matches the Worker parser's text output", async () => {
    const workerParser = "../../../directorai-plugin/src/parser.js"; // plain JS in the sibling Worker repo
    const worker = (await import(workerParser).catch(() => null)) as { parseScript: typeof parseScript } | null;
    if (!worker) return; // Worker repo not checked out next to this one
    for (const script of [README_SCRIPT, BLOCK_SCRIPT]) {
      const a = parseScript(script, "Victor", 60), b = worker.parseScript(script, "Victor", 60);
      for (const k of ["voiceover_script", "scene_directions", "summary"] as const) assert.equal(a[k], b[k], k);
    }
  }],
  ["direction ids are stable and unique", () => {
    const r = parseScript(README_SCRIPT, "Victor", 60);
    const ids = r.scenes.flatMap(s => s.directions.map(d => d.id));
    assert.equal(new Set(ids).size, ids.length);
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
console.log(`\n${checks.length - failed}/${checks.length} parser checks passed`);
process.exit(failed ? 1 : 0);
