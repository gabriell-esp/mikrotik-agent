import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    env: {
      MASTER_KEY: Buffer.alloc(32, 7).toString('base64'),
      COOKIE_SECURE: 'false',
      COLLECTOR_ENABLED: 'false',
      DB_POOL_MAX: '1',
      ROS_CONNECT_TIMEOUT_MS: '1500',
      ROS_COMMAND_TIMEOUT_MS: '3000',
      LOG_LEVEL: 'warn',
    },
    testTimeout: 30000,
    hookTimeout: 60000,
    fileParallelism: false,
  },
});
