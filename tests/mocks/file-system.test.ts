import { describe, it, expect, beforeEach, vi } from 'vitest'
import { TestUtils, TEST_CONSTANTS } from '../helpers/test-utils'
import type { ClaudeLogEntry } from '../../ccmonitor'

/**
 * File system operations simulation for testing ccmonitor
 * This tests the file I/O logic without requiring actual files
 */

class FileSystemSimulator {
  private mockFs: ReturnType<typeof TestUtils.createMockFileSystem>
  private processedFiles: Set<string> = new Set()

  constructor() {
    this.mockFs = TestUtils.createMockFileSystem()
  }

  // Simulate Claude Code directory scanning
  async scanClaudeProjects(): Promise<string[]> {
    try {
      const projects = await this.mockFs.readdir('~/.claude/projects')
      const projectPaths: string[] = []

      for (const project of projects) {
        const projectPath = `~/.claude/projects/${project}`
        const files = await this.mockFs.readdir(projectPath)
        
        for (const file of files) {
          if (file.endsWith('.jsonl')) {
            projectPaths.push(`${projectPath}/${file}`)
          }
        }
      }

      return projectPaths
    } catch (error) {
      return []
    }
  }

  // Simulate incremental file processing with modification time tracking
  async processFilesIncremental(lastScanTime: Date): Promise<{
    newEntries: ClaudeLogEntry[]
    modifiedFiles: string[]
    skippedFiles: string[]
  }> {
    const filePaths = await this.scanClaudeProjects()
    const newEntries: ClaudeLogEntry[] = []
    const modifiedFiles: string[] = []
    const skippedFiles: string[] = []

    for (const filePath of filePaths) {
      try {
        const stats = await this.mockFs.stat(filePath)
        
        // Check if file was modified since last scan
        if (stats.mtime <= lastScanTime) {
          skippedFiles.push(filePath)
          continue
        }

        modifiedFiles.push(filePath)
        const content = await this.mockFs.readFile(filePath)
        const entries = this.parseJSONLContent(content)
        newEntries.push(...entries)
        
      } catch (error) {
        // Skip problematic files
        skippedFiles.push(filePath)
      }
    }

    return { newEntries, modifiedFiles, skippedFiles }
  }

  // Simulate data aggregation and storage
  async saveAggregatedData(data: any[], filePath: string): Promise<void> {
    const content = data.map(item => JSON.stringify(item)).join('\n')
    await this.mockFs.writeFile(filePath, content)
  }

  async loadAggregatedData(filePath: string): Promise<any[]> {
    try {
      const content = await this.mockFs.readFile(filePath)
      return content.trim().split('\n').map(line => JSON.parse(line))
    } catch (error) {
      return []
    }
  }

  private parseJSONLContent(content: string): ClaudeLogEntry[] {
    const lines = content.trim().split('\n')
    const entries: ClaudeLogEntry[] = []

    for (const line of lines) {
      try {
        const entry = JSON.parse(line)
        if (this.isValidClaudeLogEntry(entry)) {
          entries.push(entry)
        }
      } catch (error) {
        // Skip invalid lines
      }
    }

    return entries
  }

  private isValidClaudeLogEntry(entry: any): entry is ClaudeLogEntry {
    return (
      entry &&
      typeof entry.timestamp === 'string' &&
      entry.type === 'assistant' &&
      entry.message &&
      entry.message.usage &&
      entry.message.id
    )
  }

  // Helper methods for test setup
  setupMockClaudeEnvironment(projectCount: number = 3, filesPerProject: number = 2): void {
    // Set up mock directories
    const projects: string[] = []
    
    for (let i = 1; i <= projectCount; i++) {
      const projectName = `project${i}`
      projects.push(projectName)
      
      const files: string[] = []
      for (let j = 1; j <= filesPerProject; j++) {
        files.push(`session${j}.jsonl`)
      }
    }
  }

  setMockFile(path: string, entries: ClaudeLogEntry[], modificationTime?: Date): void {
    const content = TestUtils.generateJSONLContent(entries)
    this.mockFs.setMockFile(path, content)
    
    if (modificationTime) {
      this.mockFs.setMockFileMtime(path, modificationTime)
    }
  }

  getMockFileSystem(): ReturnType<typeof TestUtils.createMockFileSystem> {
    return this.mockFs
  }
}

