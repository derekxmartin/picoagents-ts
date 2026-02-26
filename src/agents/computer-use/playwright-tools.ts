/**
 * Tool implementations for computer use with Playwright.
 *
 * Each tool wraps a specific browser action and uses the
 * BaseInterfaceClient abstraction for execution.
 */

import { z } from "zod";
import { createTool } from "../../tools/decorator.js";
import type { BaseTool } from "../../tools/base.js";
import {
  type BaseInterfaceClient,
  ActionType,
} from "./interface-clients.js";

// ---------------------------------------------------------------------------
// Tool factories
// ---------------------------------------------------------------------------

export function createNavigateTool(client: BaseInterfaceClient): BaseTool {
  return createTool({
    name: "navigate",
    description: "Navigate to a URL in the browser",
    parametersSchema: z.object({
      url: z.string().describe("URL to navigate to"),
    }),
    execute: async ({ url }) => {
      const result = await client.executeAction({
        actionType: ActionType.NAVIGATE,
        value: url,
      });
      return result.success
        ? result.description
        : `Navigation failed: ${result.error}`;
    },
  });
}

export function createClickTool(client: BaseInterfaceClient): BaseTool {
  return createTool({
    name: "click",
    description: "Click on an element on the page using a CSS selector or text content",
    parametersSchema: z.object({
      selector: z.string().describe("CSS selector or text content to click"),
    }),
    execute: async ({ selector }) => {
      const result = await client.executeAction({
        actionType: ActionType.CLICK,
        selector,
      });
      return result.success
        ? result.description
        : `Click failed: ${result.error}`;
    },
  });
}

export function createTypeTool(client: BaseInterfaceClient): BaseTool {
  return createTool({
    name: "type_text",
    description: "Type text into an input field identified by a CSS selector",
    parametersSchema: z.object({
      selector: z.string().describe("CSS selector of the input field"),
      text: z.string().describe("Text to type"),
    }),
    execute: async ({ selector, text }) => {
      const result = await client.executeAction({
        actionType: ActionType.TYPE,
        selector,
        value: text,
      });
      return result.success
        ? result.description
        : `Type failed: ${result.error}`;
    },
  });
}

export function createSelectTool(client: BaseInterfaceClient): BaseTool {
  return createTool({
    name: "select_option",
    description: "Select an option from a dropdown element",
    parametersSchema: z.object({
      selector: z.string().describe("CSS selector of the select element"),
      value: z.string().describe("Option value or text to select"),
    }),
    execute: async ({ selector, value }) => {
      const result = await client.executeAction({
        actionType: ActionType.SELECT,
        selector,
        value,
      });
      return result.success
        ? result.description
        : `Select failed: ${result.error}`;
    },
  });
}

export function createPressTool(client: BaseInterfaceClient): BaseTool {
  return createTool({
    name: "press_key",
    description: "Press a keyboard key (e.g., Enter, Tab, Escape)",
    parametersSchema: z.object({
      selector: z
        .string()
        .optional()
        .describe("Optional CSS selector to focus first"),
      key: z.string().describe("Key to press (e.g., Enter, Tab, Escape)"),
    }),
    execute: async ({ selector, key }) => {
      const result = await client.executeAction({
        actionType: ActionType.PRESS,
        selector,
        value: key,
      });
      return result.success
        ? result.description
        : `Press failed: ${result.error}`;
    },
  });
}

export function createHoverTool(client: BaseInterfaceClient): BaseTool {
  return createTool({
    name: "hover",
    description: "Hover over an element on the page",
    parametersSchema: z.object({
      selector: z.string().describe("CSS selector of the element to hover"),
    }),
    execute: async ({ selector }) => {
      const result = await client.executeAction({
        actionType: ActionType.HOVER,
        selector,
      });
      return result.success
        ? result.description
        : `Hover failed: ${result.error}`;
    },
  });
}

export function createScrollTool(client: BaseInterfaceClient): BaseTool {
  return createTool({
    name: "scroll",
    description: "Scroll the page in a given direction",
    parametersSchema: z.object({
      direction: z
        .enum(["up", "down", "left", "right"])
        .describe("Direction to scroll"),
      amount: z
        .number()
        .optional()
        .describe("Amount to scroll in pixels (default 300)"),
      selector: z
        .string()
        .optional()
        .describe("Optional element to scroll within"),
    }),
    execute: async ({ direction, amount, selector }) => {
      const result = await client.executeAction({
        actionType: ActionType.SCROLL,
        value: direction,
        selector,
        metadata: { amount: amount ?? 300 },
      });
      return result.success
        ? result.description
        : `Scroll failed: ${result.error}`;
    },
  });
}

export function createObservePageTool(
  client: BaseInterfaceClient
): BaseTool {
  return createTool({
    name: "observe_page",
    description:
      "Observe the current state of the page including URL, title, content, and interactive elements",
    parametersSchema: z.object({}),
    execute: async () => {
      const state = await client.getState("text");
      const lines = [
        `URL: ${state.url}`,
        `Title: ${state.title}`,
        "",
        "Page content:",
        state.content.slice(0, 3000),
        "",
        "Interactive elements:",
        ...state.interactiveElements.slice(0, 30),
      ];
      return lines.join("\n");
    },
  });
}

// ---------------------------------------------------------------------------
// Factory that creates all tools
// ---------------------------------------------------------------------------

export function createPlaywrightTools(
  client: BaseInterfaceClient
): BaseTool[] {
  return [
    createNavigateTool(client),
    createClickTool(client),
    createTypeTool(client),
    createSelectTool(client),
    createPressTool(client),
    createHoverTool(client),
    createScrollTool(client),
    createObservePageTool(client),
  ];
}
