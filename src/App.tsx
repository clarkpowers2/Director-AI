import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, Clapperboard, Sparkles, X } from "lucide-react";
import Header, { MobileTabs, PAGES } from "./components/Header.tsx";
import ToolSidebar from "./components/ToolSidebar.tsx";
import AudioPage from "./components/AudioPage.tsx";
import AiPrompter, { type PrompterMessage } from "./components/AiPrompter.tsx";
import VideoPreview from "./components/VideoPreview.tsx";
import Timeline from "./components/Timeline.tsx";
import { EmptyState, PageHeader } from "./components/ui.tsx";
import { applyEdits, buildContext, EXTRA_PAGES, type CommandEdits, type PageId } from "./lib/command.ts";
import StartScreen from "./components/StartScreen.tsx";
import { Creator, PlanReview } from "./components/PlanWorkflow.tsx";
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
  MAX_VIDEO_SECONDS, SPEED_RATE, currentPhoto, defaultProject, mainDuration, photoKey, programTiming, sceneClipKey, targetKey,
  type AvatarClip, type AvatarRenderSettings, type AvatarSettings, type Branding, type BrollClip, type Project, type RenderState, type TargetRect,
  type VideoSettings, type VoiceSettings
} from "./lib/project.ts";
import {
  api, ApiError, cancelRender, fetchProviders, getServerStatus, pendingClipJobs, renderTest, runClipJobs, staleGestureCount, RenderCancelled,
  type ClipJob, type ProviderInfo, type ServerStatus
} from "./lib/avatar.ts";
import { buildAvatarScenes, type AvatarScene } from "./lib/avatarScenes.ts";
import { loadHistory, nextVersion, saveHistory, type GenerationRecord } from "./lib/history.ts";
import {
  ClipPreview, ConfirmDialog, GenerationHistory, RenderAvatarPanel, RenderQueue, TestRenderCard, providerLabel,
  type ConfirmRequest, type TestState
} from "./components/AvatarRender.tsx";
import {
  deleteMedia, deleteStoredProject, getClipRecord, getMedia, listProjects, loadCurrentProject, newMediaId, openStoredProject, putMedia, saveProject,
  type ProjectSummary
} from "./lib/storage.ts";
import { hydrateProject, newProjectId } from "./lib/project.ts";
import { planToProject, type CreatorSettings, type ProductionPlan } from "./lib/plan.ts";

