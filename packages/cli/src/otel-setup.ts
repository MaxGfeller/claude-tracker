import { Registry, Counter, Gauge } from 'prom-client';
import { createServer, type Server } from 'http';

let registry: Registry | null = null;
let httpServer: Server | null = null;

const OTEL_PORT = 9464;

export async function initOTelCollector(): Promise<void> {
  if (registry) {
    return; // Already initialized
  }

  registry = new Registry();

  // Create HTTP server for Prometheus metrics endpoint
  httpServer = createServer((req, res) => {
    if (req.url === '/metrics') {
      res.setHeader('Content-Type', registry!.contentType);
      registry!.metrics().then(metrics => {
        res.end(metrics);
      }).catch(err => {
        res.statusCode = 500;
        res.end(err.toString());
      });
    } else if (req.url === '/api/v1/query') {
      // Simple Prometheus-compatible query endpoint
      const url = new URL(req.url, `http://localhost:${OTEL_PORT}`);
      const query = url.searchParams.get('query');

      if (!query) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: 'Missing query parameter' }));
        return;
      }

      // For now, return empty results - metrics will be collected from Claude workers
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        status: 'success',
        data: {
          resultType: 'vector',
          result: []
        }
      }));
    } else {
      res.statusCode = 404;
      res.end('Not Found');
    }
  });

  return new Promise((resolve, reject) => {
    httpServer!.listen(OTEL_PORT, () => {
      resolve();
    }).on('error', reject);
  });
}

export function getClaudeOTelEnv(): Record<string, string> {
  return {
    CLAUDE_CODE_ENABLE_TELEMETRY: '1',
    OTEL_METRICS_EXPORTER: 'prometheus',
    OTEL_EXPORTER_OTLP_ENDPOINT: `http://localhost:${OTEL_PORT}`,
    OTEL_METRIC_EXPORT_INTERVAL: '10000',  // 10s for faster feedback
  };
}

export async function shutdownOTelCollector(): Promise<void> {
  if (httpServer) {
    return new Promise((resolve) => {
      httpServer!.close(() => {
        httpServer = null;
        registry = null;
        resolve();
      });
    });
  }
}
