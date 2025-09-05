import { describe, it, expect, beforeEach } from 'vitest'
import { TestUtils, TEST_CONSTANTS } from '../helpers/test-utils'
import type { ClaudeLogEntry } from '../../ccmonitor'

/**
 * Message deduplication logic for testing
 */
class MessageDeduplicator {
  private seenMessageIds: Set<string> = new Set()

  addMessage(messageId: string): boolean {
    if (this.seenMessageIds.has(messageId)) {
      return false // Duplicate
    }
    this.seenMessageIds.add(messageId)
    return true // New message
  }

  hasMessage(messageId: string): boolean {
    return this.seenMessageIds.has(messageId)
  }

  getSeenCount(): number {
    return this.seenMessageIds.size
  }

  clear(): void {
    this.seenMessageIds.clear()
  }

  static processEntries(entries: ClaudeLogEntry[]): ClaudeLogEntry[] {
    const deduplicator = new MessageDeduplicator()
    return entries.filter(entry => {
      if (entry.message?.id) {
        return deduplicator.addMessage(entry.message.id)
      }
      return true // Keep entries without message ID
    })
  }
}

describe('Message Deduplication', () => {
  let deduplicator: MessageDeduplicator

  beforeEach(() => {
    deduplicator = new MessageDeduplicator()
  })

  describe('Basic Deduplication', () => {
    it('should accept new message IDs', () => {
      const messageId = 'msg_12345'
      const result = deduplicator.addMessage(messageId)
      
      expect(result).toBe(true)
      expect(deduplicator.hasMessage(messageId)).toBe(true)
      expect(deduplicator.getSeenCount()).toBe(1)
    })

    it('should reject duplicate message IDs', () => {
      const messageId = 'msg_12345'
      
      // First addition should succeed
      expect(deduplicator.addMessage(messageId)).toBe(true)
      
      // Second addition should fail (duplicate)
      expect(deduplicator.addMessage(messageId)).toBe(false)
      
      expect(deduplicator.hasMessage(messageId)).toBe(true)
      expect(deduplicator.getSeenCount()).toBe(1)
    })

    it('should handle multiple unique message IDs', () => {
      const messageIds = ['msg_001', 'msg_002', 'msg_003']
      
      messageIds.forEach(id => {
        expect(deduplicator.addMessage(id)).toBe(true)
      })
      
      expect(deduplicator.getSeenCount()).toBe(3)
      
      messageIds.forEach(id => {
        expect(deduplicator.hasMessage(id)).toBe(true)
      })
    })

    it('should handle mixed unique and duplicate IDs', () => {
      const operations = [
        { id: 'msg_001', expected: true },
        { id: 'msg_002', expected: true },
        { id: 'msg_001', expected: false }, // Duplicate
        { id: 'msg_003', expected: true },
        { id: 'msg_002', expected: false }, // Duplicate
        { id: 'msg_004', expected: true }
      ]

      operations.forEach(({ id, expected }) => {
        expect(deduplicator.addMessage(id)).toBe(expected)
      })

      expect(deduplicator.getSeenCount()).toBe(4) // Only unique messages
    })
  })

  describe('Entry Processing', () => {
    it('should filter out duplicate entries', () => {
      const entries = [
        TestUtils.createMockLogEntry({ message: { id: 'msg_001', model: TEST_CONSTANTS.MODELS.SONNET_4 } }),
        TestUtils.createMockLogEntry({ message: { id: 'msg_002', model: TEST_CONSTANTS.MODELS.SONNET_4 } }),
        TestUtils.createMockLogEntry({ message: { id: 'msg_001', model: TEST_CONSTANTS.MODELS.SONNET_4 } }), // Duplicate
        TestUtils.createMockLogEntry({ message: { id: 'msg_003', model: TEST_CONSTANTS.MODELS.SONNET_4 } })
      ]

      const deduplicated = MessageDeduplicator.processEntries(entries)
      
      expect(deduplicated).toHaveLength(3)
      
      const ids = deduplicated.map(entry => entry.message?.id)
      expect(ids).toEqual(['msg_001', 'msg_002', 'msg_003'])
    })

    it('should preserve entries without message IDs', () => {
      const entries = [
        TestUtils.createMockLogEntry({ message: { id: 'msg_001', model: TEST_CONSTANTS.MODELS.SONNET_4 } }),
        TestUtils.createMockLogEntry({ message: undefined }), // No message
        TestUtils.createMockLogEntry({ message: { model: TEST_CONSTANTS.MODELS.SONNET_4 } }), // No ID
        TestUtils.createMockLogEntry({ message: { id: 'msg_002', model: TEST_CONSTANTS.MODELS.SONNET_4 } })
      ]

      const deduplicated = MessageDeduplicator.processEntries(entries)
      
      expect(deduplicated).toHaveLength(4) // All entries should be preserved
    })

    it('should handle entries with same content but different IDs', () => {
      const entries = [
        TestUtils.createMockLogEntry({
          message: { id: 'msg_001', model: TEST_CONSTANTS.MODELS.SONNET_4 },
          timestamp: '2025-01-01T12:00:00Z'
        }),
        TestUtils.createMockLogEntry({
          message: { id: 'msg_002', model: TEST_CONSTANTS.MODELS.SONNET_4 },
          timestamp: '2025-01-01T12:00:00Z' // Same timestamp, different ID
        })
      ]

      const deduplicated = MessageDeduplicator.processEntries(entries)
      
      expect(deduplicated).toHaveLength(2) // Both should be kept (different IDs)
    })
  })

  describe('Large Scale Deduplication', () => {
    it('should handle large numbers of messages efficiently', () => {
      const startTime = Date.now()
      
      // Generate 10,000 unique message IDs
      const messageIds: string[] = []
      for (let i = 0; i < 10000; i++) {
        messageIds.push(`msg_${i.toString().padStart(6, '0')}`)
      }

      // Add all messages
      let acceptedCount = 0
      messageIds.forEach(id => {
        if (deduplicator.addMessage(id)) {
          acceptedCount++
        }
      })

      const endTime = Date.now()
      const processingTime = endTime - startTime

      expect(acceptedCount).toBe(10000)
      expect(deduplicator.getSeenCount()).toBe(10000)
      expect(processingTime).toBeLessThan(100) // Should be fast
    })

    it('should handle many duplicates efficiently', () => {
      const baseIds = ['msg_001', 'msg_002', 'msg_003']
      
      let acceptedCount = 0
      let duplicateCount = 0

      // Add each ID 1000 times
      for (let i = 0; i < 1000; i++) {
        baseIds.forEach(id => {
          if (deduplicator.addMessage(id)) {
            acceptedCount++
          } else {
            duplicateCount++
          }
        })
      }

      expect(acceptedCount).toBe(3) // Only first occurrence of each
      expect(duplicateCount).toBe(2997) // 3000 - 3 = 2997 duplicates
      expect(deduplicator.getSeenCount()).toBe(3)
    })
  })

  describe('Memory Management', () => {
    it('should clear state correctly', () => {
      const messageIds = ['msg_001', 'msg_002', 'msg_003']
      
      messageIds.forEach(id => deduplicator.addMessage(id))
      expect(deduplicator.getSeenCount()).toBe(3)
      
      deduplicator.clear()
      expect(deduplicator.getSeenCount()).toBe(0)
      
      // Should accept previously seen IDs after clearing
      messageIds.forEach(id => {
        expect(deduplicator.hasMessage(id)).toBe(false)
        expect(deduplicator.addMessage(id)).toBe(true)
      })
    })

    it('should handle memory growth with realistic usage', () => {
      // Simulate a month of usage: ~10,000 messages
      const messageCount = 10000
      
      for (let i = 0; i < messageCount; i++) {
        deduplicator.addMessage(`msg_day_${Math.floor(i / 300)}_${i % 300}`)
      }
      
      expect(deduplicator.getSeenCount()).toBe(messageCount)
      
      // Should still be responsive
      const testStart = Date.now()
      expect(deduplicator.hasMessage('msg_day_0_0')).toBe(true)
      expect(deduplicator.hasMessage('msg_day_33_99')).toBe(true)
      const testTime = Date.now() - testStart
      
      expect(testTime).toBeLessThan(10) // Lookup should be O(1)
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty message IDs', () => {
      expect(deduplicator.addMessage('')).toBe(true)
      expect(deduplicator.addMessage('')).toBe(false) // Should be duplicate
      expect(deduplicator.getSeenCount()).toBe(1)
    })

    it('should handle very long message IDs', () => {
      const longId = 'msg_' + 'x'.repeat(1000)
      
      expect(deduplicator.addMessage(longId)).toBe(true)
      expect(deduplicator.hasMessage(longId)).toBe(true)
      expect(deduplicator.addMessage(longId)).toBe(false) // Duplicate
    })

    it('should handle special characters in message IDs', () => {
      const specialIds = [
        'msg_with_spaces ',
        'msg-with-hyphens',
        'msg_with_émojis_🚀',
        'msg/with/slashes',
        'msg.with.dots',
        'msg@with@symbols'
      ]

      specialIds.forEach(id => {
        expect(deduplicator.addMessage(id)).toBe(true)
        expect(deduplicator.hasMessage(id)).toBe(true)
        expect(deduplicator.addMessage(id)).toBe(false) // Duplicate check
      })

      expect(deduplicator.getSeenCount()).toBe(specialIds.length)
    })

    it('should be case sensitive', () => {
      expect(deduplicator.addMessage('msg_ABC')).toBe(true)
      expect(deduplicator.addMessage('msg_abc')).toBe(true) // Different case
      expect(deduplicator.addMessage('msg_ABC')).toBe(false) // Duplicate
      expect(deduplicator.addMessage('msg_abc')).toBe(false) // Duplicate
      
      expect(deduplicator.getSeenCount()).toBe(2)
    })
  })

  describe('Real-world Scenarios', () => {
    it('should handle typical Claude Code log scenario', () => {
      // Simulate realistic Claude Code logs with some duplicates
      const entries = TestUtils.createMockLogEntries(100, {
        duplicateIds: true, // Include some duplicate IDs
        models: [TEST_CONSTANTS.MODELS.SONNET_4, TEST_CONSTANTS.MODELS.OPUS_4],
        timeRange: {
          start: new Date('2025-01-01T09:00:00Z'),
          end: new Date('2025-01-01T17:00:00Z')
        }
      })

      const deduplicated = MessageDeduplicator.processEntries(entries)
      
      // Should have fewer entries due to deduplication
      expect(deduplicated.length).toBeLessThan(entries.length)
      expect(deduplicated.length).toBeGreaterThan(80) // But most should remain
      
      // All remaining entries should have unique IDs
      const ids = deduplicated.map(entry => entry.message?.id).filter(Boolean)
      const uniqueIds = new Set(ids)
      expect(uniqueIds.size).toBe(ids.length)
    })

    it('should handle multiple file processing scenario', () => {
      // Simulate processing multiple JSONL files with overlapping message IDs
      const file1Entries = TestUtils.createMockLogEntries(50, {
        timeRange: {
          start: new Date('2025-01-01T09:00:00Z'),
          end: new Date('2025-01-01T12:00:00Z')
        }
      })
      
      const file2Entries = TestUtils.createMockLogEntries(50, {
        timeRange: {
          start: new Date('2025-01-01T11:00:00Z'), // Overlapping time
          end: new Date('2025-01-01T14:00:00Z')
        }
      })
      
      // Some entries might have same IDs (simulate duplicate messages across files)
      const duplicateEntry = { ...file1Entries[0] }
      file2Entries.push(duplicateEntry)
      
      const allEntries = [...file1Entries, ...file2Entries]
      const deduplicated = MessageDeduplicator.processEntries(allEntries)
      
      expect(deduplicated.length).toBeLessThan(allEntries.length)
      
      // Check for proper deduplication
      const ids = deduplicated.map(entry => entry.message?.id).filter(Boolean)
      const uniqueIds = new Set(ids)
      expect(uniqueIds.size).toBe(ids.length)
    })

    it('should maintain order of first occurrence', () => {
      const entries = [
        TestUtils.createMockLogEntry({ 
          message: { id: 'msg_001', model: TEST_CONSTANTS.MODELS.SONNET_4 },
          timestamp: '2025-01-01T10:00:00Z'
        }),
        TestUtils.createMockLogEntry({ 
          message: { id: 'msg_002', model: TEST_CONSTANTS.MODELS.SONNET_4 },
          timestamp: '2025-01-01T11:00:00Z'
        }),
        TestUtils.createMockLogEntry({ 
          message: { id: 'msg_001', model: TEST_CONSTANTS.MODELS.SONNET_4 }, // Duplicate
          timestamp: '2025-01-01T12:00:00Z'
        }),
        TestUtils.createMockLogEntry({ 
          message: { id: 'msg_003', model: TEST_CONSTANTS.MODELS.SONNET_4 },
          timestamp: '2025-01-01T13:00:00Z'
        })
      ]

      const deduplicated = MessageDeduplicator.processEntries(entries)
      
      expect(deduplicated).toHaveLength(3)
      expect(deduplicated.map(e => e.message?.id)).toEqual(['msg_001', 'msg_002', 'msg_003'])
      
      // First occurrence should be preserved (earlier timestamp)
      const msg001Entry = deduplicated.find(e => e.message?.id === 'msg_001')
      expect(msg001Entry?.timestamp).toBe('2025-01-01T10:00:00Z')
    })
  })
})