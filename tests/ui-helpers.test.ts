/**
 * Tests for UI helpers.
 */

import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { selectWrapped } from "../src/ui-helpers.js";

describe("selectWrapped", () => {
  it("should return first option when UI is unavailable", async () => {
    const ctx = {
      hasUI: false,
      ui: {
        select: vi.fn(),
      },
    } as unknown as ExtensionContext;

    const result = await selectWrapped(ctx, "Title", ["one", "two"]);

    expect(result).toBe("one");
  });

  it("should fall back to ctx.ui.select by default", async () => {
    const select = vi.fn().mockResolvedValue("two");
    const ctx = {
      hasUI: true,
      ui: {
        select,
      },
    } as unknown as ExtensionContext;

    const result = await selectWrapped(ctx, "Title", ["one", "two"]);

    expect(result).toBe("two");
    expect(select).toHaveBeenCalledWith("Title", ["one", "two"]);
  });

  it("should fall back to ctx.ui.select when custom is forced but unavailable", async () => {
    const select = vi.fn().mockResolvedValue("one");
    const ctx = {
      hasUI: true,
      ui: {
        select,
      },
    } as unknown as ExtensionContext;

    const result = await selectWrapped(ctx, "Title", ["one", "two"], {
      forceCustom: true,
    });

    expect(result).toBe("one");
    expect(select).toHaveBeenCalledWith("Title", ["one", "two"]);
  });

  it("should use custom UI when forced", async () => {
    const custom = vi.fn(async (factory) => {
      let resolved: string | undefined;
      const done = (value: string | undefined) => {
        resolved = value;
      };
      await factory(
        { requestRender: vi.fn() } as any,
        {
          fg: (_color: string, value: string) => value,
          bold: (v: string) => v,
        } as any,
        {} as any,
        done,
      );
      done("choice");
      return resolved;
    });

    const ctx = {
      hasUI: true,
      ui: {
        select: vi.fn(),
        custom,
      },
    } as unknown as ExtensionContext;

    const result = await selectWrapped(ctx, "Title", ["choice", "other"], {
      forceCustom: true,
    });

    expect(result).toBe("choice");
    expect(custom).toHaveBeenCalled();
  });
});
