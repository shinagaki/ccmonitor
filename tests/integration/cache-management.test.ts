import { describe, it, expect, beforeEach, vi } from 'vitest'
import { TestUtils, TEST_CONSTANTS } from '../helpers/test-utils'
import { ClaudeUsageMonitor } from '../../ccmonitor'
import type { HourlyStats, ClaudeLogEntry } from '../../ccmonitor'

/**
 * Cache management simulation for testing
 * This simulates the cache-related functionality from ccmonitor
 */
class CacheManager {
  private cachedHourlyStats: Map<string, HourlyStats> = new Map()
  private seenMessageIds: Set<string> = new Set()
  private fileLastModified: Map<string, number> = new Map()
  private mockFileSystem: ReturnType<typeof TestUtils.createMockFileSystem>

  constructor(mockFileSystem?: ReturnType<typeof TestUtils.createMockFileSystem>) {
    this.mockFileSystem = mockFileSystem || TestUtils.createMockFileSystem()
  }

  // Simulate initializeCache from ccmonitor.ts
  async initializeCache(): Promise<void> {
    this.cachedHourlyStats.clear()
    this.seenMessageIds.clear()
    
    try {
      // Load existing persistent data
      const content = await this.mockFileSystem.readFile('~/.ccmonitor/usage-log.jsonl')
      const records: HourlyStats[] = content.trim().split('\n').map(line => JSON.parse(line))
      
      for (const record of records) {
        this.cachedHourlyStats.set(record.hour, record)
      }
    } catch (error) {
      // No persistent data, start fresh
    }
    
    try {
      // Initialize seen message IDs from Claude logs
      const entries = await this.loadClaudeData()
      for (const entry of entries) {
        if (entry.message?.id) {
          this.seenMessageIds.add(entry.message.id)
        }
      }
    } catch (error) {
      // No Claude data available
    }
  }

  // Simulate collectIncremental from ccmonitor.ts
  async collectIncremental(): Promise<number> {
    const newEntries = await this.loadNewEntries()
    
    if (newEntries.length === 0) {
      return 0
    }

    // Update cached hourly stats with new entries
    for (const entry of newEntries) {
      const hourKey = this.getHourKey(entry.timestamp)
      
      if (!this.cachedHourlyStats.has(hourKey)) {
        this.cachedHourlyStats.set(hourKey, {
          hour: hourKey,
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          cost: 0,
          sessionCount: 0,
          avgInputPerSession: 0,
          avgOutputPerSession: 0
        })
      }
      
      const stats = this.cachedHourlyStats.get(hourKey)!
      const usage = entry.message?.usage
      
      if (usage) {
        const inputTokens = usage.input_tokens || 0
        const outputTokens = usage.output_tokens || 0
        const cacheCreationTokens = usage.cache_creation_input_tokens || 0
        const cacheReadTokens = usage.cache_read_input_tokens || 0
        
        stats.inputTokens += inputTokens
        stats.outputTokens += outputTokens
        stats.totalTokens += inputTokens + outputTokens + cacheCreationTokens + cacheReadTokens
        stats.cost += this.calculateCost(inputTokens, outputTokens, cacheCreationTokens, cacheReadTokens, entry.message?.model)
        stats.sessionCount += 1
        stats.avgInputPerSession = stats.sessionCount > 0 ? stats.inputTokens / stats.sessionCount : 0
        stats.avgOutputPerSession = stats.sessionCount > 0 ? stats.outputTokens / stats.sessionCount : 0
      }
    }
    
    // Write updated stats to persistent storage
    await this.writeCachedStats()
    
    return newEntries.length
  }

  // Helper methods
  private getHourKey(timestamp: string): string {
    const date = new Date(timestamp)
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')} ${String(date.getUTCHours()).padStart(2, '0')}:00`
  }

