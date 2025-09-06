import { vi } from 'vitest'
import type { HourlyStats, ClaudeLogEntry } from '../../ccmonitor'

/**
 * Test utilities for ccmonitor testing
 */
export class TestUtils {
  
  /**
   * Generate mock Claude Code log entry
   */
  static createMockLogEntry(overrides: Partial<ClaudeLogEntry> = {}): ClaudeLogEntry {
    const defaults: ClaudeLogEntry = {
      timestamp: new Date().toISOString(),
      type: 'assistant',
      message: {
        id: `msg_${Math.random().toString(36).substr(2, 9)}`,
        model: 'claude-sonnet-4-20250514',
        usage: {
          input_tokens: 1000,
          output_tokens: 500,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0
        }
      },
      cost: 0.0105 // Default cost for 1000 input + 500 output tokens on Sonnet 4
    }

    return { ...defaults, ...overrides }
  }

  /**
   * Generate mock hourly stats
   */
  static createMockHourlyStats(overrides: Partial<HourlyStats> = {}): HourlyStats {
    const defaults: HourlyStats = {
      hour: '2025-01-01 12:00',
      inputTokens: 1000,
      outputTokens: 500,
      totalTokens: 1500,
      cost: 0.0105,
      sessionCount: 1,
      avgInputPerSession: 1000,
      avgOutputPerSession: 500
    }

    return { ...defaults, ...overrides }
  }

  /**
   * Generate multiple mock log entries with different models and times
   */
  static createMockLogEntries(count: number, options: {
    models?: string[],
    timeRange?: { start: Date, end: Date },
    duplicateIds?: boolean,
    includeCache?: boolean
  } = {}): ClaudeLogEntry[] {
    const {
      models = ['claude-sonnet-4-20250514', 'claude-opus-4-20250514', 'claude-haiku-3.5-20241022'],
      timeRange = {
        start: new Date('2025-01-01T00:00:00Z'),
        end: new Date('2025-01-01T23:59:59Z')
      },
      duplicateIds = false,
      includeCache = true
    } = options

    const entries: ClaudeLogEntry[] = []
    const usedIds = new Set<string>()

    for (let i = 0; i < count; i++) {
      // Generate timestamp within range
      const timeDiff = timeRange.end.getTime() - timeRange.start.getTime()
      const timestamp = new Date(
        timeRange.start.getTime() + Math.random() * timeDiff
      ).toISOString()

      // Select random model
      const model = models[Math.floor(Math.random() * models.length)]

      // Generate message ID (with optional duplicates)
      let messageId: string
      if (duplicateIds && i > 0 && Math.random() < 0.1) {
        // 10% chance of duplicate ID
        const existingIds = Array.from(usedIds)
        messageId = existingIds[Math.floor(Math.random() * existingIds.length)]
      } else {
        messageId = `msg_${i}_${Math.random().toString(36).substr(2, 9)}`
        usedIds.add(messageId)
      }

      // Generate realistic token counts
      const inputTokens = Math.floor(Math.random() * 3000) + 100
      const outputTokens = Math.floor(Math.random() * 2000) + 50
      const cacheCreationTokens = includeCache && Math.random() < 0.3 ? Math.floor(Math.random() * 500) : 0
      const cacheReadTokens = includeCache && Math.random() < 0.2 ? Math.floor(Math.random() * 1000) : 0

      entries.push(this.createMockLogEntry({
        timestamp,
        message: {
          id: messageId,
          model,
          usage: {
            input_tokens: inputTokens,
            output_tokens: outputTokens,
            cache_creation_input_tokens: cacheCreationTokens,
            cache_read_input_tokens: cacheReadTokens
          }
        }
      }))
    }

    return entries.sort((a, b) => a.timestamp.localeCompare(b.timestamp))
  }

