/**
 * Program clock. Wall-clock time drives the program timeline; every media
 * element (base video, cleaned audio, music, avatar clips, B-roll) is started,
 * stopped, rate-matched and drift-corrected to follow it.
 */
import { activeClip, type Media } from "./render.ts";
import { SPEED_RATE, type RenderState } from "./project.ts";

const DRIFT_LIMIT = 0.3;

type El = HTMLMediaElement;

function follow(el: El, desired: number, playing: boolean, force: boolean, rate = 1) {
  if (el.playbackRate !== rate) el.playbackRate = rate;
  const drift = Math.abs(el.currentTime - desired);
  if (playing) {
    if (el.paused) {
      el.currentTime = desired;
      void el.play().catch(() => {});
    } else if (drift > DRIFT_LIMIT * Math.max(1, rate)) {
      el.currentTime = desired;
    }
  } else {
    if (!el.paused) el.pause();
    if (force || drift > 0.04) el.currentTime = desired;
  }
}

function stop(el: El) {
  if (!el.paused) el.pause();
}

export class Player {
  t = 0;
  playing = false;
  private last = 0;
  private getState: () => RenderState;
  media: Media;
  /** Export routes audio through Web Audio gains; the preview uses element volume */
  useElementVolume = true;

  constructor(getState: () => RenderState, media: Media) {
    this.getState = getState;
    this.media = media;
  }

  get total(): number {
    return this.getState().timing.total;
  }

  play(): void {
    if (this.t >= this.total - 0.05) this.t = 0;
    this.playing = true;
    this.last = performance.now();
    this.sync(true);
  }

  pause(): void {
    this.playing = false;
    const { base, baseAudio, music, clips, broll } = this.media;
    [base, baseAudio, music, ...clips.values(), ...broll.values()].forEach(el => el && stop(el));
  }

  seek(t: number): void {
    this.t = Math.min(Math.max(0, t), this.total);
    this.last = performance.now();
    this.sync(true);
  }

  /** Advance the clock and sync media. Returns false once the program has ended. */
  tick(now = performance.now()): boolean {
    if (this.playing) {
      this.t += (now - this.last) / 1000;
      this.last = now;
      if (this.t >= this.total) {
        this.t = this.total;
        this.pause();
        return false;
      }
    }
    this.sync(false);
    return true;
  }

  private sync(force: boolean): void {
    const state = this.getState();
    const { video, voice, broll } = state.project;
    const m = this.t - state.timing.intro;
    const inMain = m >= 0 && m < state.timing.main;
    const { base, baseAudio, music } = this.media;

    // Base video (and its cleaned audio): trimmed and sped up/down
    const baseTime = video.trimIn + Math.max(0, m) * video.speed;
    for (const el of [base, baseAudio]) {
      if (!el) continue;
      if (inMain && baseTime < (el.duration || Infinity)) follow(el, baseTime, this.playing, force, video.speed);
      else {
        stop(el);
        if (force) el.currentTime = Math.min(video.trimIn, el.duration || 0);
      }
    }
    if (base && this.useElementVolume) {
      base.muted = !!baseAudio;
      base.volume = video.volumes.video;
    }
    if (baseAudio && this.useElementVolume) baseAudio.volume = video.volumes.video;

    // Background music across the whole program
    if (music) {
      const d = music.duration || Infinity;
      const within = video.musicLoop || this.t < d;
      if (within) follow(music, video.musicLoop && Number.isFinite(d) ? this.t % d : this.t, this.playing, force);
      else stop(music);
      if (this.useElementVolume) music.volume = video.volumes.music;
    }

    // Avatar clips at the chosen voice speed
    const active = inMain ? activeClip(state, m) : null;
    const rate = SPEED_RATE[voice.speed];
    this.media.clips.forEach((el, key) => {
      if (active && key === active.key) follow(el, active.offset, this.playing, force, rate);
      else stop(el);
      if (this.useElementVolume) el.volume = video.volumes.voice;
    });

    // B-roll (muted)
    for (const b of broll) {
      const el = this.media.broll.get(b.id);
      if (!el) continue;
      el.muted = true;
      if (inMain && m >= b.start && m < b.start + b.length) follow(el, m - b.start, this.playing, force);
      else stop(el);
    }
  }
}
