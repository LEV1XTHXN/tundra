// @vitest-environment jsdom
/**
 * Regression test for the WebKitGTK media crash.
 *
 * On Linux, a `<video>`/`<audio>` element that starts loading makes WebKit build
 * a GStreamer player, and `MediaPlayerPrivateGStreamer::createAudioSink()` ends
 * in `RELEASE_ASSERT(audioSink)`. With no usable audio sink that aborts the
 * whole web process — uncatchable from JS, and triggered merely by opening a
 * note. So the invariant guarded here is blunt: **rendering a note must not put
 * a media element in the document.** One may only appear after a user click.
 *
 * See `src/editor/mediaBlockSpecs.tsx` and `docs/attachments-linux-media.md`.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { BlockNoteView } from "@blocknote/shadcn";
import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteSchema, defaultBlockSpecs } from "@blocknote/core";

import { editorSchema } from "./schema";

// vitest runs without `globals`, so cleanup has to be registered by hand.
afterEach(cleanup);

const VIDEO = [{ type: "video", props: { url: "attachments/videos/ab/clip.mp4", name: "clip.mp4" } }];
const AUDIO = [{ type: "audio", props: { url: "attachments/files/cd/song.mp3", name: "song.mp3" } }];

/**
 * One media block per editor on purpose: BlockNote renders each React block as
 * its own node view, and in jsdom only the first flushes synchronously. The
 * element counts below would be misleading with two blocks in one document.
 */
function Editor({ content, schema = editorSchema }: { content: unknown[]; schema?: typeof editorSchema }) {
  const editor = useCreateBlockNote({ schema, initialContent: content as never });
  return <BlockNoteView editor={editor} />;
}

/** BlockNote's untouched schema — the "before" state, to prove the test bites. */
const stockSchema = BlockNoteSchema.create({ blockSpecs: { ...defaultBlockSpecs } }) as typeof editorSchema;

describe("video/audio blocks are click-to-play", () => {
  it("renders a video block with no <video> element", () => {
    const { container } = render(<Editor content={VIDEO} />);

    expect(container.querySelector("video")).toBeNull();
    expect(container.querySelectorAll(".media-facade")).toHaveLength(1);
    expect(container.querySelector(".media-facade-name")?.textContent).toBe("clip.mp4");
  });

  it("renders an audio block with no <audio> element", () => {
    const { container } = render(<Editor content={AUDIO} />);

    expect(container.querySelector("audio")).toBeNull();
    expect(container.querySelectorAll(".media-facade")).toHaveLength(1);
    expect(container.querySelector(".media-facade-name")?.textContent).toBe("song.mp3");
  });

  it("mounts the real media element once the facade is clicked", () => {
    const { container } = render(<Editor content={VIDEO} />);

    fireEvent.click(container.querySelector(".media-facade")!);

    expect(container.querySelector("video")).not.toBeNull();
    expect(container.querySelector(".media-facade")).toBeNull();
  });

  /**
   * Guards the guard: if this ever stops finding a media element, BlockNote
   * changed how it renders media and the assertions above would pass vacuously.
   */
  it("control: BlockNote's stock schema does render a live media element", () => {
    const { container } = render(<Editor content={AUDIO} schema={stockSchema} />);

    expect(container.querySelector("audio")).not.toBeNull();
  });
});
