import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, X } from "lucide-react";
import Header from "./components/Header.tsx";
import SettingsModal from "./components/SettingsModal.tsx";
import ScriptSection from "./components/ScriptSection.tsx";
import AvatarStudio from "./components/AvatarStudio.tsx";
import VideoSection from "./components/VideoSection.tsx";
import EffectsBranding from "./components/EffectsBranding.tsx";
import AdvancedTools from "./components/AdvancedTools.tsx";
import ExportSection from "./components/ExportSection.tsx";
import Teleprompter from "./components/Teleprompter.tsx";
import type { Placement } from "./components/VideoPreview.tsx";
import { parseScript, type Direction, type DirectionType, type Scene } from "./lib/parser.ts";
import { TARGETED, timedEffects } from "./lib/effects.ts";
import { Player } from "./lib/player.ts";
import { emptyMedia } from "./lib/render.ts";
import { buildChapters } from "./lib/chapters.ts";
import { insertDirection, replaceSpoken } from "./lib/scriptEdit.ts";
import {
  MAX_VIDEO_SECONDS, currentPhoto, defaultProject, mainDuration, photoKey, programTiming, sceneClipKey, targetKey,
  type AvatarClip, type AvatarSettings, type Branding, type BrollClip, type Project, type RenderState, type TargetRect,
  type VideoSettings, type VoiceSettings
} from "./lib/project.ts";
import { api, getServerStatus, pendingClipJobs, runClipJobs, type ServerStatus } from "./lib/avatar.ts";
import { deleteMedia, getClipRecord, getMedia, loadProject, newMediaId, putMedia, saveProject } from "./lib/storage.ts";
import { createAudio, createVideo, loadImage, thumbnail, videoReady } from "./lib/video.ts";
import { reduceNoise } from "./lib/audio.ts";
import type { ExportSources } from "./lib/export.ts";

const API_URL = import.meta.env.VITE_DIRECTORAI_API_URL as string | undefined;

/** Object URL for a blob stored in IndexedDB; revoked when the id changes */
function useMediaUrl(mediaId: string | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false, created: string | null = null;
    setUrl(null);
    if (mediaId) {
      void getMedia(mediaId).then(blob => {
        if (cancelled || !blob) return;
        created = URL.createObjectURL(blob);
        setUrl(created);
      });
    }
    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [mediaId]);
  return url;
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

