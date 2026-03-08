/**
 * CloudWatch Custom Metrics Utility
 *
 * Lightweight, non-blocking metric publishing for Lambda handlers.
 * Uses fire-and-forget pattern — metric failures are logged but never thrown.
 *
 * Namespace: VyaparGyan/{environment}
 *
 * Usage:
 *   import { publishLatencyMetric, publishCountMetric, publishGaugeMetric } from '../core/metrics';
 *   await publishLatencyMetric('WhatsAppWebhookLatency', 123, { Channel: 'whatsapp' });
 *   publishCountMetric('MessagesReceived', 1, { Channel: 'whatsapp' });
 */

import {
  CloudWatchClient,
  PutMetricDataCommand,
  StandardUnit,
} from '@aws-sdk/client-cloudwatch';
import { logger } from '../utils/logger';

const client = new CloudWatchClient({});

function getNamespace(): string {
  const env = process.env.ENVIRONMENT || 'dev';
  return `VyaparGyan/${env}`;
}

type Dimensions = Record<string, string>;

function buildDimensions(dims?: Dimensions) {
  if (!dims) return undefined;
  return Object.entries(dims).map(([Name, Value]) => ({ Name, Value }));
}

/**
 * Publish a single metric data point. Fire-and-forget — errors are logged, never thrown.
 */
async function putMetric(
  metricName: string,
  value: number,
  unit: StandardUnit,
  dimensions?: Dimensions,
): Promise<void> {
  try {
    await client.send(
      new PutMetricDataCommand({
        Namespace: getNamespace(),
        MetricData: [
          {
            MetricName: metricName,
            Value: value,
            Unit: unit,
            Timestamp: new Date(),
            Dimensions: buildDimensions(dimensions),
          },
        ],
      }),
    );
  } catch (err) {
    // Never throw — metrics are best-effort
    logger.warn('Failed to publish CloudWatch metric', {
      metricName,
      value,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Publish a latency metric (milliseconds). */
export function publishLatencyMetric(
  name: string,
  valueMs: number,
  dimensions?: Dimensions,
): Promise<void> {
  return putMetric(name, valueMs, StandardUnit.Milliseconds, dimensions);
}

/** Publish a count metric. */
export function publishCountMetric(
  name: string,
  count: number = 1,
  dimensions?: Dimensions,
): Promise<void> {
  return putMetric(name, count, StandardUnit.Count, dimensions);
}

/** Publish a gauge / percentage metric. */
export function publishGaugeMetric(
  name: string,
  value: number,
  dimensions?: Dimensions,
): Promise<void> {
  return putMetric(name, value, StandardUnit.None, dimensions);
}

/** Publish a percentage metric (0-100). */
export function publishPercentMetric(
  name: string,
  value: number,
  dimensions?: Dimensions,
): Promise<void> {
  return putMetric(name, value, StandardUnit.Percent, dimensions);
}

/**
 * Helper: measure and publish latency for an async operation.
 * Returns the operation result.
 */
export async function withLatencyMetric<T>(
  metricName: string,
  fn: () => Promise<T>,
  dimensions?: Dimensions,
): Promise<T> {
  const start = Date.now();
  try {
    return await fn();
  } finally {
    const elapsed = Date.now() - start;
    // Fire-and-forget — don't await
    publishLatencyMetric(metricName, elapsed, dimensions);
  }
}
