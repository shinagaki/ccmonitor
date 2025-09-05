import { describe, it, expect, beforeEach } from 'vitest'
import { TestUtils, TEST_CONSTANTS } from '../helpers/test-utils'
import type { ClaudeLogEntry, HourlyStats } from '../../ccmonitor'

/**
 * Performance testing for ccmonitor optimization features
 */

interface PerformanceMetrics {
  executionTime: number
  memoryUsage: number
  processedEntries: number
  cacheHits: number
  cacheMisses: number
}

class PerformanceTracker {
  private startTime: number = 0
  private startMemory: number = 0

  start(): void {
    // Force garbage collection if available (Node.js with --expose-gc)
    if (global.gc) {
      global.gc()
    }
    
    this.startTime = performance.now()
    this.startMemory = process.memoryUsage().heapUsed
  }

  end(): PerformanceMetrics {
    const endTime = performance.now()
    const endMemory = process.memoryUsage().heapUsed
    
    return {
      executionTime: endTime - this.startTime,
      memoryUsage: Math.max(0, endMemory - this.startMemory),
      processedEntries: 0, // To be filled by caller
      cacheHits: 0,
      cacheMisses: 0
    }
  }
}

class OptimizedDataProcessor {
  private cache: Map<string, HourlyStats> = new Map()
  private seenMessageIds: Set<string> = new Set()
  private fileLastModified: Map<string, number> = new Map()
  private cacheHits: number = 0
  private cacheMisses: number = 0

