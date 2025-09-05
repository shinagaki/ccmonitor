import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { TestUtils, TEST_CONSTANTS } from '../helpers/test-utils'

/**
 * getHourKey function extracted for testing
 * This mirrors the logic in ccmonitor.ts
 */
function getHourKey(timestamp: string): string {
  const date = new Date(timestamp)
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')} ${String(date.getUTCHours()).padStart(2, '0')}:00`
}

/**
 * Time filtering utilities for testing
 */
function isWithinTimeRange(timestamp: string, since?: string, until?: string): boolean {
  const time = new Date(timestamp).getTime()
  
  if (since && time < new Date(since).getTime()) {
    return false
  }
  
  if (until && time > new Date(until).getTime()) {
    return false
  }
  
  return true
}

function isWithinTailHours(timestamp: string, tailHours: number, referenceTime: Date = new Date()): boolean {
  const time = new Date(timestamp).getTime()
  const cutoffTime = referenceTime.getTime() - (tailHours * 60 * 60 * 1000)
  return time >= cutoffTime
}

describe('Time Utilities', () => {
  let timeMock: ReturnType<typeof TestUtils.mockTime>

  beforeEach(() => {
    // Mock time to ensure consistent test results
    timeMock = TestUtils.mockTime(new Date('2025-01-01T12:30:45Z'))
  })

  afterEach(() => {
    timeMock.restore()
  })

  describe('getHourKey', () => {
    it('should format hour key correctly for standard time', () => {
      const timestamp = '2025-01-01T14:30:45Z'
      const hourKey = getHourKey(timestamp)
      
      expect(hourKey).toBe('2025-01-01 14:00')
    })

    it('should format hour key correctly for different months', () => {
      const testCases = [
        { timestamp: '2025-01-15T09:15:30Z', expected: '2025-01-15 09:00' },
        { timestamp: '2025-02-28T23:45:00Z', expected: '2025-02-28 23:00' },
        { timestamp: '2025-12-31T00:05:12Z', expected: '2025-12-31 00:00' }
      ]

      testCases.forEach(({ timestamp, expected }) => {
        expect(getHourKey(timestamp)).toBe(expected)
      })
    })

    it('should handle zero-padding correctly', () => {
      const testCases = [
        { timestamp: '2025-01-01T01:30:45Z', expected: '2025-01-01 01:00' },
        { timestamp: '2025-01-05T09:15:30Z', expected: '2025-01-05 09:00' },
        { timestamp: '2025-09-09T09:45:00Z', expected: '2025-09-09 09:00' }
      ]

      testCases.forEach(({ timestamp, expected }) => {
        expect(getHourKey(timestamp)).toBe(expected)
      })
    })

    it('should handle edge cases at hour boundaries', () => {
      const testCases = [
        { timestamp: '2025-01-01T14:00:00Z', expected: '2025-01-01 14:00' },
        { timestamp: '2025-01-01T14:59:59Z', expected: '2025-01-01 14:00' },
        { timestamp: '2025-01-01T15:00:00Z', expected: '2025-01-01 15:00' }
      ]

      testCases.forEach(({ timestamp, expected }) => {
        expect(getHourKey(timestamp)).toBe(expected)
      })
    })

    it('should handle different years correctly', () => {
      const testCases = [
        { timestamp: '2024-12-31T23:30:45Z', expected: '2024-12-31 23:00' },
        { timestamp: '2025-01-01T00:30:45Z', expected: '2025-01-01 00:00' },
        { timestamp: '2026-06-15T12:30:45Z', expected: '2026-06-15 12:00' }
      ]

      testCases.forEach(({ timestamp, expected }) => {
        expect(getHourKey(timestamp)).toBe(expected)
      })
    })

    it('should handle leap year correctly', () => {
      const timestamp = '2024-02-29T15:30:45Z' // 2024 is a leap year
      const hourKey = getHourKey(timestamp)
      
      expect(hourKey).toBe('2024-02-29 15:00')
    })

    it('should handle timezone-aware timestamps', () => {
      // All timestamps should be processed in UTC
      const testCases = [
        { timestamp: '2025-01-01T14:30:45Z', expected: '2025-01-01 14:00' },
        { timestamp: '2025-01-01T14:30:45.123Z', expected: '2025-01-01 14:00' },
        { timestamp: '2025-01-01T14:30:45+00:00', expected: '2025-01-01 14:00' }
      ]

      testCases.forEach(({ timestamp, expected }) => {
        expect(getHourKey(timestamp)).toBe(expected)
      })
    })

    it('should produce consistent results for same hour', () => {
      const timestamps = [
        '2025-01-01T14:00:00Z',
        '2025-01-01T14:15:30Z',
        '2025-01-01T14:30:45Z',
        '2025-01-01T14:45:12Z',
        '2025-01-01T14:59:59Z'
      ]

      const hourKeys = timestamps.map(getHourKey)
      const uniqueKeys = new Set(hourKeys)

      expect(uniqueKeys.size).toBe(1)
      expect(hourKeys[0]).toBe('2025-01-01 14:00')
    })
  })

  describe('Time Range Filtering', () => {
    describe('isWithinTimeRange', () => {
      it('should handle since parameter correctly', () => {
        const since = '2025-01-01T12:00:00Z'
        
        expect(isWithinTimeRange('2025-01-01T11:59:59Z', since)).toBe(false)
        expect(isWithinTimeRange('2025-01-01T12:00:00Z', since)).toBe(true)
        expect(isWithinTimeRange('2025-01-01T12:00:01Z', since)).toBe(true)
        expect(isWithinTimeRange('2025-01-01T15:30:45Z', since)).toBe(true)
      })

      it('should handle until parameter correctly', () => {
        const until = '2025-01-01T18:00:00Z'
        
        expect(isWithinTimeRange('2025-01-01T15:30:45Z', undefined, until)).toBe(true)
        expect(isWithinTimeRange('2025-01-01T18:00:00Z', undefined, until)).toBe(true)
        expect(isWithinTimeRange('2025-01-01T18:00:01Z', undefined, until)).toBe(false)
        expect(isWithinTimeRange('2025-01-01T20:00:00Z', undefined, until)).toBe(false)
      })

      it('should handle both since and until parameters', () => {
        const since = '2025-01-01T12:00:00Z'
        const until = '2025-01-01T18:00:00Z'
        
        expect(isWithinTimeRange('2025-01-01T11:59:59Z', since, until)).toBe(false)
        expect(isWithinTimeRange('2025-01-01T12:00:00Z', since, until)).toBe(true)
        expect(isWithinTimeRange('2025-01-01T15:30:45Z', since, until)).toBe(true)
        expect(isWithinTimeRange('2025-01-01T18:00:00Z', since, until)).toBe(true)
        expect(isWithinTimeRange('2025-01-01T18:00:01Z', since, until)).toBe(false)
      })

      it('should return true when no filters applied', () => {
        expect(isWithinTimeRange('2025-01-01T15:30:45Z')).toBe(true)
        expect(isWithinTimeRange('2020-01-01T00:00:00Z')).toBe(true)
        expect(isWithinTimeRange('2030-12-31T23:59:59Z')).toBe(true)
      })
    })

    describe('isWithinTailHours', () => {
      it('should handle tail filtering correctly', () => {
        const referenceTime = new Date('2025-01-01T15:00:00Z')
        
        // Within 2 hours
        expect(isWithinTailHours('2025-01-01T14:30:00Z', 2, referenceTime)).toBe(true)
        expect(isWithinTailHours('2025-01-01T13:00:01Z', 2, referenceTime)).toBe(true)
        
        // Exactly at boundary
        expect(isWithinTailHours('2025-01-01T13:00:00Z', 2, referenceTime)).toBe(true)
        
        // Outside boundary
        expect(isWithinTailHours('2025-01-01T12:59:59Z', 2, referenceTime)).toBe(false)
      })

      it('should handle different tail values', () => {
        const referenceTime = new Date('2025-01-01T12:00:00Z')
        const timestamp = '2025-01-01T10:30:00Z'
        
        expect(isWithinTailHours(timestamp, 1, referenceTime)).toBe(false) // 1.5 hours ago
        expect(isWithinTailHours(timestamp, 2, referenceTime)).toBe(true)  // Within 2 hours
        expect(isWithinTailHours(timestamp, 3, referenceTime)).toBe(true)  // Within 3 hours
      })

      it('should handle zero tail hours', () => {
        const referenceTime = new Date('2025-01-01T12:00:00Z')
        
        expect(isWithinTailHours('2025-01-01T12:00:00Z', 0, referenceTime)).toBe(true)
        expect(isWithinTailHours('2025-01-01T11:59:59Z', 0, referenceTime)).toBe(false)
      })

      it('should use current time as default reference', () => {
        // Mock current time
        timeMock.setTime(new Date('2025-01-01T15:00:00Z'))
        
        expect(isWithinTailHours('2025-01-01T14:30:00Z', 1)).toBe(true)
        expect(isWithinTailHours('2025-01-01T13:30:00Z', 1)).toBe(false)
      })
    })
  })

  describe('Time Aggregation Scenarios', () => {
    it('should group timestamps into correct hourly buckets', () => {
      const timestamps = TEST_CONSTANTS.SAMPLE_TIMESTAMPS
      const hourKeys = timestamps.map(getHourKey)
      
      expect(hourKeys).toEqual([
        '2025-01-01 09:00',
        '2025-01-01 10:00',
        '2025-01-01 14:00',
        '2025-01-01 16:00',
        '2025-01-01 20:00'
      ])
      
      // Should create unique buckets for each hour
      const uniqueKeys = new Set(hourKeys)
      expect(uniqueKeys.size).toBe(5)
    })

    it('should handle sparse time data correctly', () => {
      const sparseTimestamps = [
        '2025-01-01T01:15:00Z',
        '2025-01-01T05:30:00Z',
        '2025-01-01T23:45:00Z'
      ]
      
      const hourKeys = sparseTimestamps.map(getHourKey)
      
      expect(hourKeys).toEqual([
        '2025-01-01 01:00',
        '2025-01-01 05:00',
        '2025-01-01 23:00'
      ])
    })

    it('should handle cross-day boundaries correctly', () => {
      const crossDayTimestamps = [
        '2025-01-01T23:30:00Z',
        '2025-01-02T00:15:00Z',
        '2025-01-02T01:00:00Z'
      ]
      
      const hourKeys = crossDayTimestamps.map(getHourKey)
      
      expect(hourKeys).toEqual([
        '2025-01-01 23:00',
        '2025-01-02 00:00',
        '2025-01-02 01:00'
      ])
    })
  })

  describe('Performance Considerations', () => {
    it('should handle large numbers of timestamps efficiently', () => {
      const startTime = Date.now()
      
      // Generate 10,000 timestamps
      const timestamps: string[] = []
      for (let i = 0; i < 10000; i++) {
        const time = new Date('2025-01-01T00:00:00Z')
        time.setMinutes(i * 6) // Every 6 minutes for 10,000 entries
        timestamps.push(time.toISOString())
      }
      
      // Process all timestamps
      const hourKeys = timestamps.map(getHourKey)
      
      const endTime = Date.now()
      const processingTime = endTime - startTime
      
      // Should process 10,000 timestamps in reasonable time (< 100ms)
      expect(processingTime).toBeLessThan(100)
      expect(hourKeys).toHaveLength(10000)
      
      // Verify unique hour buckets were created
      const uniqueHours = new Set(hourKeys)
      expect(uniqueHours.size).toBeGreaterThanOrEqual(1000) // Should span many hours
    })

    it('should produce consistent results for repeated calls', () => {
      const timestamp = '2025-01-01T14:30:45Z'
      const results = []
      
      // Call function 1000 times
      for (let i = 0; i < 1000; i++) {
        results.push(getHourKey(timestamp))
      }
      
      // All results should be identical
      const uniqueResults = new Set(results)
      expect(uniqueResults.size).toBe(1)
      expect(results[0]).toBe('2025-01-01 14:00')
    })
  })
})