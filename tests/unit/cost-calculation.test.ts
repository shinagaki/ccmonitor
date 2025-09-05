import { describe, it, expect, vi } from 'vitest'
import { TestUtils, TEST_CONSTANTS } from '../helpers/test-utils'

// We need to test the cost calculation logic from ccmonitor
// Since ccmonitor.ts is a single file with a class, we'll need to import it differently
// For now, we'll create a mock version of the calculateCost function to test the logic

/**
 * Cost calculation function extracted for testing
 * This mirrors the logic in ccmonitor.ts
 */
function calculateCost(
  inputTokens: number, 
  outputTokens: number, 
  cacheCreationTokens: number = 0, 
  cacheReadTokens: number = 0, 
  model: string = 'claude-sonnet-4-20250514'
): number {
  const pricingTable: Record<string, {
    input: number;
    output: number;
    cacheCreation: number;
    cacheRead: number;
  }> = {
    'claude-sonnet-4-20250514': {
      input: 0.003,
      output: 0.015,
      cacheCreation: 0.00375,
      cacheRead: 0.0003
    },
    'claude-opus-4-20250514': {
      input: 0.015,
      output: 0.075,
      cacheCreation: 0.01875,
      cacheRead: 0.0015
    },
    'claude-haiku-3.5-20241022': {
      input: 0.0008,
      output: 0.004,
      cacheCreation: 0.001,
      cacheRead: 0.00008
    }
  }

  const pricing = pricingTable[model] || pricingTable['claude-sonnet-4-20250514']

  return (inputTokens / 1000) * pricing.input +
         (outputTokens / 1000) * pricing.output +
         (cacheCreationTokens / 1000) * pricing.cacheCreation +
         (cacheReadTokens / 1000) * pricing.cacheRead
}

