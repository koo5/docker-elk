import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
import { trace, context } from '@opentelemetry/api';
import pino from 'pino';
import { createPinoOpenTelemetryTransport } from 'pino-opentelemetry-transport';
import ecsFormat from '@elastic/ecs-pino-format';

// Configure OpenTelemetry
const resource = new Resource({
  [SemanticResourceAttributes.SERVICE_NAME]: 'js-service',
  [SemanticResourceAttributes.SERVICE_VERSION]: '1.0.0',
  [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: 'development',
});

const traceExporter = new OTLPTraceExporter({
  url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://otel-collector:4317',
});

const sdk = new NodeSDK({
  resource,
  traceExporter,
  instrumentations: [], // We'll manually create spans for better control
});

// Start the OpenTelemetry SDK
sdk.start();

// Get a tracer
const tracer = trace.getTracer('js-service-tracer');

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
    
    // Create a span for this request
    return await tracer.startActiveSpan(`${req.method} ${url.pathname}`, async (span) => {
      try {
        // Add attributes to the span
        span.setAttribute('http.method', req.method);
        span.setAttribute('http.url', url.toString());
        span.setAttribute('http.route', url.pathname);
        
        logger.info({
          path: url.pathname,
          method: req.method,
          message: `Received request: ${req.method} ${url.pathname}`,
          traceId: span.spanContext().traceId,
          spanId: span.spanContext().spanId,
        });
        
        // Simulate some work with a child span
        await tracer.startActiveSpan('processing', async (childSpan) => {
          childSpan.setAttribute('processing.type', 'simulation');
          await new Promise(resolve => setTimeout(resolve, 50));
          childSpan.end();
        });
        
        if (url.pathname === '/error') {
          // Record the error in the span
          span.setStatus({ code: 2, message: 'Error endpoint called' }); // 2 = ERROR
          span.recordException(new Error('Error endpoint called'));
          
          logger.error({
            path: url.pathname,
            message: 'Error endpoint called',
            traceId: span.spanContext().traceId,
            spanId: span.spanContext().spanId,
          });
          
          return new Response('Error endpoint', { status: 500 });
        }
        
        logger.info({
          path: url.pathname,
          message: `Successfully processed request: ${req.method} ${url.pathname}`,
          traceId: span.spanContext().traceId,
          spanId: span.spanContext().spanId,
        });
        
        return new Response('Hello from Bun!');
      } catch (error) {
        // Record any unexpected errors
        span.setStatus({ code: 2, message: error.message });
        span.recordException(error);
        
        logger.error({
          error: error.message,
          stack: error.stack,
          message: 'Unexpected error processing request',
          traceId: span.spanContext().traceId,
          spanId: span.spanContext().spanId,
        });
        
        return new Response('Internal Server Error', { status: 500 });
      } finally {
        span.end();
      }
    });
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