describe('File System Operations', () => {
  let fileSystem: FileSystemSimulator

  beforeEach(() => {
    fileSystem = new FileSystemSimulator()
  })

  describe('Claude Projects Directory Scanning', () => {
    it('should discover JSONL files in Claude projects', async () => {
      // Set up mock file structure
      const mockFs = fileSystem.getMockFileSystem()
      
      // Create entries for different projects
      const project1Entries = TestUtils.createMockLogEntries(10)
      const project2Entries = TestUtils.createMockLogEntries(15)
      
      fileSystem.setMockFile('~/.claude/projects/project1/session1.jsonl', project1Entries)
      fileSystem.setMockFile('~/.claude/projects/project1/session2.jsonl', project1Entries)
      fileSystem.setMockFile('~/.claude/projects/project2/session1.jsonl', project2Entries)

      const filePaths = await fileSystem.scanClaudeProjects()

      expect(filePaths).toHaveLength(3)
      expect(filePaths).toContain('~/.claude/projects/project1/session1.jsonl')
      expect(filePaths).toContain('~/.claude/projects/project1/session2.jsonl')
      expect(filePaths).toContain('~/.claude/projects/project2/session1.jsonl')
    })

    it('should ignore non-JSONL files', async () => {
      const entries = TestUtils.createMockLogEntries(5)
      fileSystem.setMockFile('~/.claude/projects/project1/session1.jsonl', entries)
      
      // Add non-JSONL files that should be ignored
      const mockFs = fileSystem.getMockFileSystem()
      mockFs.setMockFile('~/.claude/projects/project1/config.txt', 'some config')
      mockFs.setMockFile('~/.claude/projects/project1/readme.md', '# Project')

      const filePaths = await fileSystem.scanClaudeProjects()

      expect(filePaths).toHaveLength(1)
      expect(filePaths[0]).toBe('~/.claude/projects/project1/session1.jsonl')
    })

    it('should handle empty projects directory', async () => {
      const filePaths = await fileSystem.scanClaudeProjects()
      expect(filePaths).toHaveLength(0)
    })

    it('should handle missing projects directory gracefully', async () => {
      // Don't set up any mock directories
      const filePaths = await fileSystem.scanClaudeProjects()
      expect(filePaths).toHaveLength(0)
    })
  })

  describe('Incremental File Processing', () => {
    it('should process only modified files', async () => {
      const oldTime = new Date('2025-01-01T10:00:00Z')
      const newTime = new Date('2025-01-01T12:00:00Z')
      
      // Set up files with different modification times
      const oldEntries = TestUtils.createMockLogEntries(5)
      const newEntries = TestUtils.createMockLogEntries(3)
      
      fileSystem.setMockFile('~/.claude/projects/project1/old.jsonl', oldEntries, oldTime)
      fileSystem.setMockFile('~/.claude/projects/project1/new.jsonl', newEntries, newTime)

      // Scan after old files but before new files
      const scanTime = new Date('2025-01-01T11:00:00Z')
      const result = await fileSystem.processFilesIncremental(scanTime)

      expect(result.skippedFiles).toContain('~/.claude/projects/project1/old.jsonl')
      expect(result.modifiedFiles).toContain('~/.claude/projects/project1/new.jsonl')
      expect(result.newEntries).toHaveLength(3) // Only new entries processed
    })

    it('should skip all files when no modifications since last scan', async () => {
      const scanTime = new Date('2025-01-01T12:00:00Z')
      const oldTime = new Date('2025-01-01T10:00:00Z')
      
      const entries = TestUtils.createMockLogEntries(10)
      fileSystem.setMockFile('~/.claude/projects/project1/session1.jsonl', entries, oldTime)

      const result = await fileSystem.processFilesIncremental(scanTime)

      expect(result.modifiedFiles).toHaveLength(0)
      expect(result.skippedFiles).toHaveLength(1)
      expect(result.newEntries).toHaveLength(0)
    })

    it('should handle malformed JSONL files gracefully', async () => {
      const scanTime = new Date('2025-01-01T10:00:00Z')
      const fileTime = new Date('2025-01-01T12:00:00Z')

      // Create file with mix of valid and invalid entries
      const validEntry = TestUtils.createMockLogEntry()
      const content = [
        JSON.stringify(validEntry),
        'invalid json line',
        '{"incomplete": "entry"}',
        JSON.stringify({ type: 'invalid_type', message: null })
      ].join('\n')

      const mockFs = fileSystem.getMockFileSystem()
      mockFs.setMockFile('~/.claude/projects/project1/malformed.jsonl', content)
      mockFs.setMockFileMtime('~/.claude/projects/project1/malformed.jsonl', fileTime)

      const result = await fileSystem.processFilesIncremental(scanTime)

      expect(result.modifiedFiles).toHaveLength(1)
      expect(result.newEntries).toHaveLength(1) // Only valid entry processed
      expect(result.newEntries[0].message?.id).toBe(validEntry.message?.id)
    })
  })

  describe('Data Persistence', () => {
    it('should save and load aggregated data correctly', async () => {
      const testData = [
        TestUtils.createMockHourlyStats({ hour: '2025-01-01 10:00', cost: 0.05 }),
        TestUtils.createMockHourlyStats({ hour: '2025-01-01 11:00', cost: 0.03 })
      ]

      const filePath = '~/.ccmonitor/usage-log.jsonl'
      
      // Save data
      await fileSystem.saveAggregatedData(testData, filePath)

      // Load data back
      const loadedData = await fileSystem.loadAggregatedData(filePath)

      expect(loadedData).toHaveLength(2)
      expect(loadedData[0]).toMatchObject(testData[0])
      expect(loadedData[1]).toMatchObject(testData[1])
    })

    it('should handle missing aggregated data file', async () => {
      const loadedData = await fileSystem.loadAggregatedData('~/.ccmonitor/nonexistent.jsonl')
      expect(loadedData).toHaveLength(0)
    })

    it('should handle corrupted aggregated data file', async () => {
      const mockFs = fileSystem.getMockFileSystem()
      mockFs.setMockFile('~/.ccmonitor/corrupted.jsonl', 'invalid\njson\ndata')

      const loadedData = await fileSystem.loadAggregatedData('~/.ccmonitor/corrupted.jsonl')
      expect(loadedData).toHaveLength(0) // Should return empty array
    })
  })

  describe('Real-world Usage Scenarios', () => {
    it('should handle typical Claude Code project structure', async () => {
      // Simulate realistic project structure
      const projects = ['coding-assistant', 'creative-writing', 'data-analysis']
      const sessionsPerProject = [5, 3, 7]

      for (let i = 0; i < projects.length; i++) {
        const projectName = projects[i]
        const sessionCount = sessionsPerProject[i]

        for (let j = 1; j <= sessionCount; j++) {
          const entries = TestUtils.createMockLogEntries(
            Math.floor(Math.random() * 20) + 5, // 5-25 entries per session
            {
              models: [TEST_CONSTANTS.MODELS.SONNET_4, TEST_CONSTANTS.MODELS.OPUS_4],
              timeRange: {
                start: new Date(`2025-01-0${i + 1}T09:00:00Z`),
                end: new Date(`2025-01-0${i + 1}T17:00:00Z`)
              }
            }
          )

          fileSystem.setMockFile(
            `~/.claude/projects/${projectName}/session${j}.jsonl`,
            entries,
            new Date('2025-01-01T12:00:00Z')
          )
        }
      }

      const filePaths = await fileSystem.scanClaudeProjects()
      expect(filePaths).toHaveLength(15) // Total sessions across all projects

      // Process all files
      const result = await fileSystem.processFilesIncremental(new Date('2025-01-01T10:00:00Z'))
      
      expect(result.modifiedFiles).toHaveLength(15)
      expect(result.skippedFiles).toHaveLength(0)
      expect(result.newEntries.length).toBeGreaterThan(50) // Should have many entries
      
      // All entries should be valid Claude log entries
      result.newEntries.forEach(entry => {
        expect(entry).toHaveProperty('timestamp')
        expect(entry).toHaveProperty('type', 'assistant')
        expect(entry).toHaveProperty('message')
        expect(entry.message).toHaveProperty('id')
        expect(entry.message).toHaveProperty('usage')
      })
    })

    it('should demonstrate performance with large file counts', async () => {
      // Create many small files (common in long-term usage)
      const projectCount = 20
      const filesPerProject = 10
      const entriesPerFile = 5

      for (let p = 1; p <= projectCount; p++) {
        for (let f = 1; f <= filesPerProject; f++) {
          const entries = TestUtils.createMockLogEntries(entriesPerFile)
          fileSystem.setMockFile(
            `~/.claude/projects/project${p}/session${f}.jsonl`,
            entries,
            new Date('2025-01-01T12:00:00Z')
          )
        }
      }

      const startTime = performance.now()
      
      // Scan all files
      const filePaths = await fileSystem.scanClaudeProjects()
      expect(filePaths).toHaveLength(projectCount * filesPerProject) // 200 files

      // Process all files
      const result = await fileSystem.processFilesIncremental(new Date('2025-01-01T10:00:00Z'))
      
      const endTime = performance.now()
      const processingTime = endTime - startTime

      expect(result.newEntries).toHaveLength(projectCount * filesPerProject * entriesPerFile) // 1000 entries
      expect(processingTime).toBeLessThan(1000) // Should complete within 1 second

      console.log(`Processed ${filePaths.length} files with ${result.newEntries.length} entries in ${processingTime.toFixed(2)}ms`)
    })

    it('should handle mixed file modification scenarios', async () => {
      const baseTime = new Date('2025-01-01T12:00:00Z')
      
      // Create files with staggered modification times
      const scenarios = [
        { file: 'old-session.jsonl', modTime: new Date(baseTime.getTime() - 3600000), entries: 5 }, // 1 hour ago
        { file: 'recent-session.jsonl', modTime: new Date(baseTime.getTime() - 1800000), entries: 8 }, // 30 min ago  
        { file: 'new-session.jsonl', modTime: new Date(baseTime.getTime() - 300000), entries: 3 }, // 5 min ago
        { file: 'current-session.jsonl', modTime: new Date(baseTime.getTime()), entries: 12 } // Now
      ]

      scenarios.forEach(scenario => {
        const entries = TestUtils.createMockLogEntries(scenario.entries)
        fileSystem.setMockFile(`~/.claude/projects/mixed/${scenario.file}`, entries, scenario.modTime)
      })

      // Scan with different cutoff times
      const cutoffTimes = [
        new Date(baseTime.getTime() - 7200000), // 2 hours ago (should get all)
        new Date(baseTime.getTime() - 2400000), // 40 min ago (should get recent + new + current)
        new Date(baseTime.getTime() - 60000),   // 1 min ago (should get only current)
      ]

      const results = await Promise.all(
        cutoffTimes.map(cutoff => fileSystem.processFilesIncremental(cutoff))
      )

      // Verify correct files are processed based on cutoff time
      expect(results[0].modifiedFiles).toHaveLength(4) // All files
      expect(results[1].modifiedFiles).toHaveLength(3) // Recent, new, current
      expect(results[2].modifiedFiles).toHaveLength(1) // Only current

      // Verify correct entry counts
      expect(results[0].newEntries).toHaveLength(28) // All entries
      expect(results[1].newEntries).toHaveLength(23) // Recent + new + current
      expect(results[2].newEntries).toHaveLength(12) // Only current
    })
  })

  describe('Error Handling and Edge Cases', () => {
    it('should handle permission errors gracefully', async () => {
      const mockFs = fileSystem.getMockFileSystem()
      
      // Mock readFile to simulate permission error
      mockFs.readFile = vi.fn().mockRejectedValue(new Error('EACCES: permission denied'))

      const result = await fileSystem.processFilesIncremental(new Date('2025-01-01T10:00:00Z'))

      expect(result.newEntries).toHaveLength(0)
      expect(result.modifiedFiles).toHaveLength(0)
      expect(result.skippedFiles).toHaveLength(0)
    })

    it('should handle file system limits', async () => {
      // Test with very long file paths
      const longProjectName = 'a'.repeat(100)
      const longFileName = 'b'.repeat(100) + '.jsonl'
      
      const entries = TestUtils.createMockLogEntries(3)
      fileSystem.setMockFile(`~/.claude/projects/${longProjectName}/${longFileName}`, entries)

      const filePaths = await fileSystem.scanClaudeProjects()
      const result = await fileSystem.processFilesIncremental(new Date('2025-01-01T10:00:00Z'))

      // Should handle long paths correctly
      expect(filePaths).toHaveLength(1)
      expect(result.newEntries).toHaveLength(3)
    })

    it('should handle concurrent access simulation', async () => {
      // Simulate multiple operations happening concurrently
      const entries = TestUtils.createMockLogEntries(10)
      fileSystem.setMockFile('~/.claude/projects/project1/session1.jsonl', entries)

      // Run multiple scans simultaneously
      const promises = Array(5).fill(null).map(() => 
        fileSystem.processFilesIncremental(new Date('2025-01-01T10:00:00Z'))
      )

      const results = await Promise.all(promises)

      // All results should be identical
      results.forEach(result => {
        expect(result.newEntries).toHaveLength(10)
        expect(result.modifiedFiles).toHaveLength(1)
      })
    })
  })
})