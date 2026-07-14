/**
 * OpenTelemetry instrumentation bootstrap for the NexusChain API Gateway.
 *
 * IMPORTANT: This file MUST be imported as the very FIRST import in index.ts,
 * before Express and gRPC are initialized. This ensures auto-instrumentation
 * patches the modules at load time (monkey-patching requires pre-import).
 *
 * This implements the Observability layer from plan_tecnico_nexuschain.md §4.3.
 * Each request generates a trace_id (W3C Trace Context standard) that propagates
 * via HTTP headers and gRPC metadata, allowing full end-to-end trace reconstruction
 * in Jaeger: "client click → Gateway → Balance Service gRPC → Kafka publish".
 */

import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-grpc';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { Resource } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';

const OTEL_ENDPOINT = process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://otel-collector:4317';
const SERVICE_NAME = 'api-gateway';
const SERVICE_VERSION = '1.0.0';

const sdk = new NodeSDK({
  resource: new Resource({
    [ATTR_SERVICE_NAME]: SERVICE_NAME,
    [ATTR_SERVICE_VERSION]: SERVICE_VERSION,
    'deployment.environment': process.env.NODE_ENV || 'development',
  }),

  // Export traces to the OTel Collector → forwarded to Jaeger
  traceExporter: new OTLPTraceExporter({
    url: OTEL_ENDPOINT,
  }),

  // Export metrics to the OTel Collector → forwarded to Prometheus
  metricReader: new PeriodicExportingMetricReader({
    exporter: new OTLPMetricExporter({
      url: OTEL_ENDPOINT,
    }),
    exportIntervalMillis: 15000, // Matches Prometheus scrape interval
  }) as any,

  // Auto-instrument Express (HTTP spans), gRPC calls, and Node.js built-ins
  instrumentations: [
    getNodeAutoInstrumentations({
      '@opentelemetry/instrumentation-http': { enabled: true },
      '@opentelemetry/instrumentation-express': { enabled: true },
      '@opentelemetry/instrumentation-grpc': { enabled: true },
      // Disable noisy file system spans
      '@opentelemetry/instrumentation-fs': { enabled: false },
    }),
  ],
});

// Start the SDK synchronously — this must complete before any other imports
sdk.start();

console.log(`🔭 OpenTelemetry SDK started — tracing to ${OTEL_ENDPOINT} as service '${SERVICE_NAME}'`);

// Graceful shutdown
process.on('SIGTERM', () => {
  sdk.shutdown()
    .then(() => console.log('🔭 OpenTelemetry SDK shut down cleanly'))
    .catch((err) => console.error('🔭 Error shutting down OpenTelemetry SDK', err))
    .finally(() => process.exit(0));
});

export default sdk;
