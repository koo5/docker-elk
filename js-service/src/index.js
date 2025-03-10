import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
import pino from 'pino';
import { createPinoOpenTelemetryTransport } from 'pino-opentelemetry-transport';
import ecsFormat from '@elastic/ecs-pino-format';

// Configure OpenTelemetry
const resource = new Resource({
  [SemanticResourceAttributes.SERVICE_NAME]: 'js-service',
  [SemanticResourceAttributes.SERVICE_VERSION]: '1.0.0',
});

const traceExporter = new OTLPTraceExporter({
  url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://otel-collector:4317',
});

const sdk = new NodeSDK({
  resource,
  traceExporter,
});

// Start the OpenTelemetry SDK
sdk.start();

// Configure Pino with OpenTelemetry transport
const transport = await createPinoOpenTelemetryTransport({
  serviceVersion: '1.0.0',
  serviceName: 'js-service',
});

// Create a Pino logger with ECS format
const logger = pino({
  ...ecsFormat(),
  level: 'info',
}, transport);

// Simple HTTP server
const server = Bun.serve({
  port: 3000,
  async fetch(req) {
    const url = new URL(req.url);
    
    logger.info({
      path: url.pathname,
      method: req.method,
      message: `Received request: ${req.method} ${url.pathname}`
    });
    
    // Simulate some work
    await new Promise(resolve => setTimeout(resolve, 50));
    
    if (url.pathname === '/error') {
      logger.error({
        path: url.pathname,
        message: 'Error endpoint called'
      });
      return new Response('Error endpoint', { status: 500 });
    }
    
    logger.info({
      path: url.pathname,
      message: `Successfully processed request: ${req.method} ${url.pathname}`
    });
    
    return new Response('Hello from Bun!');
  },
});

logger.info(`Server running at http://localhost:${server.port}`);

// Generate some periodic logs
setInterval(() => {
  logger.info({ message: 'Periodic heartbeat log' });
}, 5000);

// Handle shutdown
process.on('SIGINT', async () => {
  logger.info('Shutting down...');
  await sdk.shutdown();
  process.exit(0);
});