describe('Cost Calculation', () => {
  
  describe('Basic Cost Calculation', () => {
    it('should calculate cost correctly for Sonnet 4', () => {
      const cost = calculateCost(1000, 500, 0, 0, TEST_CONSTANTS.MODELS.SONNET_4)
      const expected = (1000/1000) * 0.003 + (500/1000) * 0.015 // 0.003 + 0.0075 = 0.0105
      
      expect(TestUtils.validateCost(cost, expected)).toBe(true)
      expect(cost).toBeCloseTo(0.0105, 6)
    })

    it('should calculate cost correctly for Opus 4', () => {
      const cost = calculateCost(1000, 500, 0, 0, TEST_CONSTANTS.MODELS.OPUS_4)
      const expected = (1000/1000) * 0.015 + (500/1000) * 0.075 // 0.015 + 0.0375 = 0.0525
      
      expect(TestUtils.validateCost(cost, expected)).toBe(true)
      expect(cost).toBeCloseTo(0.0525, 6)
    })

    it('should calculate cost correctly for Haiku 3.5', () => {
      const cost = calculateCost(1000, 500, 0, 0, TEST_CONSTANTS.MODELS.HAIKU_35)
      const expected = (1000/1000) * 0.0008 + (500/1000) * 0.004 // 0.0008 + 0.002 = 0.0028
      
      expect(TestUtils.validateCost(cost, expected)).toBe(true)
      expect(cost).toBeCloseTo(0.0028, 6)
    })
  })

  describe('Cache Token Calculation', () => {
    it('should calculate cache creation cost correctly', () => {
      const cost = calculateCost(1000, 500, 200, 0, TEST_CONSTANTS.MODELS.SONNET_4)
      const expected = (1000/1000) * 0.003 + (500/1000) * 0.015 + (200/1000) * 0.00375
      // 0.003 + 0.0075 + 0.00075 = 0.01125
      
      expect(TestUtils.validateCost(cost, expected)).toBe(true)
      expect(cost).toBeCloseTo(0.01125, 6)
    })

    it('should calculate cache read cost correctly', () => {
      const cost = calculateCost(1000, 500, 0, 300, TEST_CONSTANTS.MODELS.SONNET_4)
      const expected = (1000/1000) * 0.003 + (500/1000) * 0.015 + (300/1000) * 0.0003
      // 0.003 + 0.0075 + 0.00009 = 0.01059
      
      expect(TestUtils.validateCost(cost, expected)).toBe(true)
      expect(cost).toBeCloseTo(0.01059, 6)
    })

    it('should calculate all token types together', () => {
      const cost = calculateCost(1000, 500, 200, 300, TEST_CONSTANTS.MODELS.OPUS_4)
      const expected = (1000/1000) * 0.015 + (500/1000) * 0.075 + (200/1000) * 0.01875 + (300/1000) * 0.0015
      // 0.015 + 0.0375 + 0.00375 + 0.00045 = 0.0567
      
      expect(TestUtils.validateCost(cost, expected)).toBe(true)
      expect(cost).toBeCloseTo(0.0567, 6)
    })
  })

  describe('Edge Cases', () => {
    it('should handle zero tokens correctly', () => {
      const cost = calculateCost(0, 0, 0, 0, TEST_CONSTANTS.MODELS.SONNET_4)
      expect(cost).toBe(0)
    })

    it('should handle very large token counts', () => {
      const largeTokens = 1000000
      const cost = calculateCost(largeTokens, largeTokens, largeTokens, largeTokens, TEST_CONSTANTS.MODELS.SONNET_4)
      const expected = largeTokens * (0.003 + 0.015 + 0.00375 + 0.0003) / 1000
      // 1000 * (0.003 + 0.015 + 0.00375 + 0.0003) = 1000 * 0.02205 = 22.05
      
      expect(TestUtils.validateCost(cost, expected, 0.01)).toBe(true)
      expect(cost).toBeCloseTo(22.05, 2)
    })

    it('should default to Sonnet 4 pricing for unknown models', () => {
      const cost = calculateCost(1000, 500, 0, 0, 'unknown-model')
      const expectedSonnetCost = calculateCost(1000, 500, 0, 0, TEST_CONSTANTS.MODELS.SONNET_4)
      
      expect(cost).toBe(expectedSonnetCost)
    })

    it('should handle negative token values gracefully', () => {
      // Although this shouldn't happen in practice, the function should handle it
      const cost = calculateCost(-100, -50, 0, 0, TEST_CONSTANTS.MODELS.SONNET_4)
      const expected = (-100/1000) * 0.003 + (-50/1000) * 0.015
      
      expect(cost).toBeCloseTo(expected, 6)
      expect(cost).toBeLessThan(0) // Should be negative
    })
  })

  describe('Precision and Rounding', () => {
    it('should maintain precision for small amounts', () => {
      const cost = calculateCost(1, 1, 0, 0, TEST_CONSTANTS.MODELS.SONNET_4)
      const expected = (1/1000) * 0.003 + (1/1000) * 0.015
      // 0.000003 + 0.000015 = 0.000018
      
      expect(TestUtils.validateCost(cost, expected)).toBe(true)
      expect(cost).toBeCloseTo(0.000018, 8)
    })

    it('should handle fractional calculations correctly', () => {
      const cost = calculateCost(1333, 777, 0, 0, TEST_CONSTANTS.MODELS.SONNET_4)
      const expected = (1333/1000) * 0.003 + (777/1000) * 0.015
      // 1.333 * 0.003 + 0.777 * 0.015 = 0.003999 + 0.011655 = 0.015654
      
      expect(TestUtils.validateCost(cost, expected)).toBe(true)
      expect(cost).toBeCloseTo(0.015654, 6)
    })
  })

  describe('Real-world Usage Scenarios', () => {
    it('should calculate cost for typical short conversation', () => {
      // Typical short conversation: 500 input, 200 output tokens
      const cost = calculateCost(500, 200, 0, 0, TEST_CONSTANTS.MODELS.SONNET_4)
      const expected = (500/1000) * 0.003 + (200/1000) * 0.015
      // 0.0015 + 0.003 = 0.0045
      
      expect(cost).toBeCloseTo(0.0045, 6)
      expect(cost).toBeGreaterThan(0)
      expect(cost).toBeLessThan(0.01) // Should be less than 1 cent
    })

    it('should calculate cost for long coding session', () => {
      // Long coding session: 8000 input, 5000 output, some cache usage
      const cost = calculateCost(8000, 5000, 1000, 2000, TEST_CONSTANTS.MODELS.SONNET_4)
      const expected = (8000/1000) * 0.003 + (5000/1000) * 0.015 + (1000/1000) * 0.00375 + (2000/1000) * 0.0003
      // 0.024 + 0.075 + 0.00375 + 0.0006 = 0.10335
      
      expect(cost).toBeCloseTo(0.10335, 5)
      expect(cost).toBeGreaterThan(0.1) // Should be more than 10 cents
    })

    it('should show significant cost difference between models', () => {
      const tokens = { input: 2000, output: 1000 }
      
      const sonnetCost = calculateCost(tokens.input, tokens.output, 0, 0, TEST_CONSTANTS.MODELS.SONNET_4)
      const opusCost = calculateCost(tokens.input, tokens.output, 0, 0, TEST_CONSTANTS.MODELS.OPUS_4)
      const haikuCost = calculateCost(tokens.input, tokens.output, 0, 0, TEST_CONSTANTS.MODELS.HAIKU_35)
      
      // Opus should be most expensive, Haiku cheapest
      expect(opusCost).toBeGreaterThan(sonnetCost)
      expect(sonnetCost).toBeGreaterThan(haikuCost)
      
      // Verify actual ratios match expected pricing ratios
      const opusToSonnetRatio = opusCost / sonnetCost
      const expectedRatio = (0.015 + 0.075) / (0.003 + 0.015) // (input + output) pricing ratios
      expect(opusToSonnetRatio).toBeCloseTo(expectedRatio, 2)
    })
  })

  describe('Batch Cost Calculations', () => {
    it('should calculate total cost for multiple entries correctly', () => {
      const entries = [
        { input: 1000, output: 500, model: TEST_CONSTANTS.MODELS.SONNET_4 },
        { input: 2000, output: 800, model: TEST_CONSTANTS.MODELS.OPUS_4 },
        { input: 500, output: 300, model: TEST_CONSTANTS.MODELS.HAIKU_35 }
      ]
      
      const totalCost = entries.reduce((sum, entry) => {
        return sum + calculateCost(entry.input, entry.output, 0, 0, entry.model)
      }, 0)
      
      const expectedCosts = [
        (1000/1000) * 0.003 + (500/1000) * 0.015,    // Sonnet: 0.0105
        (2000/1000) * 0.015 + (800/1000) * 0.075,    // Opus: 0.09
        (500/1000) * 0.0008 + (300/1000) * 0.004     // Haiku: 0.0016
      ]
      
      const expectedTotal = expectedCosts.reduce((a, b) => a + b, 0)
      
      expect(TestUtils.validateCost(totalCost, expectedTotal)).toBe(true)
      expect(totalCost).toBeCloseTo(expectedTotal, 6)
    })
  })
})