import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // TypeScript files can be tested directly
    include: ['tests/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    exclude: ['node_modules', 'dist', 'build'],
    
    // Test environment
    environment: 'node',
    
    // Timeout settings (longer for file I/O operations)
    testTimeout: 10000,
    hookTimeout: 10000,
    
    // Global test settings
    globals: true,
    
    // Environment variables
    env: {
      NODE_ENV: 'test'
    },
    
    // Coverage configuration
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['ccmonitor.ts'],
      exclude: [
        'node_modules/**',
        'tests/**',
        'build.js',
        'vitest.config.ts'
      ],
      // Focus on critical code paths
      thresholds: {
        global: {
          branches: 80,
          functions: 80,
          lines: 80,
          statements: 80
        }
      }
    },
    
    // Mock configuration
    mockReset: true,
    clearMocks: true,
    restoreMocks: true,
    
    // Parallel execution (but be careful with file I/O tests)
    threads: true,
    maxThreads: 4,
    
    // Reporter configuration
    reporter: ['verbose', 'junit'],
    outputFile: {
      junit: './test-results.xml'
    }
  }
})