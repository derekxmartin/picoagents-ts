/**
 * HTTP request step for making web requests in workflows.
 * Uses native fetch() API.
 */

import { type StepMetadata, type WorkflowContext } from "../core/models.js";
import { BaseStep } from "./base-step.js";

export interface HttpRequestInput {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  data?: Record<string, unknown>;
  timeout?: number;
}

export interface HttpResponseOutput {
  statusCode: number;
  content: string;
  headers: Record<string, string>;
  url: string;
  elapsedTime: number;
}

export class HttpStep extends BaseStep<HttpRequestInput, HttpResponseOutput> {
  constructor(stepId: string, metadata: StepMetadata) {
    super(stepId, metadata, "HttpRequestInput", "HttpResponseOutput");
  }

  async execute(
    inputData: HttpRequestInput,
    context: WorkflowContext
  ): Promise<HttpResponseOutput> {
    const startTime = Date.now();
    const method = (inputData.method ?? "GET").toUpperCase();
    const timeout = (inputData.timeout ?? 30) * 1000;

    try {
      const fetchOptions: RequestInit = {
        method,
        headers: inputData.headers,
        signal: AbortSignal.timeout(timeout),
      };

      if (
        inputData.data &&
        ["POST", "PUT", "PATCH"].includes(method)
      ) {
        fetchOptions.body = JSON.stringify(inputData.data);
        fetchOptions.headers = {
          "Content-Type": "application/json",
          ...(fetchOptions.headers as Record<string, string>),
        };
      }

      const response = await fetch(inputData.url, fetchOptions);
      const elapsedTime = (Date.now() - startTime) / 1000;
      const content = await response.text();

      // Store request info in context
      context.set(`${this.stepId}_request_info`, {
        url: inputData.url,
        method,
        statusCode: response.status,
        elapsedTime,
        contentLength: content.length,
      });

      if (!response.ok) {
        throw new Error(
          `HTTP ${response.status}: ${response.statusText}`
        );
      }

      // Extract headers
      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headers[key] = value;
      });

      return {
        statusCode: response.status,
        content,
        headers,
        url: response.url,
        elapsedTime,
      };
    } catch (e) {
      const elapsedTime = (Date.now() - startTime) / 1000;
      const errorMsg = `Request failed for ${inputData.url}: ${(e as Error).message}`;

      context.set(`${this.stepId}_error`, {
        type: "request_error",
        message: errorMsg,
        elapsedTime,
      });

      throw new Error(errorMsg);
    }
  }
}