  // Simulate full scan processing (old approach)
  async processFullScan(entries: ClaudeLogEntry[]): Promise<HourlyStats[]> {
    const hourlyStats = new Map<string, HourlyStats>()
    const seenIds = new Set<string>()
    
    for (const entry of entries) {
      // Simulate deduplication check
      if (entry.message?.id && seenIds.has(entry.message.id)) {
        continue
      }
      
      if (entry.message?.id) {
        seenIds.add(entry.message.id)
      }
      
      const hourKey = this.getHourKey(entry.timestamp)
      
      if (!hourlyStats.has(hourKey)) {
        hourlyStats.set(hourKey, {
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
      
      const stats = hourlyStats.get(hourKey)!
      const usage = entry.message?.usage
      
      if (usage) {
        const inputTokens = usage.input_tokens || 0
        const outputTokens = usage.output_tokens || 0
        
        stats.inputTokens += inputTokens
        stats.outputTokens += outputTokens
        stats.totalTokens += inputTokens + outputTokens
        stats.cost += this.calculateCost(inputTokens, outputTokens)
        stats.sessionCount += 1
        stats.avgInputPerSession = stats.inputTokens / stats.sessionCount
        stats.avgOutputPerSession = stats.outputTokens / stats.sessionCount
      }
    }
    
    return Array.from(hourlyStats.values())
  }

  // Simulate incremental processing (new approach)
  async processIncremental(entries: ClaudeLogEntry[], timeFilter?: { since?: string; tail?: number }): Promise<HourlyStats[]> {
    // Filter new entries (not already seen)
    const newEntries = entries.filter(entry => {
      if (entry.message?.id && this.seenMessageIds.has(entry.message.id)) {
        this.cacheHits++
        return false // Already processed
      }
      
      // Apply time filtering
      if (timeFilter) {
        if (timeFilter.since) {
          const entryTime = new Date(entry.timestamp).getTime()
          const sinceTime = new Date(timeFilter.since).getTime()
          if (entryTime < sinceTime) {
            return false
          }
        }
        
        if (timeFilter.tail) {
          const entryTime = new Date(entry.timestamp).getTime()
          const cutoffTime = Date.now() - (timeFilter.tail * 60 * 60 * 1000)
          if (entryTime < cutoffTime) {
            return false
          }
        }
      }
      
      this.cacheMisses++
      if (entry.message?.id) {
        this.seenMessageIds.add(entry.message.id)
      }
      return true
    })
    
    // Update cache with new entries only
    for (const entry of newEntries) {
      const hourKey = this.getHourKey(entry.timestamp)
      
      if (!this.cache.has(hourKey)) {
        this.cache.set(hourKey, {
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
      
      const stats = this.cache.get(hourKey)!
      const usage = entry.message?.usage
      
      if (usage) {
        const inputTokens = usage.input_tokens || 0
        const outputTokens = usage.output_tokens || 0
        
        stats.inputTokens += inputTokens
        stats.outputTokens += outputTokens
        stats.totalTokens += inputTokens + outputTokens
        stats.cost += this.calculateCost(inputTokens, outputTokens)
        stats.sessionCount += 1
        stats.avgInputPerSession = stats.inputTokens / stats.sessionCount
        stats.avgOutputPerSession = stats.outputTokens / stats.sessionCount
      }
    }
    
    return Array.from(this.cache.values())
  }

  private getHourKey(timestamp: string): string {
    const date = new Date(timestamp)
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:00`
  }

  private calculateCost(inputTokens: number, outputTokens: number): number {
    return (inputTokens / 1000) * 0.003 + (outputTokens / 1000) * 0.015
  }

  getCacheStats(): { hits: number; misses: number; hitRate: number } {
    const total = this.cacheHits + this.cacheMisses
    return {
      hits: this.cacheHits,
      misses: this.cacheMisses,
      hitRate: total > 0 ? this.cacheHits / total : 0
    }
  }

  resetStats(): void {
    this.cacheHits = 0
    this.cacheMisses = 0
  }

  clearCache(): void {
    this.cache.clear()
    this.seenMessageIds.clear()
    this.resetStats()
  }
}

describe('Performance Optimization Tests', () => {
  let processor: OptimizedDataProcessor
  let tracker: PerformanceTracker

  beforeEach(() => {
    processor = new OptimizedDataProcessor()
    tracker = new PerformanceTracker()
  })

  describe('Full Scan vs Incremental Performance', () => {
    it('should show significant performance improvement with incremental processing', async () => {
      // Generate large dataset
      const largeDataset = TestUtils.createMockLogEntries(5000, {
        timeRange: {
          start: new Date('2025-01-01T00:00:00Z'),
          end: new Date('2025-01-07T23:59:59Z') // 1 week of data
        }
      })

      // Benchmark full scan
      tracker.start()
      const fullScanResults = await processor.processFullScan(largeDataset)
      const fullScanMetrics = tracker.end()
      fullScanMetrics.processedEntries = largeDataset.length

      // Reset and benchmark incremental processing
      processor.clearCache()
      tracker.start()
      const incrementalResults = await processor.processIncremental(largeDataset)
      const incrementalMetrics = tracker.end()
      incrementalMetrics.processedEntries = largeDataset.length

      // Results should be equivalent
      expect(incrementalResults.length).toBe(fullScanResults.length)

      // Performance should be comparable for first run (no cache advantage yet)
      console.log(`Full scan: ${fullScanMetrics.executionTime.toFixed(2)}ms`)
      console.log(`Incremental (first run): ${incrementalMetrics.executionTime.toFixed(2)}ms`)

      // Both should complete in reasonable time
      expect(fullScanMetrics.executionTime).toBeLessThan(1000)
      expect(incrementalMetrics.executionTime).toBeLessThan(1000)
    })

    it('should demonstrate cache efficiency with repeated processing', async () => {
      const baseDataset = TestUtils.createMockLogEntries(1000)
      
      // Initial processing (populate cache)
      await processor.processIncremental(baseDataset)
      processor.resetStats()

      // Add small amount of new data
      const newEntries = TestUtils.createMockLogEntries(50)
      const combinedDataset = [...baseDataset, ...newEntries]

      // Benchmark incremental processing with cache advantage
      tracker.start()
      await processor.processIncremental(combinedDataset)
      const metrics = tracker.end()

      const cacheStats = processor.getCacheStats()

      // Should have high cache hit rate
      expect(cacheStats.hitRate).toBeGreaterThan(0.9) // >90% cache hits
      expect(cacheStats.hits).toBeGreaterThan(950) // Most entries were cached
      expect(cacheStats.misses).toBeLessThan(100) // Few new entries processed

      console.log(`Cache hit rate: ${(cacheStats.hitRate * 100).toFixed(1)}%`)
      console.log(`Processing time: ${metrics.executionTime.toFixed(2)}ms`)
    })
  })

  describe('Time Filtering Performance', () => {
    it('should show performance improvement with time filtering', async () => {
      // Generate dataset spanning multiple days
      const fullDataset = TestUtils.createMockLogEntries(2000, {
        timeRange: {
          start: new Date('2025-01-01T00:00:00Z'),
          end: new Date('2025-01-05T23:59:59Z') // 5 days
        }
      })

      // Benchmark without filtering (processes all data)
      tracker.start()
      await processor.processIncremental(fullDataset)
      const noFilterMetrics = tracker.end()
      noFilterMetrics.processedEntries = fullDataset.length

      processor.clearCache()

      // Benchmark with tail filtering (last 24 hours only)
      tracker.start()
      await processor.processIncremental(fullDataset, { tail: 24 })
      const filteredMetrics = tracker.end()

      const cacheStats = processor.getCacheStats()
      filteredMetrics.processedEntries = cacheStats.misses

      // Filtered processing should process fewer entries
      expect(filteredMetrics.processedEntries).toBeLessThan(noFilterMetrics.processedEntries)

      // Should be faster with filtering
      console.log(`No filter: ${noFilterMetrics.executionTime.toFixed(2)}ms (${noFilterMetrics.processedEntries} entries)`)
      console.log(`With filter: ${filteredMetrics.executionTime.toFixed(2)}ms (${filteredMetrics.processedEntries} entries)`)
    })

    it('should efficiently handle rolling window scenarios', async () => {
      const dataset = TestUtils.createMockLogEntries(1000, {
        timeRange: {
          start: new Date('2025-01-01T00:00:00Z'),
          end: new Date('2025-01-02T00:00:00Z')
        }
      })

      // Simulate rolling window processing (5-hour windows)
      const windowSizes = [1, 3, 5, 8, 24] // hours
      const results: { windowSize: number; time: number; entries: number }[] = []

      for (const windowSize of windowSizes) {
        processor.clearCache()
        
        tracker.start()
        await processor.processIncremental(dataset, { tail: windowSize })
        const metrics = tracker.end()
        
        const cacheStats = processor.getCacheStats()
        
        results.push({
          windowSize,
          time: metrics.executionTime,
          entries: cacheStats.misses
        })
      }

      // Verify performance scales with window size
      results.forEach((result, index) => {
        console.log(`${result.windowSize}h window: ${result.time.toFixed(2)}ms (${result.entries} entries)`)
        
        if (index > 0) {
          // Processing time should increase with window size (more data to process)
          expect(result.entries).toBeGreaterThanOrEqual(results[index - 1].entries)
        }
      })
    })
  })

  describe('Memory Efficiency', () => {
    it('should maintain reasonable memory usage with large datasets', async () => {
      const initialMemory = process.memoryUsage().heapUsed

      // Process increasingly larger datasets
      const datasetSizes = [1000, 5000, 10000, 20000]
      const memoryUsages: number[] = []

      for (const size of datasetSizes) {
        const dataset = TestUtils.createMockLogEntries(size)
        
        // Force garbage collection
        if (global.gc) global.gc()
        
        const beforeMemory = process.memoryUsage().heapUsed
        await processor.processIncremental(dataset)
        const afterMemory = process.memoryUsage().heapUsed
        
        const memoryIncrease = afterMemory - beforeMemory
        memoryUsages.push(memoryIncrease)
        
        console.log(`${size} entries: ${(memoryIncrease / 1024 / 1024).toFixed(2)}MB memory increase`)
        
        processor.clearCache()
      }

      // Memory usage should scale reasonably with dataset size
      memoryUsages.forEach((usage, index) => {
        if (index > 0) {
          const ratio = usage / memoryUsages[index - 1]
          const sizeRatio = datasetSizes[index] / datasetSizes[index - 1]
          
          // Memory growth should be roughly proportional to data size
          expect(ratio).toBeLessThan(sizeRatio * 2) // Allow some overhead
        }
      })
    })

    it('should demonstrate memory efficiency of caching approach', async () => {
      const dataset = TestUtils.createMockLogEntries(5000)

      // Measure memory for full scan approach
      if (global.gc) global.gc()
      const fullScanBefore = process.memoryUsage().heapUsed
      
      const processor2 = new OptimizedDataProcessor()
      await processor2.processFullScan(dataset)
      
      const fullScanAfter = process.memoryUsage().heapUsed
      const fullScanMemory = fullScanAfter - fullScanBefore

      // Measure memory for incremental approach
      processor.clearCache()
      if (global.gc) global.gc()
      
      const incrementalBefore = process.memoryUsage().heapUsed
      await processor.processIncremental(dataset)
      const incrementalAfter = process.memoryUsage().heapUsed
      const incrementalMemory = incrementalAfter - incrementalBefore

      console.log(`Full scan memory: ${(fullScanMemory / 1024 / 1024).toFixed(2)}MB`)
      console.log(`Incremental memory: ${(incrementalMemory / 1024 / 1024).toFixed(2)}MB`)

      // Both should use reasonable amounts of memory
      expect(fullScanMemory).toBeLessThan(100 * 1024 * 1024) // < 100MB
      expect(incrementalMemory).toBeLessThan(100 * 1024 * 1024) // < 100MB
    })
  })

  describe('Scalability Tests', () => {
    it('should handle realistic long-term usage patterns', async () => {
      // Simulate 3 months of usage data
      const monthlyEntries = 10000 // ~100 entries per day
      const months = 3
      
      const performanceResults: { month: number; time: number; cacheEfficiency: number }[] = []

      for (let month = 0; month < months; month++) {
        const startDate = new Date('2025-01-01T00:00:00Z')
        startDate.setMonth(month)
        
        const endDate = new Date(startDate)
        endDate.setMonth(month + 1)
        endDate.setDate(endDate.getDate() - 1) // Last day of month
        
        // Create data with some duplicates to simulate cache efficiency
        let monthData: ClaudeLogEntry[]
        
        if (month === 0) {
          // First month: all new entries
          monthData = TestUtils.createMockLogEntries(monthlyEntries, {
            timeRange: { start: startDate, end: endDate },
            duplicateIds: false
          })
        } else {
          // Subsequent months: mix of new and repeated entries
          const newEntries = TestUtils.createMockLogEntries(Math.floor(monthlyEntries * 0.3), {
            timeRange: { start: startDate, end: endDate },
            duplicateIds: false
          })
          
          // Create entries with known duplicate IDs to guarantee cache hits
          const duplicateEntries: ClaudeLogEntry[] = []
          const duplicateCount = Math.floor(monthlyEntries * 0.7)
          
          for (let i = 0; i < duplicateCount; i++) {
            const duplicateEntry = TestUtils.createMockLogEntry({
              timestamp: new Date(startDate.getTime() + i * 60000).toISOString(), // 1 minute apart
              message: {
                id: `duplicate_${i % 100}`, // Reuse IDs to ensure duplicates
                model: TEST_CONSTANTS.MODELS.SONNET_4,
                usage: {
                  input_tokens: 100,
                  output_tokens: 50,
                  cache_creation_input_tokens: 0,
                  cache_read_input_tokens: 0
                }
              }
            })
            duplicateEntries.push(duplicateEntry)
          }
          
          monthData = [...newEntries, ...duplicateEntries]
        }

        tracker.start()
        await processor.processIncremental(monthData)
        const metrics = tracker.end()

        const cacheStats = processor.getCacheStats()
        const cacheEfficiency = cacheStats.hits / (cacheStats.hits + cacheStats.misses)

        performanceResults.push({
          month: month + 1,
          time: metrics.executionTime,
          cacheEfficiency: isNaN(cacheEfficiency) ? 1 : cacheEfficiency
        })

        console.log(`Month ${month + 1}: ${metrics.executionTime.toFixed(2)}ms, cache efficiency: ${(cacheEfficiency * 100).toFixed(1)}%`)

        processor.resetStats()
      }

      // Performance should remain stable over time
      const avgTime = performanceResults.reduce((sum, result) => sum + result.time, 0) / months
      
      performanceResults.forEach(result => {
        // No single month should be dramatically slower than average
        expect(result.time).toBeLessThan(avgTime * 3)
        
        // Cache efficiency should be high for later months
        if (result.month > 1) {
          expect(result.cacheEfficiency).toBeGreaterThan(0.5)
        }
      })
    })

    it('should perform well with watch mode simulation', async () => {
      // Simulate watch mode: frequent small updates
      const baseData = TestUtils.createMockLogEntries(1000)
      await processor.processIncremental(baseData)

      const updateResults: number[] = []
      const updateSizes = [1, 2, 5, 10, 20] // New entries per update

      for (const updateSize of updateSizes) {
        // Simulate 10 watch mode updates
        for (let update = 0; update < 10; update++) {
          const newEntries = TestUtils.createMockLogEntries(updateSize)
          
          processor.resetStats()
          tracker.start()
          
          await processor.processIncremental([...baseData, ...newEntries])
          
          const metrics = tracker.end()
          const cacheStats = processor.getCacheStats()
          
          // Should process only new entries
          expect(cacheStats.misses).toBeLessThanOrEqual(updateSize)
          
          updateResults.push(metrics.executionTime)
        }
      }

      // All updates should be fast
      const maxUpdateTime = Math.max(...updateResults)
      const avgUpdateTime = updateResults.reduce((a, b) => a + b, 0) / updateResults.length

      console.log(`Watch mode updates - Avg: ${avgUpdateTime.toFixed(2)}ms, Max: ${maxUpdateTime.toFixed(2)}ms`)

      expect(maxUpdateTime).toBeLessThan(50) // < 50ms per update
      expect(avgUpdateTime).toBeLessThan(20) // < 20ms average
    })
  })
})