export default function App() {
  const [project, setProject] = useState<Project>(loadProject);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [forceParse, setForceParse] = useState(0);
  const [clips, setClips] = useState<Record<string, AvatarClip>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [placement, setPlacement] = useState<Placement | null>(null);
  const [showTargets, setShowTargets] = useState(false);
  const [server, setServer] = useState<ServerStatus | null>(null);
  const [apiOnline, setApiOnline] = useState<boolean | null>(null);
  const [notice, setNotice] = useState<{ text: string; tone: "error" | "info" } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [assistBusy, setAssistBusy] = useState(false);
  const [undoScript, setUndoScript] = useState<string | null>(null);
  const [generating, setGenerating] = useState<{ done: number; total: number } | null>(null);
  const [cleaning, setCleaning] = useState<string | null>(null);
  const [translating, setTranslating] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [prompter, setPrompter] = useState(false);
  const genAbort = useRef<AbortController | null>(null);

  const patch = useCallback((fn: (p: Project) => Partial<Project>) => setProject(p => ({ ...p, ...fn(p) })), []);
  const setScript = (script: string) => patch(() => ({ script }));
  const setAvatar = (a: Partial<AvatarSettings>) => patch(p => ({ avatar: { ...p.avatar, ...a } }));
  const setVoice = (v: Partial<VoiceSettings>) => patch(p => ({ voice: { ...p.voice, ...v } }));
  const setVideo = (v: Partial<VideoSettings>) => patch(p => ({ video: { ...p.video, ...v } }));
  const setBranding = (b: Partial<Branding>) => patch(p => ({ branding: { ...p.branding, ...b } }));
  const fail = (text: string) => setNotice({ text, tone: "error" });

  // ---- parse (live, debounced) ----
  const debouncedScript = useDebounced(project.script, 400);
  const scriptForParse = forceParse ? project.script : debouncedScript;
  const main = mainDuration(project);
  const parse = useMemo(
    () => parseScript(scriptForParse, project.avatarName || "Presenter", main),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scriptForParse, project.avatarName, main, forceParse]
  );
  useEffect(() => {
    if (forceParse) setForceParse(0);
  }, [debouncedScript, forceParse]);
  const timing = programTiming(project.branding, main);
  const effects = useMemo(() => timedEffects(parse, project.targets, project.effectStyles), [parse, project.targets, project.effectStyles]);
  const chapters = useMemo(() => buildChapters(parse, timing, project.branding.intro.title), [parse, timing.intro, timing.main, timing.outro, project.branding.intro.title]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- shared state for renderer / player / export ----
  const stateRef = useRef<RenderState>(null!);
  stateRef.current = { parse, project, clips, timing };
  const getState = useCallback(() => stateRef.current, []);
  const mediaRef = useRef(emptyMedia());
  const media = mediaRef.current;
  const player = useMemo(() => new Player(getState, media), [getState, media]);
  const playheadMain = () => Math.max(0, Math.min(timing.main, player.t - timing.intro));

  // ---- autosave ----
  const projectRef = useRef(project);
  projectRef.current = project;
  const save = useCallback(() => {
    if (saveProject(projectRef.current)) setSavedAt(Date.now());
    else fail("Couldn't save — this browser's storage is full or blocked.");
  }, []);
  useEffect(() => {
    const id = setInterval(save, 30_000);
    const onHide = () => document.visibilityState === "hidden" && saveProject(projectRef.current);
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("beforeunload", onHide);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("beforeunload", onHide);
    };
  }, [save]);

  // ---- server ----
  const refreshServer = useCallback(() => void getServerStatus().then(setServer), []);
  useEffect(() => {
    refreshServer();
    if (API_URL) fetch(`${API_URL}/health`).then(r => setApiOnline(r.ok)).catch(() => setApiOnline(false));
    else setApiOnline(navigator.onLine);
  }, [refreshServer]);
  // If D-ID isn't configured, fall back to the free animated voice
  useEffect(() => {
    if (server && !server.did && project.voice.engine === "did" && server.tts) setVoice({ engine: "animated" });
  }, [server]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- media elements ----
  const baseUrl = useMediaUrl(project.base?.mediaId);
  const cleanUrl = useMediaUrl(project.cleanedAudio?.mediaId);
  const musicUrl = useMediaUrl(project.music?.mediaId);
  const photo = currentPhoto(project.avatar);
  const photoUrl = useMediaUrl(photo?.mediaId);

  useEffect(() => {
    if (!baseUrl) {
      media.base = null;
      return;
    }
    const el = createVideo(baseUrl);
    media.base = el;
    return () => el.pause();
  }, [baseUrl, media]);

  useEffect(() => {
    media.baseAudio = null;
    if (!cleanUrl || !project.video.cleanBaseAudio) return;
    const el = createAudio(cleanUrl);
    media.baseAudio = el;
    return () => el.pause();
  }, [cleanUrl, project.video.cleanBaseAudio, media]);

  useEffect(() => {
    media.music = null;
    if (!musicUrl) return;
    const el = createAudio(musicUrl);
    media.music = el;
    return () => el.pause();
  }, [musicUrl, media]);

  useEffect(() => {
    media.avatarPhoto = null;
    if (photoUrl) void loadImage(photoUrl).then(img => (media.avatarPhoto = img)).catch(() => {});
  }, [photoUrl, media]);

  useEffect(() => {
    media.logo = null;
    if (project.branding.logo) void loadImage(project.branding.logo).then(img => (media.logo = img)).catch(() => {});
  }, [project.branding.logo, media]);

  useEffect(() => {
    const wanted = new Map(Object.values(clips).filter(c => c.status === "done" && c.url).map(c => [c.key, c]));
    media.clips.forEach((el, key) => {
      if (!wanted.has(key)) {
        el.pause();
        media.clips.delete(key);
      }
    });
    wanted.forEach((c, key) => {
      if (!media.clips.has(key)) media.clips.set(key, c.kind === "audio" ? createAudio(c.url!) : createVideo(c.url!));
    });
  }, [clips, media]);

  // B-roll elements + their object URLs (also used for export)
  const brollUrls = useRef(new Map<string, string>());
  const brollIds = project.broll.map(b => `${b.id}:${b.mediaId}`).join(",");
  useEffect(() => {
    const ids = new Set(project.broll.map(b => b.id));
    media.broll.forEach((el, id) => {
      if (!ids.has(id)) {
        el.pause();
        media.broll.delete(id);
        const u = brollUrls.current.get(id);
        if (u) URL.revokeObjectURL(u);
        brollUrls.current.delete(id);
      }
    });
    for (const b of project.broll) {
      if (media.broll.has(b.id)) continue;
      void getMedia(b.mediaId).then(blob => {
        if (!blob || media.broll.has(b.id)) return;
        const url = URL.createObjectURL(blob);
        brollUrls.current.set(b.id, url);
        media.broll.set(b.id, createVideo(url, true));
      });
    }
  }, [brollIds, media]); // eslint-disable-line react-hooks/exhaustive-deps

  // Restore generated avatar lines saved in IndexedDB
  useEffect(() => {
    const keys = parse.scenes.map(s => sceneClipKey(project.avatar, project.voice, s.spoken)).filter((k): k is string => !!k);
    for (const key of keys) {
      if (stateRef.current.clips[key]) continue;
      void getClipRecord(key).then(rec => {
        if (!rec || stateRef.current.clips[key]?.status === "done") return;
        setClips(c => ({ ...c, [key]: { key, status: "done", kind: rec.kind, blob: rec.blob, url: URL.createObjectURL(rec.blob), duration: rec.duration, envelope: rec.envelope } }));
      });
    }
  }, [parse, project.avatar, project.voice]);

  // ---- actions: media ----
  const replaceMedia = async (oldId: string | undefined, file: Blob, prefix: string) => {
    const id = newMediaId(prefix);
    await putMedia(id, file);
    if (oldId) void deleteMedia(oldId);
    return id;
  };

  const onBaseFile = async (file: File) => {
    setBusy("Loading video…");
    const url = URL.createObjectURL(file);
    try {
      const duration = await videoReady(createVideo(url, true));
      if (duration > MAX_VIDEO_SECONDS + 1) return fail(`That video is ${Math.round(duration / 60)} minutes long. The limit is 30 minutes — trim it first.`);
      setBusy("Saving video to this browser…");
      const mediaId = await replaceMedia(project.base?.mediaId, file, "base");
      if (project.cleanedAudio) void deleteMedia(project.cleanedAudio.mediaId);
      patch(p => ({ base: { mediaId, name: file.name, duration }, cleanedAudio: null, video: { ...p.video, trimIn: 0, trimOut: null, cleanBaseAudio: false } }));
      player.seek(0);
    } catch {
      fail("This video format isn't supported by your browser. Try MP4.");
    } finally {
      URL.revokeObjectURL(url);
      setBusy(null);
    }
  };

  const onMusicFile = async (file: File) => {
    setBusy("Loading music…");
    const url = URL.createObjectURL(file);
    try {
      const el = createAudio(url);
      const duration = await new Promise<number>((res, rej) => {
        el.onloadedmetadata = () => res(el.duration);
        el.onerror = () => rej(new Error());
      });
      const mediaId = await replaceMedia(project.music?.mediaId, file, "music");
      patch(() => ({ music: { mediaId, name: file.name, duration } }));
    } catch {
      fail("That audio file couldn't be played. Try MP3 or WAV.");
    } finally {
      URL.revokeObjectURL(url);
      setBusy(null);
    }
  };

  const onAddBroll = async (file: File) => {
    setBusy("Adding B-roll…");
    const url = URL.createObjectURL(file);
    try {
      const duration = await videoReady(createVideo(url, true));
      const mediaId = newMediaId("broll");
      await putMedia(mediaId, file);
      const start = Math.min(playheadMain(), Math.max(0, main - 1));
      const clip: BrollClip = { id: newMediaId("b"), mediaId, name: file.name, duration, start, length: Math.min(duration, 5, main - start), mode: "full" };
      patch(p => ({ broll: [...p.broll, clip] }));
    } catch {
      fail("That clip couldn't be loaded. Try MP4.");
    } finally {
      URL.revokeObjectURL(url);
      setBusy(null);
    }
  };

  const onPhoto = async (file: File) => {
    const mediaId = await replaceMedia(photo?.mediaId, file, "photo");
    const thumb = await thumbnail(file);
    const key = photoKey(project.avatar);
    patch(p => ({ avatar: { ...p.avatar, photos: { ...p.avatar.photos, [key]: { mediaId, thumbnail: thumb } } } }));
  };

  const clean = async (which: "base" | "music") => {
    const ref = which === "base" ? project.base : project.music;
    if (!ref) return;
    setCleaning(which);
    setBusy(which === "base" ? "Cleaning video audio… (loads the audio engine the first time)" : "Cleaning music…");
    try {
      const blob = await getMedia(ref.mediaId);
      if (!blob) throw new Error();
      const out = await reduceNoise(blob, ref.duration, pr => setBusy(`Cleaning audio… ${Math.round(pr * 100)}%`));
      if (which === "base") {
        const mediaId = await replaceMedia(project.cleanedAudio?.mediaId, out, "clean");
        patch(p => ({ cleanedAudio: { mediaId, name: "Cleaned audio", duration: ref.duration }, video: { ...p.video, cleanBaseAudio: true } }));
      } else {
        const mediaId = await replaceMedia(ref.mediaId, out, "music");
        patch(() => ({ music: { ...ref, mediaId, name: `${ref.name} (cleaned)` } }));
      }
      setNotice({ text: "Audio cleaned.", tone: "info" });
    } catch {
      fail("Noise reduction didn't work on this file. The video engine may have failed to load — check your connection.");
    } finally {
      setCleaning(null);
      setBusy(null);
    }
  };

  // ---- actions: avatar ----
  const generate = async (confirmFirst: boolean): Promise<boolean> => {
    const jobs = pendingClipJobs(parse.scenes, project.avatar, project.voice, clips);
    if (jobs.length === 0) return true;
    if (confirmFirst && project.voice.engine === "did") {
      const words = jobs.reduce((n, j) => n + j.text.split(/\s+/).length, 0);
      if (!window.confirm(`Generate ${jobs.length} avatar line${jobs.length > 1 ? "s" : ""} with D-ID (about ${Math.max(1, Math.round(words / 2.5))}s of speech)? This uses D-ID credits.`)) return false;
    }
    const ctrl = new AbortController();
    genAbort.current = ctrl;
    setGenerating({ done: 0, total: jobs.length });
    try {
      const key = photoKey(project.avatar);
      const result = await runClipJobs(jobs, project.avatar, project.voice,
        (k, clip) => {
          setClips(c => ({ ...c, [k]: clip }));
          if (clip.status === "done" || clip.status === "error") setGenerating(g => g && { ...g, done: g.done + 1 });
        },
        didUrl => patch(p => ({ avatar: { ...p.avatar, photos: { ...p.avatar.photos, [key]: { ...p.avatar.photos[key], didUrl } } } })),
        ctrl.signal);
      if (result.failed) fail(`${result.failed} avatar line${result.failed > 1 ? "s" : ""} didn't generate — see the Avatar Studio for details.`);
      return result.failed === 0;
    } catch (err) {
      fail(err instanceof Error && err.message.length < 200 ? err.message : "Avatar generation failed. Try again.");
      return false;
    } finally {
      setGenerating(null);
    }
  };

  // ---- actions: script & effects ----
  const onAssist = async () => {
    setAssistBusy(true);
    try {
      const res = await api<{ script: string; truncated: boolean }>("/api/assist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: project.script, avatar_name: project.avatarName, video_duration_seconds: main })
      });
      setUndoScript(project.script);
      setScript(res.script);
      setForceParse(n => n + 1);
      if (res.truncated) setNotice({ text: "AI Assist's output was cut short — check the end of the script.", tone: "info" });
    } catch (err) {
      fail(err instanceof Error ? err.message : "AI Assist failed. Try again.");
    } finally {
      setAssistBusy(false);
    }
  };

  const selectDirection = (d: Direction) => {
    setSelectedId(d.id);
    const scene = parse.scenes[d.sceneIndex];
    if (scene?.start != null) player.seek(timing.intro + scene.start);
  };

  const setTarget = (key: string, rect: TargetRect) => patch(p => ({ targets: { ...p.targets, [key]: rect } }));

  const place = (d: Direction) => {
    selectDirection(d);
    player.pause();
    setPlacement({
      prompt: `Click or drag where the ${d.type.toLowerCase()} "${d.text}" should land`,
      onPlace: rect => {
        setTarget(targetKey(d), rect);
        setPlacement(null);
      },
      onCancel: () => setPlacement(null)
    });
    document.getElementById("video")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const addEffect = (keyword: string, type: DirectionType, text: string) => {
    const m = playheadMain();
    const insert = () => {
      setScript(insertDirection(projectRef.current.script, parse.scenes, m, `${keyword}: ${text}`));
      setForceParse(n => n + 1);
    };
    if (!TARGETED.has(type)) return insert();
    player.pause();
    setPlacement({
      prompt: `Click or drag where the ${type.toLowerCase()} "${text}" should land`,
      onPlace: rect => {
        setTarget(targetKey({ type, text } as Direction), rect);
        insert();
        setPlacement(null);
      },
      onCancel: () => setPlacement(null)
    });
    document.getElementById("video")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const onTranslate = async (language: string) => {
    const spoken = [...new Set(parse.scenes.map(s => s.spoken).filter(Boolean))];
    const have = project.translations[language] ?? {};
    const todo = spoken.filter(s => !have[s]);
    if (todo.length === 0) {
      setBranding({ captions: { ...project.branding.captions, language } });
      return setNotice({ text: `Captions are already translated to ${language}.`, tone: "info" });
    }
    setTranslating(language);
    try {
      const res = await api<{ translations: string[] }>("/api/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lines: todo, language })
      });
      const merged = { ...have };
      todo.forEach((s, i) => (merged[s] = res.translations[i]));
      patch(p => ({ translations: { ...p.translations, [language]: merged }, branding: { ...p.branding, captions: { ...p.branding.captions, language } } }));
      setNotice({ text: `Captions translated to ${language}.`, tone: "info" });
    } catch (err) {
      fail(err instanceof Error ? err.message : "Translation failed. Try again.");
    } finally {
      setTranslating(null);
    }
  };

  const exportSources = async (): Promise<ExportSources> => ({
    base: baseUrl, cleanedAudio: cleanUrl, music: musicUrl, broll: new Map(brollUrls.current), photo: photoUrl
  });

  const resetProject = () => {
    const p = projectRef.current;
    [p.base, p.music, p.cleanedAudio, ...p.broll].forEach(m => m && void deleteMedia(m.mediaId));
    Object.values(p.avatar.photos).forEach(ph => void deleteMedia(ph.mediaId));
    const fresh = defaultProject();
    setProject(fresh);
    saveProject(fresh);
    setClips({});
    setSettingsOpen(false);
    player.seek(0);
  };

  const spokenScenes = parse.scenes.filter(s => s.spoken);
  const clipsReady = spokenScenes.filter(s => {
    const k = sceneClipKey(project.avatar, project.voice, s.spoken);
    return k && clips[k]?.status === "done";
  }).length;
  const fileBase = (project.name || "directorai").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "directorai";
  const languages = Object.keys(project.translations);

  return (
    <div className="min-h-full pb-10">
      <Header name={project.name} setName={name => patch(() => ({ name }))} savedAt={savedAt} onSave={save}
        onExport={() => document.getElementById("export")?.scrollIntoView({ behavior: "smooth" })}
        onSettings={() => setSettingsOpen(true)} apiOnline={apiOnline} />

      {notice && (
        <div className="sticky top-[60px] z-20 mx-auto mt-3 max-w-[1500px] px-4">
          <div className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm shadow-lg ${notice.tone === "error" ? "border-red-400/40 bg-[#3a1d2a] text-red-100" : "border-gold/40 bg-navy-600 text-gold"}`} role={notice.tone === "error" ? "alert" : "status"}>
            <AlertCircle size={16} className="mt-0.5 shrink-0" />
            <span className="flex-1">{notice.text}</span>
            <button onClick={() => setNotice(null)} aria-label="Dismiss"><X size={16} /></button>
          </div>
        </div>
      )}

      <main className="mx-auto grid max-w-[1500px] grid-cols-[minmax(0,1fr)] gap-4 px-3 pt-4 sm:px-4">
        <ScriptSection
          script={project.script}
          setScript={setScript}
          parse={parse}
          onParse={() => setForceParse(n => n + 1)}
          duration={main}
          intro={timing.intro}
          onAssist={onAssist}
          assistBusy={assistBusy}
          canUndo={undoScript !== null}
          onUndo={() => {
            if (undoScript === null) return;
            setScript(undoScript);
            setUndoScript(null);
            setForceParse(n => n + 1);
          }}
          selectedId={selectedId}
          onSelectDirection={d => (TARGETED.has(d.type) ? place(d) : selectDirection(d))}
          onEditSpoken={(scene: Scene, text: string) => {
            setScript(replaceSpoken(projectRef.current.script, scene, text));
            setForceParse(n => n + 1);
          }}
          onSeek={t => player.seek(t)}
          avatarName={project.avatarName}
          setAvatarName={avatarName => patch(() => ({ avatarName }))}
        />

        <AvatarStudio avatar={project.avatar} voice={project.voice} setAvatar={setAvatar} setVoice={setVoice} onPhoto={onPhoto}
          server={server} parse={parse} clips={clips} onGenerate={() => void generate(true)} generating={generating}
          onCancel={() => genAbort.current?.abort()} />

        <VideoSection player={player} media={media} getState={getState} effects={effects} project={project} setVideo={setVideo}
          setDuration={d => patch(() => ({ durationInput: d }))} parse={parse} clips={clips} chapters={chapters}
          selectedId={selectedId} onSelect={selectDirection} placement={placement} showTargets={showTargets} setShowTargets={setShowTargets}
          onBaseFile={f => void onBaseFile(f)}
          onRemoveBase={() => {
            if (project.base) void deleteMedia(project.base.mediaId);
            if (project.cleanedAudio) void deleteMedia(project.cleanedAudio.mediaId);
            patch(p => ({ base: null, cleanedAudio: null, video: { ...p.video, trimIn: 0, trimOut: null, cleanBaseAudio: false } }));
          }}
          onMusicFile={f => void onMusicFile(f)}
          onRemoveMusic={() => {
            if (project.music) void deleteMedia(project.music.mediaId);
            patch(() => ({ music: null }));
          }}
          busy={busy} />

        <EffectsBranding project={project} effects={effects} intro={timing.intro} playhead={playheadMain} selectedId={selectedId}
          onSelect={selectDirection} onAdd={addEffect} onPlace={place}
          onResetTarget={d => patch(p => {
            const next = { ...p.targets };
            delete next[targetKey(d)];
            return { targets: next };
          })}
          onColor={(d, color) => patch(p => ({ effectStyles: { ...p.effectStyles, [targetKey(d)]: { ...p.effectStyles[targetKey(d)], color: color ?? undefined } } }))}
          setBranding={setBranding} languages={languages} />

        <AdvancedTools project={project} chapters={chapters} spokenLines={spokenScenes.map(s => s.spoken)} setVideo={setVideo}
          onCleanBase={() => clean("base")} onCleanMusic={() => clean("music")} cleaning={cleaning}
          onAddBroll={f => void onAddBroll(f)}
          onUpdateBroll={(id, change) => patch(p => ({ broll: p.broll.map(b => (b.id === id ? { ...b, ...change } : b)) }))}
          onRemoveBroll={id => patch(p => {
            const b = p.broll.find(x => x.id === id);
            if (b) void deleteMedia(b.mediaId);
            return { broll: p.broll.filter(x => x.id !== id) };
          })}
          playhead={playheadMain} onTranslate={onTranslate} translating={translating} onTeleprompter={() => setPrompter(true)} fileBase={fileBase} />

        <ExportSection getState={getState} sources={exportSources} clipsReady={clipsReady} clipsNeeded={spokenScenes.length}
          canGenerate={!!photo} ensureAvatar={() => generate(false)} pausePreview={() => player.pause()} fileBase={fileBase} />

        <footer className="py-4 text-center text-xs text-white/35">
          DirectorAI™ | HCCGSA LLC · <a className="hover:text-gold" href="https://directorai.hccgsa.com/legal">Privacy</a>
        </footer>
      </main>

      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} server={server} onAccessCodeSaved={() => {
        refreshServer();
        setNotice({ text: "Access code saved.", tone: "info" });
      }} onReset={resetProject} />
      {prompter && <Teleprompter lines={spokenScenes.map(s => s.spoken)} onClose={() => setPrompter(false)} />}
    </div>
  );
}
