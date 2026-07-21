import { describe, expect, it } from "vitest";
import { attachmentKindFromMime } from "./attachmentKind";

describe("attachmentKindFromMime", () => {
  it("maps image/* to the image library", () => {
    expect(attachmentKindFromMime("image/png")).toBe("image");
    expect(attachmentKindFromMime("image/jpeg")).toBe("image");
    expect(attachmentKindFromMime("image/svg+xml")).toBe("image");
  });

  it("maps video/* to the video library", () => {
    expect(attachmentKindFromMime("video/mp4")).toBe("video");
    expect(attachmentKindFromMime("video/webm")).toBe("video");
  });

  it("falls back to the file library for anything else", () => {
    expect(attachmentKindFromMime("application/pdf")).toBe("file");
    expect(attachmentKindFromMime("text/plain")).toBe("file");
    expect(attachmentKindFromMime("")).toBe("file");
  });
});
