import net from 'net';

/**
 * Find a free TCP port.
 * @returns {Promise<number>}
 */
export function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

/**
 * Wait for a port to accept connections.
 * @param {number} port
 * @param {object} [opts]
 * @param {number} [opts.timeout=10000]
 * @param {number} [opts.interval=200]
 * @returns {Promise<void>}
 */
export function waitForPort(port, { timeout = 10000, interval = 200 } = {}) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      if (Date.now() - start > timeout) {
        reject(new Error(`Port ${port} not ready after ${timeout}ms`));
        return;
      }
      const socket = net.createConnection({ port, host: '127.0.0.1' });
      socket.on('connect', () => {
        socket.destroy();
        resolve();
      });
      socket.on('error', () => {
        socket.destroy();
        setTimeout(check, interval);
      });
    };
    check();
  });
}
