/**
 * Core abstractions and types for interface automation.
 *
 * Defines the abstract BaseInterfaceClient and the concrete
 * PlaywrightWebClient for browser automation.
 */

// ---------------------------------------------------------------------------
// Action types
// ---------------------------------------------------------------------------

export const ActionType = {
  CLICK: "click",
  TYPE: "type",
  SELECT: "select",
  NAVIGATE: "navigate",
  SCREENSHOT: "screenshot",
  SCROLL: "scroll",
  PRESS: "press",
  HOVER: "hover",
} as const;
export type ActionType = (typeof ActionType)[keyof typeof ActionType];

export interface Action {
  actionType: ActionType;
  selector?: string;
  value?: string;
  coordinates?: [number, number];
  metadata?: Record<string, unknown>;
}

export interface ActionResult {
  success: boolean;
  description: string;
  error?: string;
  screenshot?: Buffer;
  taskComplete?: boolean;
  metadata?: Record<string, unknown>;
}

export interface InterfaceState {
  url: string;
  title: string;
  content: string;
  interactiveElements: string[];
  screenshot?: Buffer;
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Abstract base
// ---------------------------------------------------------------------------

export abstract class BaseInterfaceClient {
  abstract initialize(): Promise<void>;
  abstract getState(
    format?: "text" | "visual" | "hybrid"
  ): Promise<InterfaceState>;
  abstract executeAction(action: Action): Promise<ActionResult>;
  abstract getScreenshot(): Promise<Buffer>;
  abstract close(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Playwright implementation
// ---------------------------------------------------------------------------

export class PlaywrightWebClient extends BaseInterfaceClient {
  private startUrl: string;
  private headless: boolean;
  private playwright: unknown;
  private browser: unknown;
  private context: unknown;
  page: unknown;
  actionHistory: Action[] = [];

  constructor(startUrl: string, headless = true) {
    super();
    this.startUrl = startUrl;
    this.headless = headless;
  }

  async initialize(): Promise<void> {
    // Lazy import playwright
    const pw = await import("playwright");
    this.playwright = pw;
    this.browser = await pw.chromium.launch({ headless: this.headless });
    this.context = await (this.browser as any).newContext();
    this.page = await (this.context as any).newPage();
    await (this.page as any).goto(this.startUrl, {
      waitUntil: "domcontentloaded",
    });
  }

  async getState(format: "text" | "visual" | "hybrid" = "hybrid"): Promise<InterfaceState> {
    const page = this.page as any;
    const url = page.url();
    const title = await page.title();
    const content = await page.evaluate(
      "document.body?.innerText?.slice(0, 5000) ?? ''"
    );
    const elements = await this.getInteractiveElements();

    let screenshot: Buffer | undefined;
    if (format === "visual" || format === "hybrid") {
      screenshot = await page.screenshot({ type: "png" });
    }

    return { url, title, content, interactiveElements: elements, screenshot };
  }

  private async getInteractiveElements(): Promise<string[]> {
    const page = this.page as any;
    /* eslint-disable no-eval -- Playwright evaluate runs in browser context */
    return page.evaluate(`(() => {
      const selectors = [
        "a[href]", "button", "input", "select",
        "textarea", "[role='button']", "[onclick]",
      ];
      const elements = [];
      for (const sel of selectors) {
        document.querySelectorAll(sel).forEach((el) => {
          const tag = el.tagName.toLowerCase();
          const text = el.innerText ? el.innerText.slice(0, 50) : "";
          const href = el.getAttribute("href") || "";
          const type = el.getAttribute("type") || "";
          const id = el.getAttribute("id") || "";
          elements.push(
            "<" + tag
            + (id ? ' id="' + id + '"' : "")
            + (type ? ' type="' + type + '"' : "")
            + (href ? ' href="' + href + '"' : "")
            + ">" + text + "</" + tag + ">"
          );
        });
      }
      return elements.slice(0, 50);
    })()`);
  }

  async executeAction(action: Action): Promise<ActionResult> {
    this.actionHistory.push(action);
    const page = this.page as any;

    try {
      switch (action.actionType) {
        case ActionType.NAVIGATE:
          await page.goto(action.value, {
            waitUntil: "domcontentloaded",
            timeout: 30000,
          });
          return { success: true, description: `Navigated to ${action.value}` };

        case ActionType.CLICK:
          if (action.selector) {
            try {
              await page.click(action.selector, { timeout: 5000 });
            } catch {
              // Fallback: try text-based
              await page
                .getByText(action.selector, { exact: false })
                .first()
                .click({ timeout: 5000 });
            }
          }
          return {
            success: true,
            description: `Clicked on ${action.selector}`,
          };

        case ActionType.TYPE:
          if (action.selector && action.value) {
            await page.fill(action.selector, action.value);
          }
          return {
            success: true,
            description: `Typed "${action.value}" into ${action.selector}`,
          };

        case ActionType.SELECT:
          if (action.selector && action.value) {
            await page.selectOption(action.selector, action.value);
          }
          return {
            success: true,
            description: `Selected "${action.value}" in ${action.selector}`,
          };

        case ActionType.PRESS:
          if (action.value) {
            if (action.selector) {
              await page.press(action.selector, action.value);
            } else {
              await page.keyboard.press(action.value);
            }
          }
          return {
            success: true,
            description: `Pressed ${action.value}`,
          };

        case ActionType.SCROLL: {
          const direction = action.value ?? "down";
          const amount = action.metadata?.amount ?? 300;
          const deltaX = direction === "left" ? -(amount as number) : direction === "right" ? (amount as number) : 0;
          const deltaY = direction === "up" ? -(amount as number) : direction === "down" ? (amount as number) : 0;
          await page.mouse.wheel(deltaX, deltaY);
          return {
            success: true,
            description: `Scrolled ${direction}`,
          };
        }

        case ActionType.HOVER:
          if (action.selector) {
            await page.hover(action.selector, { timeout: 5000 });
          }
          return {
            success: true,
            description: `Hovered over ${action.selector}`,
          };

        case ActionType.SCREENSHOT: {
          const screenshot = await page.screenshot({ type: "png" });
          return {
            success: true,
            description: "Screenshot captured",
            screenshot,
          };
        }

        default:
          return {
            success: false,
            description: `Unknown action type: ${action.actionType}`,
            error: `Unknown action type: ${action.actionType}`,
          };
      }
    } catch (e) {
      return {
        success: false,
        description: `Action failed: ${(e as Error).message}`,
        error: (e as Error).message,
      };
    }
  }

  async getScreenshot(): Promise<Buffer> {
    const page = this.page as any;
    return page.screenshot({ type: "png" });
  }

  async close(): Promise<void> {
    try {
      if (this.context) await (this.context as any).close();
      if (this.browser) await (this.browser as any).close();
    } catch {
      // Ignore cleanup errors
    }
  }
}
