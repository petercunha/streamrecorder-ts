import { DAEMON_HOST, HTTP_API_PREFIX } from "../shared/constants.js";
import type { DaemonRuntime, DaemonStatus } from "../shared/types.js";

export class DaemonApiClient {
  constructor(private readonly runtime: DaemonRuntime) {}

  async status(): Promise<DaemonStatus> {
    return this.request<DaemonStatus>("GET", `${HTTP_API_PREFIX}/status`);
  }

  async reload(): Promise<void> {
    await this.request("POST", `${HTTP_API_PREFIX}/reload`);
  }

  async shutdown(): Promise<void> {
    await this.request("POST", `${HTTP_API_PREFIX}/shutdown`);
  }

  async recordings(): Promise<unknown> {
    return this.request("GET", `${HTTP_API_PREFIX}/recordings`);
  }

  async probe(targetId: number): Promise<unknown> {
    return this.request("POST", `${HTTP_API_PREFIX}/probe/${targetId}`);
  }

  private async request<T = unknown>(method: string, path: string): Promise<T> {
    const url = `http://${DAEMON_HOST}:${this.runtime.port}${path}`;
    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${this.runtime.token}`,
        "Content-Type": "application/json"
      }
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Daemon request failed: ${response.status} ${text}`);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return (await response.json()) as T;
  }
}
