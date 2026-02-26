import { describe, it, expect, vi } from "vitest";
import { CancellationToken, CancelledError } from "../cancellation-token.js";

describe("CancellationToken", () => {
  it("should not be cancelled initially", () => {
    const token = new CancellationToken();
    expect(token.isCancelled()).toBe(false);
  });

  it("should be cancellable", () => {
    const token = new CancellationToken();
    token.cancel();
    expect(token.isCancelled()).toBe(true);
  });

  it("should call callbacks on cancel", () => {
    const token = new CancellationToken();
    const cb = vi.fn();
    token.addCallback(cb);
    token.cancel();
    expect(cb).toHaveBeenCalledOnce();
  });

  it("should call callback immediately if already cancelled", () => {
    const token = new CancellationToken();
    token.cancel();
    const cb = vi.fn();
    token.addCallback(cb);
    expect(cb).toHaveBeenCalledOnce();
  });

  it("should not crash if callback throws", () => {
    const token = new CancellationToken();
    token.addCallback(() => {
      throw new Error("boom");
    });
    expect(() => token.cancel()).not.toThrow();
    expect(token.isCancelled()).toBe(true);
  });

  it("should link an AbortController", () => {
    const token = new CancellationToken();
    const controller = new AbortController();
    token.linkAbortController(controller);
    expect(controller.signal.aborted).toBe(false);
    token.cancel();
    expect(controller.signal.aborted).toBe(true);
  });

  it("should abort controller immediately if already cancelled", () => {
    const token = new CancellationToken();
    token.cancel();
    const controller = new AbortController();
    token.linkAbortController(controller);
    expect(controller.signal.aborted).toBe(true);
  });

  it("should create a cancellation promise that rejects", async () => {
    const token = new CancellationToken();
    const promise = token.createCancellationPromise();

    // Cancel after a short delay
    setTimeout(() => token.cancel(), 10);

    await expect(promise).rejects.toThrow(CancelledError);
  });

  it("should reject immediately if already cancelled", async () => {
    const token = new CancellationToken();
    token.cancel();
    const promise = token.createCancellationPromise();
    await expect(promise).rejects.toThrow(CancelledError);
  });
});
