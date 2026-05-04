import type { HealthCheckResult, ProviderStatus, Manifest } from '../types/index.js';
import { BaseProvider } from '../providers/base-provider.js';
import * as fs from 'fs';
import * as path from 'path';

const STATUS_FILE = 'provider-status.json';

export class HealthMonitor {
  private providers: BaseProvider[];
  private statusMap: Map<string, ProviderStatus> = new Map();

  constructor(providers: BaseProvider[]) {
    this.providers = providers;
    this.loadStatus();
  }

  async checkAll(): Promise<HealthCheckResult[]> {
    const results = await Promise.all(
      this.providers.map((p) => p.checkHealth())
    );

    for (const result of results) {
      this.updateStatus(result);
    }

    this.saveStatus();
    this.updateManifest();

    return results;
  }

  async checkProvider(providerId: string): Promise<HealthCheckResult | null> {
    const provider = this.providers.find((p) => p.id === providerId);
    if (!provider) return null;

    const result = await provider.checkHealth();
    this.updateStatus(result);
    this.saveStatus();
    this.updateManifest();

    return result;
  }

  getStatus(providerId: string): ProviderStatus | undefined {
    return this.statusMap.get(providerId);
  }

  getAllStatuses(): Map<string, ProviderStatus> {
    return new Map(this.statusMap);
  }

  private updateStatus(result: HealthCheckResult): void {
    const existing = this.statusMap.get(result.providerId) ?? {
      healthy: false,
      lastChecked: 0,
      successRate: 0,
      errorCount: 0,
      totalRequests: 0,
      averageResponseMs: 0,
    };

    const totalRequests = existing.totalRequests + 1;
    const errorCount = existing.errorCount + (result.healthy ? 0 : 1);
    const successRate = ((totalRequests - errorCount) / totalRequests) * 100;
    const averageResponseMs =
      (existing.averageResponseMs * existing.totalRequests +
        result.responseTimeMs) /
      totalRequests;

    this.statusMap.set(result.providerId, {
      healthy: result.healthy,
      lastChecked: result.timestamp,
      successRate: Math.round(successRate * 100) / 100,
      errorCount,
      totalRequests,
      averageResponseMs: Math.round(averageResponseMs),
    });
  }

  private loadStatus(): void {
    try {
      const statusPath = path.resolve(STATUS_FILE);
      if (fs.existsSync(statusPath)) {
        const data = JSON.parse(fs.readFileSync(statusPath, 'utf-8')) as Record<string, ProviderStatus>;
        for (const [id, status] of Object.entries(data)) {
          this.statusMap.set(id, status);
        }
      }
    } catch {
      // Start fresh if file is corrupted
    }
  }

  private saveStatus(): void {
    try {
      const data: Record<string, ProviderStatus> = {};
      for (const [id, status] of this.statusMap) {
        data[id] = status;
      }
      fs.writeFileSync(
        path.resolve(STATUS_FILE),
        JSON.stringify(data, null, 2)
      );
    } catch {
      console.error('Failed to save provider status');
    }
  }

  private updateManifest(): void {
    try {
      const manifestPath = path.resolve('manifest.json');
      if (!fs.existsSync(manifestPath)) return;

      const manifest = JSON.parse(
        fs.readFileSync(manifestPath, 'utf-8')
      ) as Manifest;

      for (const scraper of manifest.scrapers) {
        const status = this.statusMap.get(scraper.id);
        if (status) {
          scraper.status = status;
        }
      }

      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    } catch {
      console.error('Failed to update manifest');
    }
  }
}