/** First visit (nothing saved yet) opens the start screen */
const initialProject = loadCurrentProject();
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
  const [project, setProject] = useState<Project>(() => initialProject ?? hydrateProject(null));
  const [projects, setProjects] = useState<ProjectSummary[]>(listProjects);
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
  /** In-progress re-renders of lines that already have a clip — the old clip keeps playing meanwhile */
  const [rerenders, setRerenders] = useState<Record<string, AvatarClip>>({});
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [renderPanel, setRenderPanel] = useState<{ keys: string[] | null } | null>(null);
  const [confirmReq, setConfirmReq] = useState<ConfirmRequest | null>(null);
  const [previewClip, setPreviewClip] = useState<{ url: string; title: string; audio: boolean } | null>(null);
  const [testText, setTestText] = useState("Welcome to Haven Memory OS™, the Guest Intelligence OS™ created by Nathaniel Clarke and HCCGSA LLC™.");
  const [testState, setTestState] = useState<TestState>({ status: "idle" });
  const testAbort = useRef<AbortController | null>(null);
  const controllers = useRef(new Map<string, AbortController>());
  const [cleaning, setCleaning] = useState<string | null>(null);
  const [translating, setTranslating] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [prompter, setPrompter] = useState(false);
  const [creatorSettings, setCreatorSettings] = useState<CreatorSettings>({ prompt: "", duration: 60, format: "16:9", style: "Professional", presenter: null, usage: "DirectorAI decides", voice: "default" });
  const [productionPlan, setProductionPlan] = useState<ProductionPlan | null>(null);
  const [planBusy, setPlanBusy] = useState(false);

  const patch = useCallback((fn: (p: Project) => Partial<Project>) => setProject(p => ({ ...p, ...fn(p) })), []);
  const setScript = (script: string) => patch(() => ({ script }));
  const setAvatar = (a: Partial<AvatarSettings>) => patch(p => ({ avatar: { ...p.avatar, ...a } }));
  const setVoice = (v: Partial<VoiceSettings>) => patch(p => ({ voice: { ...p.voice, ...v } }));
  const setVideo = (v: Partial<VideoSettings>) => patch(p => ({ video: { ...p.video, ...v } }));
  const setBranding = (b: Partial<Branding>) => patch(p => ({ branding: { ...p.branding, ...b } }));
  const setAvatarRender = (r: Partial<AvatarRenderSettings>) => patch(p => ({ avatarRender: { ...p.avatarRender, ...r } }));
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

  // ---- pages (kept in the URL hash so refresh stays put) ----
  const readHash = (): PageId => {
    const h = window.location.hash.replace(/^#\/?/, "");
    if (PAGES.some(pg => pg.id === h) || EXTRA_PAGES.includes(h as PageId)) return h as PageId;
    return initialProject ? "editor" : "start";
  };
  const [page, setPage] = useState<PageId>(readHash);
  const pageRef = useRef(page);
  pageRef.current = page;
  useEffect(() => {
    const onHash = () => setPage(readHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  const goPage = (next: PageId, anchor?: string) => {
    if (window.location.hash !== `#/${next}`) window.location.hash = `/${next}`;
    setPage(next);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (anchor) document.getElementById(anchor)?.scrollIntoView({ behavior: "smooth", block: "start" });
      else window.scrollTo({ top: 0 });
    }));
  };

  // ---- one playback clock for the whole app (plays on while you switch pages) ----
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      player.tick();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [player]);

  // ---- AI prompter ----
  const [aiOpen, setAiOpen] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiMessages, setAiMessages] = useState<PrompterMessage[]>([]);
  const [aiUndo, setAiUndo] = useState<Project | null>(null);
  const [finding, setFinding] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setAiOpen(o => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ---- autosave ----
  const projectRef = useRef(project);
  projectRef.current = project;
  const save = useCallback(() => {
    // don't file the untouched sample project while someone is still choosing how to start
    const unsaved = !listProjects().some(x => x.id === projectRef.current.id);
    if (unsaved && (pageRef.current === "start" || pageRef.current === "create")) return;
    if (saveProject(projectRef.current)) {
      setSavedAt(Date.now());
      setProjects(listProjects());
    }
    else fail("Couldn't save — this browser's storage is full or blocked.");
  }, []);
  useEffect(() => {
    const id = setInterval(save, 30_000);
    const onHide = () => document.visibilityState === "hidden" && save();
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("beforeunload", onHide);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("beforeunload", onHide);
    };
  }, [save]);

  // ---- server ----
  const refreshServer = useCallback(() => {
    void getServerStatus().then(setServer);
    fetchProviders().then(setProviders).catch(() => setProviders([]));
  }, []);
  useEffect(() => {
    refreshServer();
    if (API_URL) fetch(`${API_URL}/health`).then(r => setApiOnline(r.ok)).catch(() => setApiOnline(false));
    else setApiOnline(navigator.onLine);
  }, [refreshServer]);
  // If HeyGen isn't configured, fall back to the free animated voice
  useEffect(() => {
    if (server && !server.avatar && project.voice.engine === "heygen" && server.tts) setVoice({ engine: "animated" });
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
      if (media.clips.has(key)) return;
      if (c.kind === "audio") return void media.clips.set(key, createAudio(c.url!));
      const el = createVideo(c.url!);
      // decode a first frame so the avatar has a pose to hold between lines
      el.addEventListener("loadeddata", () => {
        if (el.paused && el.currentTime === 0) el.currentTime = 0.05;
      }, { once: true });
      media.clips.set(key, el);
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
        setClips(c => ({ ...c, [key]: { key, status: "done", kind: rec.kind, blob: rec.blob, url: URL.createObjectURL(rec.blob), duration: rec.duration, envelope: rec.envelope, alpha: rec.alpha, motion: rec.motion } }));
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

  /** Validate and store a video in IndexedDB; null (with a notice) if it can't be used */
  const storeVideoFile = async (file: File, prefix: string): Promise<{ mediaId: string; name: string; duration: number } | null> => {
    if (!file.type.startsWith("video/") && !/\.(mp4|webm|mov|m4v)$/i.test(file.name)) {
      fail("That isn't a video file. Use MP4, WebM or MOV.");
      return null;
    }
    const url = URL.createObjectURL(file);
    try {
      const duration = await videoReady(createVideo(url, true));
      if (duration > MAX_VIDEO_SECONDS + 1) {
        fail(`That video is ${Math.round(duration / 60)} minutes long. The limit is 30 minutes — trim it first.`);
        return null;
      }
      const mediaId = newMediaId(prefix);
      await putMedia(mediaId, file);
      return { mediaId, name: file.name, duration };
    } catch {
      fail("This video format isn't supported by your browser. Try MP4.");
      return null;
    } finally {
      URL.revokeObjectURL(url);
    }
  };

  /** Close the open project (saved) and open another — nothing of the old one is deleted */
  const switchProject = (next: Project, to: PageId = "editor") => {
    saveProject(projectRef.current);
    player.pause();
    cancelAll();
    projectRef.current = next;
    setProject(next);
    saveProject(next);
    setProjects(listProjects());
    setClips({});
    setRerenders({});
    setTestState({ status: "idle" });
    setSelectedId(null);
    setUndoScript(null);
    setAiUndo(null);
    setAiMessages([]);
    player.seek(0);
    goPage(to);
  };

  const blankProject = (startedWith: Project["startedWith"], name: string): Project =>
    ({ ...hydrateProject(null), id: newProjectId(), name, script: "", startedWith });

  const onNewUpload = async (file: File) => {
    setBusy("Loading video…");
    try {
      const base = await storeVideoFile(file, "base");
      if (!base) return;
      const next = blankProject("upload", file.name.replace(/\.[^.]+$/, "").slice(0, 80) || "Uploaded video");
      switchProject({ ...next, base }, "editor");
      setNotice({ text: "Video added to the Base Video track. Add an avatar, narration, titles or effects.", tone: "info" });
    } finally {
      setBusy(null);
    }
  };

  const deleteProject = (pr: ProjectSummary) => setConfirmReq({
    title: "Delete project?", confirmLabel: "Delete project",
    body: <p>Delete “{pr.name || "Untitled production"}” and its media from this browser? Rendered avatar clips in it are deleted too, so re-creating them would need new renders. This can't be undone.</p>,
    onConfirm: () => {
      const old = openStoredProject(pr.id);
      if (old) {
        [old.base, old.music, old.cleanedAudio, ...old.broll].forEach(m => m && void deleteMedia(m.mediaId));
        Object.values(old.avatar.photos).forEach(ph => void deleteMedia(ph.mediaId));
      }
      deleteStoredProject(pr.id);
      setProjects(listProjects());
    }
  });

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
  // Generation history for this project (kept in this browser)
  const [history, setHistory] = useState<GenerationRecord[]>(() => loadHistory(project.id));
  useEffect(() => setHistory(loadHistory(project.id)), [project.id]);
  const record = (r: Omit<GenerationRecord, "id" | "projectId">) => setHistory(h => {
    const next = [...h, { ...r, id: newMediaId("g"), projectId: projectRef.current.id }];
    saveHistory(projectRef.current.id, next);
    return next;
  });

  const historyError = (text: string, d?: { http?: number; code?: string; jobId?: string; requestId?: string } | null) =>
    [d?.http ? `HTTP ${d.http}` : "", d?.code ?? "", text, d?.jobId ?? d?.requestId ?? ""].filter(Boolean).join(" · ").slice(0, 300);
  const voiceName = () => project.voice.engine === "heygen" ? project.voice.heygenVoice?.name || "Avatar's own voice" : project.voice.preset;
  const avatarLabel = () => project.voice.engine === "heygen" ? project.avatar.heygen?.name ?? "—" : "Presenter photo";
  const providerFor = (id: string) => (id === "auto" ? providers[0] : providers.find(x => x.id === id));
  const isPaid = (id: string) => project.voice.engine === "heygen" && (providerFor(id)?.capabilities.paid ?? true);

  /** Render exactly these lines (clip keys) — only ever called after the user confirmed */
  const startRender = async (keys: string[], providerId?: string) => {
    const state = stateRef.current;
    const jobs: ClipJob[] = pendingClipJobs(parse, project.avatar, project.voice, state.clips, project.targets, false, new Set(keys));
    if (!jobs.length) return;
    const hadClip = new Set(jobs.filter(j => state.clips[j.key]?.status === "done").map(j => j.key));
    const opts = { ...project.avatarRender, provider: providerId ?? project.avatarRender.provider };
    const snapshot = { avatar: avatarLabel(), voice: voiceName(), quality: opts.quality };
    setGenerating(g => ({ done: g?.done ?? 0, total: (g?.total ?? 0) + jobs.length }));
    try {
      const result = await runClipJobs(jobs, project.avatar, project.voice, opts, (k, clip) => {
        // a line that already has a clip keeps playing it until the new one is done
        if (clip.status !== "done" && stateRef.current.clips[k]?.status === "done") return setRerenders(r => ({ ...r, [k]: clip }));
        setRerenders(r => {
          if (!(k in r)) return r;
          const { [k]: _, ...rest } = r;
          return rest;
        });
        setClips(c => ({ ...c, [k]: clip }));
      }, controllers.current, (job, clip) => {
        setGenerating(g => g && { ...g, done: g.done + 1 });
        const completed = clip.status === "done";
        const version = nextVersion(loadHistory(projectRef.current.id), job.key);
        if (completed) setClips(c => ({ ...c, [job.key]: { ...clip, version } }));
        record({
          // numbered like the queue: Nth voiceover line
          sceneIndex: parse.scenes.filter(x => x.spoken).findIndex(x => x.index === job.scene.index), clipKey: job.key, text: job.text.slice(0, 120),
          provider: clip.provider ?? opts.provider, ...snapshot, at: Date.now(),
          duration: completed ? clip.duration ?? null : null,
          status: completed ? "completed" : clip.status === "error" ? "failed" : "cancelled",
          version: completed ? version : 0, regeneration: hadClip.has(job.key), test: false,
          error: clip.error ? historyError(clip.error, clip.errorDetail) : undefined
        });
      });
      if (result.failed) fail(`${result.failed} avatar scene${result.failed > 1 ? "s" : ""} didn't render. See Avatar generation on the Avatar page. Nothing is retried without your OK.`);
    } catch (err) {
      fail(err instanceof Error && err.message.length < 200 ? err.message : "Avatar generation failed. Try again.");
    } finally {
      setGenerating(g => (g && g.done >= g.total ? null : g));
    }
  };

  const cancelOne = (key: string) => {
    const c = controllers.current.get(key);
    if (c) c.abort();
    const jobId = (rerenders[key] ?? clips[key])?.jobId;
    if (jobId && !c) void cancelRender(jobId);
  };
  const cancelAll = () => controllers.current.forEach(c => c.abort());

  /** Single-line render from a queue button — always confirmed first */
  const confirmLine = (s: AvatarScene, kind: "retry" | "regenerate" | "provider", provider?: ProviderInfo) => {
    if (!s.key) return;
    const key = s.key;
    const pid = provider?.id ?? project.avatarRender.provider;
    const paid = project.voice.engine === "heygen" && (provider?.capabilities.paid ?? isPaid(pid));
    const credits = paid ? " may consume additional provider credits." : " doesn't use credits (free/mock renderer).";
    if (kind === "regenerate") {
      return setConfirmReq({
        title: "Regenerate scene?", confirmLabel: "Regenerate", onConfirm: () => void startRender([key], provider?.id),
        body: <p>This scene has already been generated. Regenerating{credits}</p>
      });
    }
    if (kind === "provider" && provider) {
      return setConfirmReq({
        title: `Try ${provider.label}?`, confirmLabel: `Try ${provider.label}`, onConfirm: () => void startRender([key], provider.id),
        body: <p>Generation failed with {providerLabel(providers, s.provider)}. Try {provider.label} for this scene?{provider.capabilities.paid ? " This may use that provider's credits." : ""}</p>
      });
    }
    setConfirmReq({
      title: "Render this scene?", confirmLabel: "Render", onConfirm: () => void startRender([key]),
      body: <p>Render scene “{s.voiceoverText.slice(0, 80)}{s.voiceoverText.length > 80 ? "…" : ""}” again? Rendering{credits}</p>
    });
  };

  const runTest = () => {
    const look = project.avatar.heygen;
    if (!look) return;
    const text = testText.trim();
    const pid = project.avatarRender.provider;
    const go = async () => {
      const ctrl = new AbortController();
      testAbort.current = ctrl;
      setTestState({ status: "rendering", progress: 0 });
      const snapshot = { avatar: look.name, voice: voiceName(), quality: "preview" };
      try {
        const r = await renderTest(look, project.voice, text, project.avatarRender, u => setTestState(t => ({ ...t, progress: u.progress })), ctrl.signal);
        setTestState(prev => {
          if (prev.result) URL.revokeObjectURL(prev.result.url);
          return { status: "done", result: { url: r.url, duration: r.duration, provider: r.provider, alpha: r.alpha, ...snapshot } };
        });
        record({ sceneIndex: null, clipKey: null, text: text.slice(0, 120), provider: r.provider, ...snapshot, at: Date.now(), duration: r.duration, status: "completed", version: 0, regeneration: false, test: true });
      } catch (err) {
        const cancelled = err instanceof RenderCancelled;
        const api = err instanceof ApiError ? err : null;
        setTestState({ status: cancelled ? "idle" : "error", error: api ? api.message : "The test render failed. Try again.", detail: api?.detail });
        record({ sceneIndex: null, clipKey: null, text: text.slice(0, 120), provider: api?.detail?.provider ?? pid, ...snapshot, at: Date.now(), duration: null, status: cancelled ? "cancelled" : "failed", version: 0, regeneration: false, test: true, error: api ? historyError(api.message, api.detail) : undefined });
      }
    };
    setConfirmReq({
      title: "Generate a 10-second test?", confirmLabel: "Generate test", onConfirm: () => void go(),
      body: <p>This renders one short TEST RENDER with {look.name} at preview quality. It won't be placed on the timeline.{isPaid(pid) ? " It uses a small amount of provider credits." : ""}</p>
    });
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

  const onScriptAction = async (action: string, instruction = "") => {
    setAssistBusy(true);
    try {
      const res = await api<{ script: string; summary: string; truncated?: boolean }>("/api/script", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, instruction, script: project.script, presenter: project.avatarName, duration_seconds: main })
      });
      setUndoScript(project.script);
      setScript(res.script);
      setForceParse(n => n + 1);
      setNotice({ text: res.summary + (res.truncated ? " The output may be incomplete." : ""), tone: "info" });
    } catch (err) { fail(err instanceof Error ? err.message : "The Script Assistant failed. Try again."); }
    finally { setAssistBusy(false); }
  };

  const generatePlan = async (settings: CreatorSettings) => {
    setCreatorSettings(settings);
    setPlanBusy(true);
    try {
      const result = await api<{ plan: ProductionPlan; truncated?: boolean }>("/api/plan", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: settings.prompt, duration_seconds: settings.duration, format: settings.format,
          style: settings.style, presenter: settings.presenter, avatar_usage: settings.usage,
          voice: settings.voice === "default" ? project.voice.heygenVoice?.name ?? project.voice.preset : ({ "pro-male":"Professional male (Victor)", "pro-female":"Professional female (ARIA)", "casual-male":"Casual male", "casual-female":"Casual female" }[settings.voice] ?? settings.voice), has_video: !!project.base })
      });
      setProductionPlan(result.plan);
      goPage("plan-review");
      if (result.truncated) setNotice({ text: "The plan response was cut short. Review scene coverage before continuing.", tone: "info" });
    } catch (err) { fail(err instanceof Error ? err.message : "Couldn't generate a production plan."); }
    finally { setPlanBusy(false); }
  };

  const continuePlan = () => {
    if (!productionPlan) return;
    const base = blankProject("ai", productionPlan.title || "AI production");
    const next = planToProject(productionPlan, creatorSettings, base);
    next.avatar = { ...project.avatar, ...next.avatar, enabled: !!creatorSettings.presenter };
    if (creatorSettings.voice === "default") next.voice = { ...project.voice };
    switchProject(next, "editor");
    setProductionPlan(null);
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
    goPage("effects", "effects-preview");
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
    goPage("effects", "effects-preview");
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

  const runCommand = async (prompt: string) => {
    setAiMessages(m => [...m, { role: "user", text: prompt }]);
    setAiBusy(true);
    try {
      const before = projectRef.current;
      const context = buildContext(before, parse, page, playheadMain(), main);
      const edits = await api<CommandEdits>("/api/command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, context })
      });
      const { project: next, effects: fx, changed } = applyEdits(before, edits);
      // Effects at specific times go in as timestamped lines
      let placeLater = 0;
      for (const f of [...fx].sort((a, b) => b.at_seconds - a.at_seconds)) {
        if (!f.text?.trim() || !Number.isFinite(f.at_seconds)) continue;
        const scenes = parseScript(next.script, next.avatarName || "Presenter", mainDuration(next)).scenes;
        next.script = insertDirection(next.script, scenes, Math.max(0, f.at_seconds), `${f.keyword}: ${f.text.trim()}`);
        if (["ZOOM", "HIGHLIGHT", "PULSE", "POINTS TO", "CALLOUT"].includes(f.keyword)) placeLater++;
      }
      if (changed.length || fx.length) {
        setAiUndo(before);
        setProject(next);
        setForceParse(n => n + 1);
      }
      if (edits.translate_captions_to) await onTranslate(edits.translate_captions_to);
      if (edits.go_to_page) goPage(edits.go_to_page);
      const extra = placeLater ? ` ${placeLater === 1 ? "It lands" : "They land"} in the center until you place ${placeLater === 1 ? "it" : "them"} on the Effects page.` : "";
      setAiMessages(m => [...m, { role: "assistant", text: `${edits.reply}${extra}` }]);
    } catch (err) {
      setAiMessages(m => [...m, { role: "error", text: err instanceof Error ? err.message : "Something went wrong. Try again." }]);
    } finally {
      setAiBusy(false);
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
  const avatarScenes = buildAvatarScenes(parse, project, clips, main);
  // the queue shows a re-render's progress; the timeline keeps playing the old clip until it's replaced
  const queueScenes = Object.keys(rerenders).length ? buildAvatarScenes(parse, project, { ...clips, ...rerenders }, main) : avatarScenes;
  const openRender = (keys: string[] | null = null) => setRenderPanel({ keys });
  const staleCount = staleGestureCount(parse, project.avatar, project.voice, clips, project.targets);
  const clipsReady = spokenScenes.filter(s => {
    const k = sceneClipKey(project.avatar, project.voice, s.spoken);
    return k && clips[k]?.status === "done";
  }).length;
  const fileBase = (project.name || "directorai").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "directorai";
  const languages = Object.keys(project.translations);

  const hasAvatar = project.voice.engine === "heygen" ? !!project.avatar.heygen : !!photo;
  const canGenerate = hasAvatar && spokenScenes.length > 0;
  const staleKeys = () => pendingClipJobs(parse, project.avatar, project.voice, clips, project.targets, true)
    .filter(j => clips[j.key]?.status === "done").map(j => j.key);
  const current = PAGES.find(pg => pg.id === page);

  const preview = (
    <VideoPreview player={player} media={media} getState={getState} effects={effects}
      hasBase={!!project.base} onPickBase={() => goPage("editor", "video")}
      showTargets={showTargets} selectedId={selectedId} placement={placement} />
  );
  const timeline = (
    <Timeline player={player} timing={timing} parse={parse} effects={effects} project={project}
      clips={clips} chapters={chapters} selectedId={selectedId} onSelect={selectDirection} />
  );

  return (
    <div className="min-h-full">
      <Header page={page} onPage={p => goPage(p)} onNew={() => goPage("start")} name={project.name} setName={name => patch(() => ({ name }))}
        savedAt={savedAt} onSave={save} onSettings={() => setSettingsOpen(true)} apiOnline={apiOnline} />

      <div className="flex">
        <ToolSidebar player={player} onAi={() => setAiOpen(true)}
          onParse={() => {
            setForceParse(n => n + 1);
            goPage("editor", "script");
          }}
          onFind={() => {
            setFinding(true);
            goPage("editor", "script");
          }}
          onPlaceEffect={() => goPage("effects", "effects-add")}
          onGenerate={() => {
            goPage("avatar");
            openRender();
          }}
          canGenerate={canGenerate}
          onTeleprompter={() => setPrompter(true)}
          onExport={() => goPage("export")}
          onSettings={() => setSettingsOpen(true)} />

        <main className="mx-auto w-full min-w-0 max-w-[1400px] px-4 pb-28 pt-6 sm:px-6 lg:pb-12">
          {notice && (
            <div className="sticky top-[80px] z-20 mb-4">
              <div className={`flex items-start gap-2 rounded-xl border px-4 py-3 text-sm shadow-lg ${notice.tone === "error" ? "border-red-400/40 bg-[#3a1d2a] text-red-100" : "border-gold/40 bg-navy-600 text-gold"}`} role={notice.tone === "error" ? "alert" : "status"}>
                <AlertCircle size={16} className="mt-0.5 shrink-0" />
                <span className="flex-1">{notice.text}</span>
                <button onClick={() => setNotice(null)} aria-label="Dismiss" className="min-h-6"><X size={16} /></button>
              </div>
            </div>
          )}

          <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
            {current && <PageHeader icon={current.icon} title={current.label} subtitle={current.blurb} actions={page === "editor" && avatarScenes.length > 0 ? (
              <button className="btn btn-gold" onClick={() => openRender()} disabled={!canGenerate}
                title={hasAvatar ? `${avatarScenes.length} avatar scene${avatarScenes.length > 1 ? "s" : ""} parsed` : "Pick an avatar on the Avatar page first"}>
                <Sparkles size={16} /> Render avatar
              </button>
            ) : undefined} />}

            {page === "start" && (
              <StartScreen projects={projects} currentId={projects.some(x => x.id === project.id) ? project.id : null} busy={busy}
                onCreateWithAi={() => goPage("create")}
                onUpload={f => void onNewUpload(f)}
                onBlank={() => switchProject(blankProject("script", "Untitled production"), "editor")}
                onOpen={id => {
                  if (id === project.id) return goPage("editor");
                  const next = openStoredProject(id);
                  if (next) switchProject(next, "editor");
                  else fail("That project couldn't be opened.");
                }}
                onDelete={deleteProject} />
            )}

            {page === "create" && <Creator initial={creatorSettings} project={project} busy={planBusy}
              onBack={() => goPage("start")} onGenerate={s => void generatePlan(s)} />}
            {page === "plan-review" && productionPlan && <PlanReview plan={productionPlan} setPlan={setProductionPlan}
              presenter={creatorSettings.presenter} busy={planBusy} onBack={() => goPage("create")}
              onRegenerate={() => void generatePlan(creatorSettings)} onContinue={continuePlan} />}

            {page === "editor" && (
              <>
                <ScriptSection
                  script={project.script}
                  setScript={setScript}
                  parse={parse}
                  onParse={() => setForceParse(n => n + 1)}
                  duration={main}
                  intro={timing.intro}
                  onAssist={onAssist}
                  onScriptAction={onScriptAction}
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
                  finding={finding}
                  setFinding={setFinding}
                />
                <VideoSection player={player} media={media} getState={getState} effects={effects} project={project} setVideo={setVideo}
                  setDuration={d => patch(() => ({ durationInput: d }))} parse={parse} clips={clips} chapters={chapters}
                  selectedId={selectedId} onSelect={selectDirection} placement={placement} showTargets={showTargets} setShowTargets={setShowTargets}
                  onBaseFile={f => void onBaseFile(f)}
                  onRemoveBase={() => {
                    if (project.base) void deleteMedia(project.base.mediaId);
                    if (project.cleanedAudio) void deleteMedia(project.cleanedAudio.mediaId);
                    patch(p => ({ base: null, cleanedAudio: null, video: { ...p.video, trimIn: 0, trimOut: null, cleanBaseAudio: false } }));
                  }}
                  busy={busy} />
              </>
            )}

            {page === "effects" && (
              <EffectsBranding project={project} effects={effects} intro={timing.intro} playhead={playheadMain} selectedId={selectedId}
                onSelect={selectDirection} onAdd={addEffect} onPlace={place}
                onResetTarget={d => patch(p => {
                  const next = { ...p.targets };
                  delete next[targetKey(d)];
                  return { targets: next };
                })}
                onColor={(d, color) => patch(p => ({ effectStyles: { ...p.effectStyles, [targetKey(d)]: { ...p.effectStyles[targetKey(d)], color: color ?? undefined } } }))}
                setBranding={setBranding} languages={languages} stage={preview} timeline={timeline} />
            )}

            {page === "advanced" && (
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
            )}

            {page === "audio" && (
              <AudioPage project={project} setVideo={setVideo} setVoice={setVoice} server={server} player={player}
                onMusicFile={f => void onMusicFile(f)}
                onRemoveMusic={() => {
                  if (project.music) void deleteMedia(project.music.mediaId);
                  patch(() => ({ music: null }));
                }}
                onCleanBase={() => clean("base")} onCleanMusic={() => clean("music")} cleaning={cleaning} />
            )}

            {page === "avatar" && (
              <AvatarStudio avatar={project.avatar} voice={project.voice} setAvatar={setAvatar} setVoice={setVoice} onPhoto={onPhoto}
                server={server} parse={parse} clips={clips} onGenerate={() => openRender()} generating={generating}
                staleCount={staleCount} onRegenerateStale={() => openRender(staleKeys())}
                onCancel={cancelAll}
                queue={
                  <RenderQueue scenes={queueScenes} providers={providers} canRender={canGenerate}
                    onOpenPanel={() => openRender()} onCancel={cancelOne} onCancelAll={cancelAll}
                    onRetry={s => confirmLine(s, "retry")} onRegenerate={s => confirmLine(s, "regenerate")}
                    onTryProvider={(s, pr) => confirmLine(s, "provider", pr)}
                    onPreview={s => s.clip?.url && setPreviewClip({ url: s.clip.url, title: `Scene ${avatarScenes.indexOf(s) + 1} · ${s.avatarName}`, audio: s.clip.kind === "audio" })}
                    onEditScript={() => goPage("editor", "script")}
                    onChangeAvatar={() => document.getElementById("avatar-gallery")?.scrollIntoView({ behavior: "smooth" })}
                    onFasterVoice={project.voice.speed !== "fast" ? () => {
                      setVoice({ speed: project.voice.speed === "slow" ? "normal" : "fast" });
                      setNotice({ text: "Voice speed raised. Rendered lines now play faster, which may raise the pitch slightly.", tone: "info" });
                    } : null} />
                }
                extras={project.voice.engine === "heygen" ? (
                  <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-2">
                    <TestRenderCard text={testText} setText={setTestText} state={testState}
                      disabledReason={!project.avatar.heygen ? "Pick an avatar first." : providers.length === 0 ? "No avatar renderer is set up on the server." : null}
                      providerName={providerLabel(providers, project.avatarRender.provider === "auto" ? providers[0]?.id : project.avatarRender.provider)}
                      onGenerate={runTest} onCancel={() => testAbort.current?.abort()} />
                    <GenerationHistory records={history} providers={providers} />
                  </div>
                ) : <GenerationHistory records={history} providers={providers} />}
                onAccessCodeSaved={() => {
                  refreshServer();
                  setNotice({ text: "Access code saved.", tone: "info" });
                }} />
            )}

            {page === "export" && (
              spokenScenes.length === 0 && parse.scenes.length === 0 ? (
                <EmptyState icon={<Clapperboard size={20} />} title="Nothing to export yet"
                  action={<button className="btn btn-gold" onClick={() => goPage("editor")}>Write a script</button>}>
                  Write a script on the Editor page first.
                </EmptyState>
              ) : (
                <ExportSection getState={getState} sources={exportSources} clipsReady={clipsReady} clipsNeeded={spokenScenes.length}
                  canGenerate={hasAvatar} onRenderAvatar={() => openRender()} pausePreview={() => player.pause()} fileBase={fileBase} />
              )
            )}

            <footer className="py-4 text-center text-xs text-white/35">
              DirectorAI™ | HCCGSA LLC · <a className="hover:text-gold" href="https://directorai.hccgsa.com/legal">Privacy</a>
            </footer>
          </div>
        </main>
      </div>

      <MobileTabs page={page} onPage={p => goPage(p)} />
      <button onClick={() => setAiOpen(true)} aria-label="Ask AI"
        className="fixed bottom-20 right-4 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-gold text-navy shadow-xl lg:hidden">
        <Sparkles size={22} />
      </button>

      <AiPrompter open={aiOpen} onClose={() => setAiOpen(false)} onSubmit={runCommand} messages={aiMessages} busy={aiBusy}
        canUndo={!!aiUndo} onUndo={() => {
          if (!aiUndo) return;
          setProject(aiUndo);
          setAiUndo(null);
          setForceParse(n => n + 1);
          setAiMessages(m => [...m, { role: "assistant", text: "Undone — the project is back to how it was before that change." }]);
        }} />
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} server={server} onAccessCodeSaved={() => {
        refreshServer();
        setNotice({ text: "Access code saved.", tone: "info" });
      }} onReset={resetProject} />
      <RenderAvatarPanel open={!!renderPanel} onClose={() => setRenderPanel(null)} scenes={queueScenes} preselect={renderPanel?.keys ?? null}
        rendered={project.voice.engine === "heygen"} avatarName={project.voice.engine === "heygen" ? project.avatar.heygen?.name ?? null : "Presenter photo"}
        avatarImage={project.voice.engine === "heygen" ? project.avatar.heygen?.image ?? null : photo?.thumbnail ?? null}
        voiceName={voiceName()} providers={providers} settings={project.avatarRender} setSettings={setAvatarRender}
        rate={SPEED_RATE[project.voice.speed]}
        onChangeAvatar={() => {
          setRenderPanel(null);
          goPage("avatar", "avatar-gallery");
        }}
        onChangeVoice={() => {
          setRenderPanel(null);
          goPage("audio");
        }}
        onConfirm={keys => void startRender(keys)} />
      <ConfirmDialog request={confirmReq} onClose={() => setConfirmReq(null)} />
      <ClipPreview clip={previewClip} onClose={() => setPreviewClip(null)} />
      {prompter && <Teleprompter lines={spokenScenes.map(s => s.spoken)} onClose={() => setPrompter(false)} />}
    </div>
  );
}
