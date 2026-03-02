import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import {
  DynamicBorder,
  getSelectListTheme,
} from "@mariozechner/pi-coding-agent";
import {
  Container,
  type SelectItem,
  SelectList,
  Spacer,
  Text,
} from "@mariozechner/pi-tui";

export async function selectWrapped(
  ctx: ExtensionContext,
  title: string,
  options: string[],
  uiOptions?: { forceCustom?: boolean },
): Promise<string | undefined> {
  if (!ctx.hasUI) return options[0];

  const isVitest =
    (import.meta as unknown as { env?: { VITEST?: boolean } }).env?.VITEST ||
    (typeof process !== "undefined" && Boolean(process.env.VITEST));
  const forceCustom = uiOptions?.forceCustom === true;

  if (!forceCustom && (isVitest || !ctx.ui.custom)) {
    return ctx.ui.select(title, options);
  }

  if (!ctx.ui.custom) {
    return ctx.ui.select(title, options);
  }

  return ctx.ui.custom<string | undefined>((tui, theme, _keybindings, done) => {
    void _keybindings;
    const container = new Container();
    container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
    container.addChild(new Spacer(1));
    container.addChild(new Text(theme.fg("accent", theme.bold(title)), 1, 0));
    container.addChild(new Spacer(1));

    const items = options.map((option) => ({ value: option, label: option }));
    const selectList = new SelectList(
      items,
      Math.min(items.length, 12),
      getSelectListTheme(),
    );
    selectList.onSelect = (item: SelectItem) => done(item.value);
    selectList.onCancel = () => done(undefined);
    container.addChild(selectList);

    container.addChild(new Spacer(1));
    container.addChild(
      new Text("↑↓ to navigate  Enter to select  Esc to cancel", 1, 0),
    );
    container.addChild(new Spacer(1));
    container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));

    return {
      render: (w) => container.render(w),
      invalidate: () => container.invalidate(),
      handleInput: (data) => {
        selectList.handleInput(data);
        tui.requestRender();
      },
    };
  });
}