  private calculateCost(inputTokens: number, outputTokens: number, cacheCreationTokens: number, cacheReadTokens: number, model = 'claude-sonnet-4-20250514'): number {
    const pricing = TEST_CONSTANTS.PRICING.SONNET_4 // Simplified for testing
    return (inputTokens / 1000) * pricing.input +
           (outputTokens / 1000) * pricing.output +
           (cacheCreationTokens / 1000) * pricing.cacheCreation +
           (cacheReadTokens / 1000) * pricing.cacheRead
  }

  private async loadClaudeData(): Promise<ClaudeLogEntry[]> {
    // Simulate loading from mock file system
    const entries: ClaudeLogEntry[] = []
    
    try {
      const projects = await this.mockFileSystem.readdir('~/.claude/projects')
      
      for (const project of projects) {
        const files = await this.mockFileSystem.readdir(`~/.claude/projects/${project}`)
        
        for (const file of files) {
          if (file.endsWith('.jsonl')) {
            const filePath = `~/.claude/projects/${project}/${file}`
            try {
              const content = await this.mockFileSystem.readFile(filePath)
              const lines = content.trim().split('\n')
              
              for (const line of lines) {
                try {
                  const entry = JSON.parse(line)
                  if (entry.timestamp && entry.type === 'assistant' && entry.message?.usage && entry.message?.id) {
                    entries.push(entry)
                  }
                } catch (error) {
                  // Skip invalid lines
                }
              }
            } catch (error) {
              // Skip files that don't exist
            }
          }
        }
      }
    } catch (error) {
      // No Claude data directory
    }
    
    return entries
  }

  private async loadNewEntries(): Promise<ClaudeLogEntry[]> {
    const allEntries = await this.loadClaudeData()
    
    // Simulate file modification time check and process all files for incremental collection
    // This simulates the behavior in loadClaudeDataIncremental where files with updated mtime are reprocessed
    
    // Filter out already seen messages (don't modify seenMessageIds yet)
    const newEntries = allEntries.filter(entry => {
      return entry.message?.id && !this.seenMessageIds.has(entry.message.id)
    })
    
    // Add new message IDs to seen set
    newEntries.forEach(entry => {
      if (entry.message?.id) {
        this.seenMessageIds.add(entry.message.id)
      }
    })
    
    return newEntries
  }

  private async writeCachedStats(): Promise<void> {
    const records = Array.from(this.cachedHourlyStats.values())
    const content = records.map(record => JSON.stringify(record)).join('\n')
    await this.mockFileSystem.writeFile('~/.ccmonitor/usage-log.jsonl', content)
  }

  // Public accessors for testing
  getCachedStats(): Map<string, HourlyStats> {
    return new Map(this.cachedHourlyStats)
  }

  getSeenMessageIds(): Set<string> {
    return new Set(this.seenMessageIds)
  }

  getCacheSize(): number {
    return this.cachedHourlyStats.size
  }
}