  /**
   * Mock file system for testing
   */
  static createMockFileSystem() {
    const mockFiles: Record<string, string> = {}
    const mockStats: Record<string, { mtime: Date }> = {}

    return {
      // Mock readFile
      readFile: vi.fn(async (path: string) => {
        if (mockFiles[path]) {
          return mockFiles[path]
        }
        throw new Error(`File not found: ${path}`)
      }),

      // Mock writeFile
      writeFile: vi.fn(async (path: string, content: string) => {
        mockFiles[path] = content
        mockStats[path] = { mtime: new Date() }
      }),

      // Mock readdir - dynamically return directory contents based on mock files
      readdir: vi.fn(async (path: string) => {
        const normalizedPath = path.endsWith('/') ? path.slice(0, -1) : path
        const children = new Set<string>()
        
        // Find all files and directories that are children of this path
        for (const filePath of Object.keys(mockFiles)) {
          if (filePath.startsWith(normalizedPath + '/')) {
            const relativePath = filePath.substring(normalizedPath.length + 1)
            const firstSegment = relativePath.split('/')[0]
            children.add(firstSegment)
          }
        }
        
        return Array.from(children)
      }),

      // Mock stat
      stat: vi.fn(async (path: string) => {
        return mockStats[path] || { mtime: new Date() }
      }),

      // Mock mkdir
      mkdir: vi.fn(),

      // Helper to set mock file content
      setMockFile: (path: string, content: string) => {
        mockFiles[path] = content
        mockStats[path] = { mtime: new Date() }
      },

      // Helper to set file modification time
      setMockFileMtime: (path: string, mtime: Date) => {
        if (!mockStats[path]) {
          mockStats[path] = { mtime }
        } else {
          mockStats[path].mtime = mtime
        }
      },

      // Get all mock files for inspection
      getMockFiles: () => ({ ...mockFiles }),
      getMockStats: () => ({ ...mockStats })
    }
  }

  /**
   * Mock time for testing
   */
  static mockTime(fixedTime?: Date) {
    const time = fixedTime || new Date('2025-01-01T12:00:00Z')
    vi.useFakeTimers()
    vi.setSystemTime(time)
    return {
      setTime: (newTime: Date) => vi.setSystemTime(newTime),
      advanceTime: (ms: number) => vi.advanceTimersByTime(ms),
      restore: () => vi.useRealTimers()
    }
  }

  /**
   * Create test fixture files content
   */
  static generateJSONLContent(entries: ClaudeLogEntry[]): string {
    return entries.map(entry => JSON.stringify(entry)).join('\n')
  }

  /**
   * Validate cost calculation with expected precision
   */
  static validateCost(actual: number, expected: number, precision = 0.000001): boolean {
    return Math.abs(actual - expected) < precision
  }

  /**
   * Create mock terminal output for testing display functions
   */
  static mockTerminalOutput() {
    const outputs: string[] = []
    
    return {
      stdout: {
        write: vi.fn((data: string) => {
          outputs.push(data)
          return true
        }),
        rows: 24
      },
      console: {
        log: vi.fn((...args: any[]) => {
          outputs.push(args.join(' ') + '\n')
        }),
        error: vi.fn((...args: any[]) => {
          outputs.push('ERROR: ' + args.join(' ') + '\n')
        })
      },
      getOutput: () => outputs.join(''),
      clearOutput: () => outputs.length = 0
    }
  }
}

/**
 * Common test constants
 */
export const TEST_CONSTANTS = {
  MODELS: {
    SONNET_4: 'claude-sonnet-4-20250514',
    OPUS_4: 'claude-opus-4-20250514',
    HAIKU_35: 'claude-haiku-3.5-20241022'
  },
  
  PRICING: {
    SONNET_4: { input: 0.003, output: 0.015, cacheCreation: 0.00375, cacheRead: 0.0003 },
    OPUS_4: { input: 0.015, output: 0.075, cacheCreation: 0.01875, cacheRead: 0.0015 },
    HAIKU_35: { input: 0.0008, output: 0.004, cacheCreation: 0.001, cacheRead: 0.00008 }
  },

  SAMPLE_TIMESTAMPS: [
    '2025-01-01T09:00:00Z',
    '2025-01-01T10:30:00Z', 
    '2025-01-01T14:15:00Z',
    '2025-01-01T16:45:00Z',
    '2025-01-01T20:00:00Z'
  ]
} as const