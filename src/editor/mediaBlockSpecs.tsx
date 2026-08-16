/**
 * Click-to-play replacements for BlockNote's built-in `video` and `audio`
 * blocks.
 *
 * WHY THIS EXISTS — this is a crash fix, not a UX preference.
 *
 * On Linux the webview is WebKitGTK, which delegates `<video>`/`<audio>` to
 * GStreamer. When a media element starts loading a resource, WebKit builds a
 * `MediaPlayerPrivateGStreamer`, and its constructor calls `createAudioSink()`,
 * which ends in
 *
 *     RELEASE_ASSERT(audioSink)   // MediaPlayerPrivateGStreamer.cpp:1592
 *
 * If GStreamer cannot produce an audio sink — no `autoaudiosink`, no
 * `pulsesink`, a broken or absent audio stack, an AppImage whose GStreamer
 * plugins didn't get bundled — WebKit aborts the ENTIRE web process (SIGABRT).
 * That is a process-level abort, not a JS exception: nothing in React or
 * BlockNote can catch it, and the whole window dies. A note containing one
 * video or audio block was enough to make opening it a guaranteed crash.
 *
 * `preload="none"` does NOT avoid this — the player is constructed during
 * `MediaPlayer::load()`, before any buffering decision. The only reliable
 * defence is to never put a media element with a `src` in the document until
 * the user explicitly asks for playback. So an uploaded video/audio renders as
 * a static facade (name + play button); the real element, and the URL
 * resolution that feeds it, only appear on click.
 *
 * Bonus: `resolveFileUrl` is what fetches the whole attachment into memory as a
 * blob on Linux (see `attachments.resolveUrl` in `src/services`). Not calling it
 * until playback means opening a media-heavy note no longer loads every video
 * and audio file into the web process up front.
 *
 * Everything else — block props, parsing, Markdown/HTML export, the caption and
 * resize UI — is BlockNote's own; only the rendered preview is swapped, so note
 * JSON is completely unchanged.
 */
import { useCallback, useState, type FC, type ReactNode } from "react";
import { Play } from "lucide-react";
import { useTranslation } from "react-i18next";
import { createAudioBlockConfig, createVideoBlockConfig, audioParse, videoParse } from "@blocknote/core";
import {
  AudioPreview,
  AudioToExternalHTML,
  createReactBlockSpec,
  FileBlockWrapper,
  ResizableFileBlockWrapper,
  VideoPreview,
  VideoToExternalHTML,
  type ReactCustomBlockRenderProps,
} from "@blocknote/react";

/**
 * The static stand-in shown before playback. Deliberately dumb: no media
 * element, no URL resolution, no network/IPC. `contentEditable={false}` keeps
 * ProseMirror from treating it as editable content, matching what BlockNote's
 * own previews do.
 */
function MediaFacade({
  name,
  width,
  onPlay,
  label,
}: {
  name: string;
  width?: number;
  onPlay: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      className="media-facade"
      style={width ? { width } : undefined}
      onClick={onPlay}
      contentEditable={false}
      draggable={false}
      title={label}
      aria-label={`${label}: ${name}`}
    >
      <span className="media-facade-icon" aria-hidden="true">
        <Play size={18} />
      </span>
      <span className="media-facade-text">
        <span className="media-facade-name">{name}</span>
        <span className="media-facade-hint">{label}</span>
      </span>
    </button>
  );
}

/**
 * Renders the facade until the user clicks, then hands off to BlockNote's own
 * preview component (which is what calls `resolveFileUrl` and mounts the real
 * `<video>`/`<audio>`). "Playing" is LOCAL React state on purpose — writing it
 * into block props would rewrite every note's JSON just from opening it.
 */
function useMediaFacade(url: string) {
  const [playing, setPlaying] = useState(false);
  const play = useCallback(() => setPlaying(true), []);
  // A different attachment in the same block position means a different file —
  // fall back to the facade rather than autoplaying whatever replaced it.
  const [seenUrl, setSeenUrl] = useState(url);
  if (seenUrl !== url) {
    setSeenUrl(url);
    setPlaying(false);
  }
  return { playing, play };
}

function LazyVideoPreview(props: Omit<ReactCustomBlockRenderProps<typeof createVideoBlockConfig>, "contentRef">) {
  const { t } = useTranslation();
  const { playing, play } = useMediaFacade(props.block.props.url);
  if (playing) return <VideoPreview {...props} />;
  return (
    <MediaFacade
      name={props.block.props.name || props.block.props.url}
      width={props.block.props.previewWidth || undefined}
      onPlay={play}
      label={t("editor.playVideo")}
    />
  );
}

function LazyAudioPreview(props: Omit<ReactCustomBlockRenderProps<typeof createAudioBlockConfig>, "contentRef">) {
  const { t } = useTranslation();
  const { playing, play } = useMediaFacade(props.block.props.url);
  if (playing) return <AudioPreview {...props} />;
  return (
    <MediaFacade
      name={props.block.props.name || props.block.props.url}
      onPlay={play}
      label={t("editor.playAudio")}
    />
  );
}

/**
 * BlockNote's two file-block wrappers are *typed* against the `file` block
 * config, but it uses them for `image`/`video`/`audio` as well — its own
 * `VideoBlock` and `AudioBlock` pass exactly these props. The runtime contract
 * is only "a block with url/caption/showPreview props", which video and audio
 * satisfy, so re-typing them for our two block configs is sound and keeps the
 * cast in one documented place instead of at every call site.
 */
type MediaWrapperProps = { buttonIcon?: ReactNode; children?: ReactNode };

const VideoWrapper = ResizableFileBlockWrapper as unknown as FC<
  Omit<ReactCustomBlockRenderProps<typeof createVideoBlockConfig>, "contentRef"> & MediaWrapperProps
>;
const AudioWrapper = FileBlockWrapper as unknown as FC<
  Omit<ReactCustomBlockRenderProps<typeof createAudioBlockConfig>, "contentRef"> & MediaWrapperProps
>;

/**
 * The specs themselves mirror BlockNote's `ReactVideoBlock`/`ReactAudioBlock`
 * exactly — same config, same `parse`, same `toExternalHTML`, same wrappers and
 * `runsBefore` ordering — so only the in-editor preview differs. `previewWidth`
 * makes video the resizable wrapper and audio the plain one, as upstream.
 */
export const lazyVideoBlockSpec = createReactBlockSpec(createVideoBlockConfig, (options) => ({
  meta: { fileBlockAccept: ["video/*"] },
  render: (props) => (
    <VideoWrapper {...props} buttonIcon={<Play size={24} />}>
      <LazyVideoPreview {...props} />
    </VideoWrapper>
  ),
  parse: videoParse(options),
  toExternalHTML: VideoToExternalHTML,
  runsBefore: ["file"],
}))();

export const lazyAudioBlockSpec = createReactBlockSpec(createAudioBlockConfig, (options) => ({
  meta: { fileBlockAccept: ["audio/*"] },
  render: (props) => (
    <AudioWrapper {...props} buttonIcon={<Play size={24} />}>
      <LazyAudioPreview {...props} />
    </AudioWrapper>
  ),
  parse: audioParse(options),
  toExternalHTML: AudioToExternalHTML,
  runsBefore: ["file"],
}))();

/**
 * Drop-in overrides for `defaultBlockSpecs.video` / `.audio`. Spread AFTER the
 * defaults in every schema that has media blocks — currently the note editor
 * (`schema.ts`) and the quick-note scratchpad (`quickNoteSchema.ts`).
 */
export const lazyMediaBlockSpecs = {
  video: lazyVideoBlockSpec,
  audio: lazyAudioBlockSpec,
};