describe('Cache Management Integration', () => {
  let cacheManager: CacheManager
  let mockFileSystem: ReturnType<typeof TestUtils.createMockFileSystem>

  beforeEach(() => {
    mockFileSystem = TestUtils.createMockFileSystem()
    cacheManager = new CacheManager(mockFileSystem)
  })

  describe('Cache Initialization', () => {
    it('should initialize empty cache when no persistent data exists', async () => {
      await cacheManager.initializeCache()
      
      expect(cacheManager.getCacheSize()).toBe(0)
      expect(cacheManager.getSeenMessageIds().size).toBe(0)
    })

    it('should load existing persistent data into cache', async () => {
      // Set up existing persistent data
      const existingStats = [
        TestUtils.createMockHourlyStats({ hour: '2025-01-01 10:00', cost: 0.05 }),
        TestUtils.createMockHourlyStats({ hour: '2025-01-01 11:00', cost: 0.03 })
      ]
      
      const persistentContent = existingStats.map(stat => JSON.stringify(stat)).join('\n')
      mockFileSystem.setMockFile('~/.ccmonitor/usage-log.jsonl', persistentContent)
      
      await cacheManager.initializeCache()
      
      expect(cacheManager.getCacheSize()).toBe(2)
      
      const cachedStats = cacheManager.getCachedStats()
      expect(cachedStats.get('2025-01-01 10:00')?.cost).toBe(0.05)
      expect(cachedStats.get('2025-01-01 11:00')?.cost).toBe(0.03)
    })

    it('should initialize seen message IDs from Claude logs', async () => {
      // Set up mock Claude logs
      const entries = TestUtils.createMockLogEntries(5)
      const logContent = TestUtils.generateJSONLContent(entries)
      
      mockFileSystem.setMockFile('~/.claude/projects/project1/session1.jsonl', logContent)
      
      await cacheManager.initializeCache()
      
      const seenIds = cacheManager.getSeenMessageIds()
      expect(seenIds.size).toBe(5)
      
      entries.forEach(entry => {
        if (entry.message?.id) {
          expect(seenIds.has(entry.message.id)).toBe(true)
        }
      })
    })
  })

  describe('Incremental Collection', () => {
    it('should process new entries and update cache', async () => {
      // Initialize empty cache
      await cacheManager.initializeCache()
      
      // Add new Claude log entries
      const newEntries = TestUtils.createMockLogEntries(3, {
        timeRange: {
          start: new Date('2025-01-01T10:00:00Z'),
          end: new Date('2025-01-01T10:59:59Z')
        }
      })
      
      const logContent = TestUtils.generateJSONLContent(newEntries)
      mockFileSystem.setMockFile('~/.claude/projects/project1/session1.jsonl', logContent)
      
      const processedCount = await cacheManager.collectIncremental()
      
      expect(processedCount).toBe(3)
      expect(cacheManager.getCacheSize()).toBe(1) // All entries in same hour
      
      const cachedStats = cacheManager.getCachedStats()
      const hourStats = cachedStats.get('2025-01-01 10:00')
      
      expect(hourStats).toBeDefined()
      expect(hourStats!.sessionCount).toBe(3)
      expect(hourStats!.inputTokens).toBeGreaterThan(0)
      expect(hourStats!.outputTokens).toBeGreaterThan(0)
      expect(hourStats!.cost).toBeGreaterThan(0)
    })

    it('should ignore duplicate messages', async () => {
      await cacheManager.initializeCache()
      
      // Add initial entries
      const initialEntries = TestUtils.createMockLogEntries(2)
      const initialContent = TestUtils.generateJSONLContent(initialEntries)
      const filePath = '~/.claude/projects/project1/session1.jsonl'
      mockFileSystem.setMockFile(filePath, initialContent)
      
      // Set initial modification time
      const initialTime = new Date('2025-01-01T10:00:00Z')
      mockFileSystem.setMockFileMtime(filePath, initialTime)
      
      const firstRun = await cacheManager.collectIncremental()
      expect(firstRun).toBe(2)
      
      // Add more entries including duplicates
      const newEntry = TestUtils.createMockLogEntry({ 
        message: { 
          id: 'new_msg_001', 
          model: TEST_CONSTANTS.MODELS.SONNET_4,
          usage: {
            input_tokens: 100,
            output_tokens: 50,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0
          }
        } 
      })
      const additionalEntries = [
        initialEntries[0], // Duplicate
        newEntry
      ]
      
      const combinedContent = TestUtils.generateJSONLContent([...initialEntries, ...additionalEntries])
      
      // Set a later modification time BEFORE updating the file content
      const laterTime = new Date('2025-01-01T11:00:00Z')
      mockFileSystem.setMockFile(filePath, combinedContent)
      mockFileSystem.setMockFileMtime(filePath, laterTime)
      
      const secondRun = await cacheManager.collectIncremental()
      expect(secondRun).toBe(1) // Only 1 new entry processed
    })

    it('should aggregate data across multiple hours', async () => {
      await cacheManager.initializeCache()
      
      // Create entries spanning multiple hours
      const entries = [
        TestUtils.createMockLogEntry({ 
          timestamp: '2025-01-01T10:30:00Z',
          message: { id: 'msg_1', model: TEST_CONSTANTS.MODELS.SONNET_4, usage: { input_tokens: 1000, output_tokens: 500 } }
        }),
        TestUtils.createMockLogEntry({ 
          timestamp: '2025-01-01T11:15:00Z',
          message: { id: 'msg_2', model: TEST_CONSTANTS.MODELS.SONNET_4, usage: { input_tokens: 800, output_tokens: 600 } }
        }),
        TestUtils.createMockLogEntry({ 
          timestamp: '2025-01-01T11:45:00Z',
          message: { id: 'msg_3', model: TEST_CONSTANTS.MODELS.SONNET_4, usage: { input_tokens: 1200, output_tokens: 400 } }
        })
      ]
      
      const logContent = TestUtils.generateJSONLContent(entries)
      mockFileSystem.setMockFile('~/.claude/projects/project1/session1.jsonl', logContent)
      
      await cacheManager.collectIncremental()
      
      const cachedStats = cacheManager.getCachedStats()
      expect(cachedStats.size).toBe(2) // Two different hours
      
      const hour10 = cachedStats.get('2025-01-01 10:00')
      const hour11 = cachedStats.get('2025-01-01 11:00')
      
      expect(hour10?.sessionCount).toBe(1)
      expect(hour10?.inputTokens).toBe(1000)
      expect(hour10?.outputTokens).toBe(500)
      
      expect(hour11?.sessionCount).toBe(2)
      expect(hour11?.inputTokens).toBe(2000) // 800 + 1200
      expect(hour11?.outputTokens).toBe(1000) // 600 + 400
    })
  })

  describe('Cache Persistence', () => {
    it('should persist cache data to storage', async () => {
      await cacheManager.initializeCache()
      
      // Add some entries
      const entries = TestUtils.createMockLogEntries(2)
      const logContent = TestUtils.generateJSONLContent(entries)
      mockFileSystem.setMockFile('~/.claude/projects/project1/session1.jsonl', logContent)
      
      await cacheManager.collectIncremental()
      
      // Check that data was written to persistent storage
      const persistentContent = await mockFileSystem.readFile('~/.ccmonitor/usage-log.jsonl')
      const lines = persistentContent.trim().split('\n')
      
      expect(lines.length).toBeGreaterThan(0)
      
      lines.forEach(line => {
        const stats = JSON.parse(line)
        expect(stats).toHaveProperty('hour')
        expect(stats).toHaveProperty('inputTokens')
        expect(stats).toHaveProperty('outputTokens')
        expect(stats).toHaveProperty('cost')
      })
    })

    it('should maintain cache consistency across multiple operations', async () => {
      // Initialize and add first batch
      await cacheManager.initializeCache()
      
      const batch1 = TestUtils.createMockLogEntries(3)
      mockFileSystem.setMockFile('~/.claude/projects/project1/session1.jsonl', TestUtils.generateJSONLContent(batch1))
      
      await cacheManager.collectIncremental()
      const firstCacheState = cacheManager.getCachedStats()
      
      // Add second batch
      const batch2 = TestUtils.createMockLogEntries(2)
      const combinedContent = TestUtils.generateJSONLContent([...batch1, ...batch2])
      mockFileSystem.setMockFile('~/.claude/projects/project1/session1.jsonl', combinedContent)
      
      await cacheManager.collectIncremental()
      const secondCacheState = cacheManager.getCachedStats()
      
      // Verify cache consistency
      firstCacheState.forEach((stats, hour) => {
        const updatedStats = secondCacheState.get(hour)
        if (updatedStats) {
          expect(updatedStats.inputTokens).toBeGreaterThanOrEqual(stats.inputTokens)
          expect(updatedStats.outputTokens).toBeGreaterThanOrEqual(stats.outputTokens)
          expect(updatedStats.sessionCount).toBeGreaterThanOrEqual(stats.sessionCount)
        }
      })
    })
  })

  describe('Performance and Memory', () => {
    it('should handle large cache efficiently', async () => {
      await cacheManager.initializeCache()
      
      // Generate entries over 24 hours (many different hour buckets)
      const entries: ClaudeLogEntry[] = []
      for (let hour = 0; hour < 24; hour++) {
        for (let i = 0; i < 10; i++) {
          const timestamp = new Date('2025-01-01T00:00:00Z')
          timestamp.setHours(hour)
          timestamp.setMinutes(i * 6) // Spread within hour
          
          entries.push(TestUtils.createMockLogEntry({
            timestamp: timestamp.toISOString(),
            message: { 
              id: `msg_${hour}_${i}`, 
              model: TEST_CONSTANTS.MODELS.SONNET_4,
              usage: {
                input_tokens: 100,
                output_tokens: 50,
                cache_creation_input_tokens: 0,
                cache_read_input_tokens: 0
              }
            }
          }))
        }
      }
      
      mockFileSystem.setMockFile('~/.claude/projects/project1/session1.jsonl', TestUtils.generateJSONLContent(entries))
      
      const startTime = Date.now()
      const processedCount = await cacheManager.collectIncremental()
      const processingTime = Date.now() - startTime
      
      expect(processedCount).toBe(240) // 24 hours * 10 entries
      expect(cacheManager.getCacheSize()).toBe(24) // 24 different hours
      expect(processingTime).toBeLessThan(100) // Should be fast
      
      // Verify cache consistency
      const cachedStats = cacheManager.getCachedStats()
      cachedStats.forEach((stats) => {
        expect(stats.sessionCount).toBe(10)
        expect(stats.avgInputPerSession).toBeGreaterThan(0)
        expect(stats.avgOutputPerSession).toBeGreaterThan(0)
      })
    })

    it('should handle cache reinitialization correctly', async () => {
      // Initialize and populate cache
      await cacheManager.initializeCache()
      
      const entries = TestUtils.createMockLogEntries(5)
      mockFileSystem.setMockFile('~/.claude/projects/project1/session1.jsonl', TestUtils.generateJSONLContent(entries))
      
      await cacheManager.collectIncremental()
      const originalCacheSize = cacheManager.getCacheSize()
      
      // Reinitialize cache (simulating restart)
      await cacheManager.initializeCache()
      
      // Should load from persistent storage
      expect(cacheManager.getCacheSize()).toBe(originalCacheSize)
      
      // Should have same message IDs marked as seen
      const seenIds = cacheManager.getSeenMessageIds()
      entries.forEach(entry => {
        if (entry.message?.id) {
          expect(seenIds.has(entry.message.id)).toBe(true)
        }
      })
    })
  })

  describe('Error Handling', () => {
    it('should handle corrupted persistent data gracefully', async () => {
      // Set corrupted persistent data
      mockFileSystem.setMockFile('~/.ccmonitor/usage-log.jsonl', 'invalid json\n{corrupted')
      
      // Should not throw error
      await expect(cacheManager.initializeCache()).resolves.not.toThrow()
      
      // Should start with empty cache
      expect(cacheManager.getCacheSize()).toBe(0)
    })

    it('should handle missing Claude log files gracefully', async () => {
      await cacheManager.initializeCache()
      
      // collectIncremental should handle missing files
      const processedCount = await cacheManager.collectIncremental()
      expect(processedCount).toBe(0)
      expect(cacheManager.getCacheSize()).toBe(0)
    })

    it('should handle malformed log entries', async () => {
      await cacheManager.initializeCache()
      
      // Mix valid and invalid entries
      const validEntry = TestUtils.createMockLogEntry()
      const logContent = [
        JSON.stringify(validEntry),
        'invalid json line',
        '{"incomplete": "entry"}',
        JSON.stringify({ type: 'invalid', message: null })
      ].join('\n')
      
      mockFileSystem.setMockFile('~/.claude/projects/project1/session1.jsonl', logContent)
      
      // Should process only valid entries
      const processedCount = await cacheManager.collectIncremental()
      expect(processedCount).toBe(1) // Only the valid entry
    })
  })
})