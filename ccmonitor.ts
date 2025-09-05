#!/usr/bin/env bun

import { readdir, readFile, writeFile, mkdir, stat } from 'fs/promises';
import { join, resolve } from 'path';
import { homedir } from 'os';
import { parseArgs } from 'util';

interface UsageRecord {
  timestamp: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cost: number;
  sessionCount: number;
}

interface HourlyStats {
  hour: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cost: number;
  sessionCount: number;
  avgInputPerSession: number;
  avgOutputPerSession: number;
}

interface ClaudeLogEntry {
  timestamp: string;
  type: string;
  message?: {
    usage?: {
      input_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
      output_tokens?: number;
    };
  };
  cost?: number;
}

class ClaudeUsageMonitor {
  private dataPath: string;
  private logFile: string;
  private claudeDir: string;
  
  // Incremental loading cache for efficient watch mode
  private cachedHourlyStats: Map<string, HourlyStats> = new Map();
  private fileLastModified: Map<string, number> = new Map();
  private seenMessageIds: Set<string> = new Set();
  private lastIncrementalScan: Date = new Date(0);

  constructor(dataPath?: string, claudeDir?: string) {
    this.dataPath = dataPath || join(homedir(), '.ccmonitor');
    this.logFile = join(this.dataPath, 'usage-log.jsonl');
    this.claudeDir = claudeDir || join(homedir(), '.claude');
  }

  private async ensureDataDir(): Promise<void> {
    try {
      await mkdir(this.dataPath, { recursive: true });
    } catch (error) {
      // Directory already exists
    }
  }

  private calculateCost(inputTokens: number, outputTokens: number, cacheCreationTokens: number = 0, cacheReadTokens: number = 0, model: string = 'claude-sonnet-4-20250514'): number {
    // モデル別の正確な料金レート（Anthropic 公式料金）
    const pricingTable: Record<string, {
      input: number;
      output: number;
      cacheCreation: number;
      cacheRead: number;
    }> = {
      'claude-sonnet-4-20250514': {
        input: 0.003,        // $3 per million = $0.003 per 1K
        output: 0.015,       // $15 per million = $0.015 per 1K
        cacheCreation: 0.0037, // $3.75 per million = $0.0037 per 1K
        cacheRead: 0.0003    // $0.30 per million = $0.0003 per 1K
      },
      'claude-opus-4-20250514': {
        input: 0.015,        // $15 per million = $0.015 per 1K
        output: 0.075,       // $75 per million = $0.075 per 1K
        cacheCreation: 0.01875, // $18.75 per million = $0.01875 per 1K
        cacheRead: 0.0015    // $1.50 per million = $0.0015 per 1K
      },
      'claude-haiku-3.5-20241022': {
        input: 0.0008,       // $0.80 per million = $0.0008 per 1K
        output: 0.004,       // $4 per million = $0.004 per 1K
        cacheCreation: 0.001, // $1 per million = $0.001 per 1K
        cacheRead: 0.00008   // $0.08 per million = $0.00008 per 1K
      }
    };

    // デフォルトは Sonnet 4 の料金を使用
    const pricing = pricingTable[model] || pricingTable['claude-sonnet-4-20250514'];

    return (inputTokens / 1000) * pricing.input +
           (outputTokens / 1000) * pricing.output +
           (cacheCreationTokens / 1000) * pricing.cacheCreation +
           (cacheReadTokens / 1000) * pricing.cacheRead;
  }

  private async loadClaudeData(): Promise<ClaudeLogEntry[]> {
    const entries: ClaudeLogEntry[] = [];
    const seenMessageIds = new Set<string>();

    try {
      const projectsPath = join(this.claudeDir, 'projects');
      const projects = await readdir(projectsPath);

      for (const project of projects) {
        const projectPath = join(projectsPath, project);
        const files = await readdir(projectPath);

        for (const file of files) {
          if (file.endsWith('.jsonl')) {
            const filePath = join(projectPath, file);
            const content = await readFile(filePath, 'utf-8');
            const lines = content.trim().split('\n');

            for (const line of lines) {
              try {
                const entry = JSON.parse(line);
                if (entry.timestamp && entry.type === 'assistant' && entry.message?.usage && entry.message?.id) {
                  // Avoid duplicate messages by checking message ID
                  if (seenMessageIds.has(entry.message.id)) {
                    continue;
                  }
                  seenMessageIds.add(entry.message.id);

                  const usage = entry.message.usage;
                  const inputTokens = usage.input_tokens || 0;
                  const outputTokens = usage.output_tokens || 0;
                  const cacheCreationTokens = usage.cache_creation_input_tokens || 0;
                  const cacheReadTokens = usage.cache_read_input_tokens || 0;

                  if (inputTokens > 0 || outputTokens > 0 || cacheCreationTokens > 0 || cacheReadTokens > 0) {
                    const model = entry.message.model || 'claude-sonnet-4-20250514';
                    entries.push({
                      timestamp: entry.timestamp,
                      type: entry.type,
                      message: entry.message,
                      cost: this.calculateCost(inputTokens, outputTokens, cacheCreationTokens, cacheReadTokens, model)
                    });
                  }
                }
              } catch (e) {
                // Skip malformed JSON lines
              }
            }
          }
        }
      }
    } catch (error) {
      console.warn(`Warning: Could not read Claude data from ${this.claudeDir}:`, error.message);
    }

    return entries;
  }

  private getHourKey(timestamp: string): string {
    const date = new Date(timestamp);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:00`;
  }

  // Efficient incremental data loading for watch mode
  private async loadClaudeDataIncremental(timeFilter?: { since?: string; tail?: number }): Promise<ClaudeLogEntry[]> {
    const newEntries: ClaudeLogEntry[] = [];
    
    try {
      const projectsPath = join(this.claudeDir, 'projects');
      const projects = await readdir(projectsPath);
      
      for (const project of projects) {
        const projectPath = join(projectsPath, project);
        const files = await readdir(projectPath);
        
        for (const file of files) {
          if (file.endsWith('.jsonl')) {
            const filePath = join(projectPath, file);
            
            // Check file modification time
            const stats = await stat(filePath);
            const lastModified = stats.mtime.getTime();
            const previousModified = this.fileLastModified.get(filePath) || 0;
            
            // Skip unchanged files
            if (lastModified <= previousModified) {
              continue;
            }
            
            // Update modification time
            this.fileLastModified.set(filePath, lastModified);
            
            // Read and process new/changed file
            const content = await readFile(filePath, 'utf-8');
            const lines = content.trim().split('\n');
            
            for (const line of lines) {
              try {
                const entry = JSON.parse(line);
                if (entry.timestamp && entry.type === 'assistant' && entry.message?.usage && entry.message?.id) {
                  
                  // Skip if we've already processed this message
                  if (this.seenMessageIds.has(entry.message.id)) {
                    continue;
                  }
                  
                  // For incremental scan, only skip if we've already seen this exact message
                  // Don't use lastIncrementalScan time check as it prevents detecting new messages in watch mode
                  const entryTime = new Date(entry.timestamp);
                  
                  // Apply time filtering for efficiency (skip processing old entries)
                  if (timeFilter) {
                    if (timeFilter.since) {
                      const sinceTime = new Date(timeFilter.since);
                      if (entryTime < sinceTime) {
                        continue;
                      }
                    }
                    if (timeFilter.tail) {
                      const tailHours = timeFilter.tail;
                      const cutoffTime = new Date(Date.now() - (tailHours * 60 * 60 * 1000));
                      if (entryTime < cutoffTime) {
                        continue;
                      }
                    }
                  }
                  
                  this.seenMessageIds.add(entry.message.id);
                  
                  const usage = entry.message.usage;
                  const inputTokens = usage.input_tokens || 0;
                  const outputTokens = usage.output_tokens || 0;
                  const cacheCreationTokens = usage.cache_creation_input_tokens || 0;
                  const cacheReadTokens = usage.cache_read_input_tokens || 0;
                  
                  if (inputTokens > 0 || outputTokens > 0 || cacheCreationTokens > 0 || cacheReadTokens > 0) {
                    const model = entry.message.model || 'claude-sonnet-4-20250514';
                    newEntries.push({
                      timestamp: entry.timestamp,
                      type: entry.type,
                      message: entry.message,
                      cost: this.calculateCost(inputTokens, outputTokens, cacheCreationTokens, cacheReadTokens, model)
                    });
                  }
                }
              } catch (e) {
                // Skip invalid JSON lines
                continue;
              }
            }
          }
        }
      }
      
      // Don't update lastIncrementalScan to allow detecting new messages in watch mode
      
    } catch (error) {
      // Return empty array on error to maintain functionality
    }
    
    return newEntries;
  }

  // Initialize cache from existing persistent data
  private async initializeCache(): Promise<void> {
    this.cachedHourlyStats.clear();
    this.seenMessageIds.clear();
    
    try {
      // Load existing data from persistent storage
      const content = await readFile(this.logFile, 'utf-8');
      const records: HourlyStats[] = content.trim().split('\n').map(line => JSON.parse(line));
      
      for (const record of records) {
        this.cachedHourlyStats.set(record.hour, record);
      }
      
      // Also initialize seen message IDs to avoid duplicates
      const entries = await this.loadClaudeData();
      for (const entry of entries) {
        if (entry.message?.id) {
          this.seenMessageIds.add(entry.message.id);
        }
      }
      
    } catch (error) {
      // If no existing data, start fresh
    }
  }

  // Efficient incremental collect for watch mode
  async collectIncremental(timeFilter?: { since?: string; tail?: number }): Promise<number> {
    await this.ensureDataDir();
    
    // Load only new entries since last scan, with optional time filtering
    const newEntries = await this.loadClaudeDataIncremental(timeFilter);
    
    if (newEntries.length === 0) {
      // No new data, return cached results
      return 0;
    }
    
    // Update cached hourly stats with new entries
    for (const entry of newEntries) {
      const hourKey = this.getHourKey(entry.timestamp);
      
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
        });
      }
      
      const stats = this.cachedHourlyStats.get(hourKey)!;
      const usage = entry.message?.usage;
      
      if (usage) {
        const inputTokens = usage.input_tokens || 0;
        const outputTokens = usage.output_tokens || 0;
        const cacheCreationTokens = usage.cache_creation_input_tokens || 0;
        const cacheReadTokens = usage.cache_read_input_tokens || 0;
        
        stats.inputTokens += inputTokens;
        stats.outputTokens += outputTokens;
        stats.totalTokens += inputTokens + outputTokens + cacheCreationTokens + cacheReadTokens;
        stats.cost += entry.cost || 0;
        stats.sessionCount += 1;
        stats.avgInputPerSession = stats.sessionCount > 0 ? stats.inputTokens / stats.sessionCount : 0;
        stats.avgOutputPerSession = stats.sessionCount > 0 ? stats.outputTokens / stats.sessionCount : 0;
      }
    }
    
    // Write updated stats to persistent storage
    await this.writeCachedStats();
    
    return newEntries.length;
  }

  // Write cached stats to persistent storage
  private async writeCachedStats(): Promise<void> {
    const statsArray = Array.from(this.cachedHourlyStats.values()).sort((a, b) => a.hour.localeCompare(b.hour));
    const content = statsArray.map(stats => JSON.stringify(stats)).join('\n');
    await writeFile(this.logFile, content, 'utf-8');
  }

  async collect(): Promise<void> {
    await this.ensureDataDir();

    const entries = await this.loadClaudeData();
    const hourlyStats = new Map<string, HourlyStats>();

    // Aggregate data by hour
    for (const entry of entries) {
      const hourKey = this.getHourKey(entry.timestamp);

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
        });
      }

      const stats = hourlyStats.get(hourKey)!;
      const usage = entry.message?.usage;
      if (usage) {
        const inputTokens = usage.input_tokens || 0;
        const outputTokens = usage.output_tokens || 0;
        const cacheCreationTokens = usage.cache_creation_input_tokens || 0;
        const cacheReadTokens = usage.cache_read_input_tokens || 0;

        // Input tokens には通常の input + cache creation + cache read を含める（表示用）
        stats.inputTokens += inputTokens + cacheCreationTokens + cacheReadTokens;
        stats.outputTokens += outputTokens;
        stats.totalTokens += inputTokens + outputTokens + cacheCreationTokens + cacheReadTokens;
        stats.cost += entry.cost || 0;
        stats.sessionCount += 1;
      }
    }

    // Calculate averages
    for (const stats of hourlyStats.values()) {
      stats.avgInputPerSession = stats.sessionCount > 0 ? stats.inputTokens / stats.sessionCount : 0;
      stats.avgOutputPerSession = stats.sessionCount > 0 ? stats.outputTokens / stats.sessionCount : 0;
    }

    // Write to log file
    const logData = Array.from(hourlyStats.values())
      .sort((a, b) => a.hour.localeCompare(b.hour))
      .map(stats => JSON.stringify(stats))
      .join('\n');

    await writeFile(this.logFile, logData);
    // Silently collect data - only show message if explicitly called
    // console.log(`✅ Usage data collected and saved to ${this.logFile}`);
  }

  async report(options: { since?: string; until?: string; json?: boolean; tail?: number; rolling?: boolean; full?: boolean; noHeader?: boolean; costLimit?: number }): Promise<void> {
    // Auto-collect data before reporting with efficient incremental loading and time filtering
    await this.initializeCache();
    
    // Estimate required time range for efficient filtering
    let estimatedTail = options.tail;
    if (options.rolling && options.tail) {
      // For rolling mode, need additional 5 hours for rolling window calculation
      estimatedTail = options.tail + 5;
    }
    
    await this.collectIncremental({ since: options.since, tail: estimatedTail });

    try {
      // Use cached data instead of re-reading persistent file for better performance
      let records: HourlyStats[] = Array.from(this.cachedHourlyStats.values()).filter(record => record && record.hour);

      // Filter by date range
      if (options.since) {
        records = records.filter(r => r.hour >= options.since!);
      }
      if (options.until) {
        records = records.filter(r => r.hour <= options.until!);
      }

      // Note: tail limiting is now handled in display methods for consistent line-based behavior

      if (options.json) {
        console.log(JSON.stringify(records, null, 2));
        return;
      }

      if (options.rolling) {
        this.displayRollingUsage(records, options.full, options.noHeader, options.costLimit, options.tail || (options as any).maxDataRows);
      } else {
        this.displayTable(records, options.full, options.noHeader, options.tail);
      }
    } catch (error) {
      console.error('❌ No usage data found. Please ensure Claude Code has been used and logs exist in ~/.claude/projects/');
    }
  }

  private displayTable(records: HourlyStats[], full?: boolean, noHeader?: boolean, maxOutputLines?: number): void {
    if (records.length === 0) {
      console.log('No data found for the specified criteria.');
      return;
    }

    let displayRecords: HourlyStats[];
    
    if (full && records.length > 0) {
      // full オプション: 連続した時間を生成
      const sortedRecords = records.sort((a, b) => b.hour.localeCompare(a.hour));
      const latestHour = new Date(sortedRecords[0].hour + ':00');
      const hoursToShow = 24; // 24 時間分表示
      displayRecords = [];
      
      // 時間をマップに変換（高速検索用）
      const recordMap = new Map<string, HourlyStats>();
      for (const record of sortedRecords) {
        recordMap.set(record.hour, record);
      }
      
      // 連続した時間を生成
      for (let i = 0; i < hoursToShow; i++) {
        const currentHour = new Date(latestHour.getTime() - i * 60 * 60 * 1000);
        const hourKey = `${currentHour.getFullYear()}-${String(currentHour.getMonth() + 1).padStart(2, '0')}-${String(currentHour.getDate()).padStart(2, '0')} ${String(currentHour.getHours()).padStart(2, '0')}:00`;
        
        if (recordMap.has(hourKey)) {
          displayRecords.push(recordMap.get(hourKey)!);
        } else {
          // データがない時間は 0 で埋める
          displayRecords.push({
            hour: hourKey,
            inputTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
            cost: 0,
            sessionCount: 0,
            avgInputPerSession: 0,
            avgOutputPerSession: 0
          });
        }
      }
    } else {
      displayRecords = records;
    }

    if (!noHeader) {
      console.log('\n ╭─────────────────────────────────────────╮');
      console.log(' │                                         │');
      console.log(' │     ccmonitor - Hourly Usage Report     │');
      console.log(' │                                         │');
      console.log(' ╰─────────────────────────────────────────╯');
      console.log();
    }

    // ccusage スタイルの表
    const line1 = '┌──────────────────┬──────────────┬──────────────┬──────────────┬────────────┐';
    const line2 = '│ Hour             │        Input │       Output │        Total │ Cost (USD) │';
    const line3 = '├──────────────────┼──────────────┼──────────────┼──────────────┼────────────┤';

    console.log(line1);
    console.log(line2);
    console.log(line3);

    // Data rows
    let totalInput = 0, totalOutput = 0, totalCost = 0, totalSessions = 0;

    for (const record of displayRecords) {
      totalInput += record.inputTokens;
      totalOutput += record.outputTokens;
      totalCost += record.cost;
      totalSessions += record.sessionCount;

      const hour = record.hour.padEnd(16);
      const input = record.inputTokens.toLocaleString().padStart(12);
      const output = record.outputTokens.toLocaleString().padStart(12);
      const total = record.totalTokens.toLocaleString().padStart(12);
      const cost = `$${record.cost.toFixed(2)}`.padStart(10);

      console.log(`│ ${hour} │ ${input} │ ${output} │ ${total} │ ${cost} │`);
    }

    // Separator
    console.log('├──────────────────┼──────────────┼──────────────┼──────────────┼────────────┤');

    // Totals
    const totalHour = 'Total'.padEnd(16);
    const totalInputStr = totalInput.toLocaleString().padStart(12);
    const totalOutputStr = totalOutput.toLocaleString().padStart(12);
    const totalTotalStr = (totalInput + totalOutput).toLocaleString().padStart(12);
    const totalCostStr = `$${totalCost.toFixed(2)}`.padStart(10);

    console.log(`│ ${totalHour} │ ${totalInputStr} │ ${totalOutputStr} │ ${totalTotalStr} │ ${totalCostStr} │`);
    console.log('└──────────────────┴──────────────┴──────────────┴──────────────┴────────────┘');
    console.log();
  }

  private displayRollingUsage(records: HourlyStats[], full?: boolean, noHeader?: boolean, costLimit?: number, maxOutputLines?: number): void {
    if (records.length === 0) {
      console.log('No data found for the specified criteria.');
      return;
    }

    if (!noHeader) {
      console.log('\n ╭───────────────────────────────────────────╮');
      console.log(' │                                           │');
      console.log(' │    ccmonitor - Limit Monitor (5-Hour)     │');
      console.log(' │                                           │');
      console.log(' ╰───────────────────────────────────────────╯');
      console.log();
    }

    // Claude Pro の制限値（動的設定可能）
    const COST_LIMIT = costLimit || 10.0;  // Default: $10
    const TIME_WINDOW = 5;    // 5 時間

    // 最新の時刻から過去 5 時間のデータを計算
    // Filter out undefined records first
    const validRecords = records.filter(record => record && record.hour);
    const sortedRecords = validRecords.sort((a, b) => b.hour.localeCompare(a.hour));
    
    let displayRecords: HourlyStats[];
    
    if (full && sortedRecords.length > 0) {
      // full オプション: 連続した時間を生成
      const latestHour = new Date(sortedRecords[0].hour + ':00');
      const hoursToShow = 24; // 24 時間分生成（出力制限は後で行う）
      displayRecords = [];
      
      // 時間をマップに変換（高速検索用）
      const recordMap = new Map<string, HourlyStats>();
      for (const record of sortedRecords) {
        recordMap.set(record.hour, record);
      }
      
      // 連続した時間を生成
      for (let i = 0; i < hoursToShow; i++) {
        const currentHour = new Date(latestHour.getTime() - i * 60 * 60 * 1000);
        const hourKey = `${currentHour.getFullYear()}-${String(currentHour.getMonth() + 1).padStart(2, '0')}-${String(currentHour.getDate()).padStart(2, '0')} ${String(currentHour.getHours()).padStart(2, '0')}:00`;
        
        if (recordMap.has(hourKey)) {
          displayRecords.push(recordMap.get(hourKey)!);
        } else {
          // データがない時間は 0 で埋める
          displayRecords.push({
            hour: hourKey,
            inputTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
            cost: 0,
            sessionCount: 0,
            avgInputPerSession: 0,
            avgOutputPerSession: 0
          });
        }
      }
    } else {
      displayRecords = sortedRecords; // 出力制限は後で行う
    }

    console.log('┌──────────────────┬───────────┬───────────┬───────────────┐');
    console.log('│ Current Hour     │ Hour Cost │5-Hour Cost│ Limit Progress│');
    console.log('├──────────────────┼───────────┼───────────┼───────────────┤');

    let outputRowCount = 0;

    for (let i = 0; i < displayRecords.length; i++) {
      // Check if we've reached the max output lines limit (like Unix tail -n)
      if (maxOutputLines && outputRowCount >= maxOutputLines) {
        break;
      }

      const currentRecord = displayRecords[i];
      const currentHour = new Date(currentRecord.hour + ':00');

      // 過去 5 時間のデータを収集
      let rollingCost = 0;
      let rollingTokens = 0;

      for (const record of sortedRecords) {
        const recordHour = new Date(record.hour + ':00');
        const hoursDiff = (currentHour.getTime() - recordHour.getTime()) / (1000 * 60 * 60);

        if (hoursDiff >= 0 && hoursDiff < TIME_WINDOW) {
          rollingCost += record.cost;
          rollingTokens += record.totalTokens;
        }
      }

      const progressPercent = (rollingCost / COST_LIMIT * 100);
      const progressBar = this.createProgressBar(progressPercent);

      const hour = currentRecord.hour.padEnd(16);
      const hourCost = `$${currentRecord.cost.toFixed(2)}`.padStart(9);
      const rollingCostStr = `$${rollingCost.toFixed(2)}`.padStart(9);
      const progressText = `${progressPercent.toFixed(1)}%`.padStart(6);
      const progress = `${progressText} ${progressBar}`.padEnd(13);

      // 色付け: 80% 以上で赤、 60% 以上で黄色
      const colorCode = progressPercent >= 80 ? '\x1b[31m' : progressPercent >= 60 ? '\x1b[33m' : '\x1b[32m';
      const resetCode = '\x1b[0m';

      console.log(`│ ${hour} │ ${hourCost} │ ${rollingCostStr} │${colorCode}${progress}${resetCode}│`);
      outputRowCount++;

      // 警告表示（出力行数制限をチェック）
      if (progressPercent >= 90 && (!maxOutputLines || outputRowCount < maxOutputLines)) {
        console.log(`│ ${' '.repeat(16)} │ ${' '.repeat(9)} │ ${' '.repeat(9)} │ 🚨 OVER LIMIT │`);
        outputRowCount++;
      } else if (progressPercent >= 80 && (!maxOutputLines || outputRowCount < maxOutputLines)) {
        console.log(`│ ${' '.repeat(16)} │ ${' '.repeat(9)} │ ${' '.repeat(9)} │ ⚠️ HIGH USAGE │`);
        outputRowCount++;
      }
    }

    console.log('└──────────────────┴───────────┴───────────┴───────────────┘');

    if (!noHeader) {
      console.log();
      console.log('📊 Claude Code Limits:');
      console.log(`   • Cost Limit: $${COST_LIMIT.toFixed(2)} per ${TIME_WINDOW}-hour window`);
      console.log(`   • Time Window: Rolling ${TIME_WINDOW}-hour period`);
      console.log('   • Color: [32mGreen (Safe)[0m | [33mYellow (Caution)[0m | [31mRed (Danger)[0m');
      console.log();
    }
  }

  private createProgressBar(percent: number): string {
    const width = 8;
    const filled = Math.max(0, Math.min(width, Math.round((percent / 100) * width)));
    const empty = Math.max(0, width - filled);
    return '█'.repeat(filled) + '░'.repeat(empty);
  }

  // Efficient generate report output for watch mode (uses cached data)
  async generateReportOutputIncremental(options: { since?: string; until?: string; json?: boolean; tail?: number; rolling?: boolean; full?: boolean; noHeader?: boolean; costLimit?: number; maxDataRows?: number }): Promise<string> {
    // Use incremental data collection with time filtering for efficiency
    // Estimate required time range
    let estimatedTail = options.tail;
    if (options.rolling && options.tail) {
      // For rolling mode, need additional 5 hours for rolling window calculation
      estimatedTail = options.tail + 5;
    }
    
    await this.collectIncremental({ since: options.since, tail: estimatedTail });

    // Get data from cache instead of re-reading files
    let records: HourlyStats[] = Array.from(this.cachedHourlyStats.values()).filter(record => record && record.hour);

    // Filter by date range
    if (options.since) {
      records = records.filter(r => r.hour >= options.since!);
    }
    if (options.until) {
      records = records.filter(r => r.hour <= options.until!);
    }

    if (options.json) {
      return JSON.stringify(records, null, 2);
    }

    if (options.rolling) {
      return this.generateRollingUsageOutput(records, options.full, options.noHeader, options.costLimit, options.tail || options.maxDataRows);
    } else {
      return this.generateTableOutput(records, options.full, options.noHeader, options.tail);
    }
  }

  // Generate rolling output using incremental cache (for efficient watch mode)
  async generateRollingOutputIncremental(options: { since?: string; until?: string; json?: boolean; tail?: number; full?: boolean; noHeader?: boolean; costLimit?: number; maxDataRows?: number }): Promise<string> {
    // Update cache with only new/changed data, with time filtering for efficiency
    // For rolling mode, need additional 5 hours for rolling window calculation
    const estimatedTail = options.tail ? options.tail + 5 : undefined;
    await this.collectIncremental({ since: options.since, tail: estimatedTail });

    // Get data from cache instead of re-reading files
    let records: HourlyStats[] = Array.from(this.cachedHourlyStats.values()).filter(record => record && record.hour);

    // Filter by date range
    if (options.since) {
      records = records.filter(r => r.hour >= options.since!);
    }
    if (options.until) {
      records = records.filter(r => r.hour <= options.until!);
    }

    if (options.json) {
      return JSON.stringify(records, null, 2);
    }

    return this.generateRollingUsageOutput(records, options.full, options.noHeader, options.costLimit, options.tail || options.maxDataRows);
  }

  // Generate report output as string (for buffered output in watch mode)
  async generateReportOutput(options: { since?: string; until?: string; json?: boolean; tail?: number; rolling?: boolean; full?: boolean; noHeader?: boolean; costLimit?: number; maxDataRows?: number }): Promise<string> {
    // Auto-collect data before reporting with efficient incremental loading and time filtering
    await this.initializeCache();
    
    // Estimate required time range for efficient filtering
    let estimatedTail = options.tail;
    if (options.rolling && options.tail) {
      // For rolling mode, need additional 5 hours for rolling window calculation
      estimatedTail = options.tail + 5;
    }
    
    await this.collectIncremental({ since: options.since, tail: estimatedTail });

    try {
      // Use cached data instead of re-reading persistent file for better performance
      let records: HourlyStats[] = Array.from(this.cachedHourlyStats.values()).filter(record => record && record.hour);

      // Filter by date range
      if (options.since) {
        records = records.filter(r => r.hour >= options.since!);
      }
      if (options.until) {
        records = records.filter(r => r.hour <= options.until!);
      }

      // Note: tail limiting is now handled in display methods for consistent line-based behavior

      if (options.json) {
        return JSON.stringify(records, null, 2);
      }

      if (options.rolling) {
        return this.generateRollingUsageOutput(records, options.full, options.noHeader, options.costLimit, options.tail || options.maxDataRows);
      } else {
        return this.generateTableOutput(records, options.full, options.noHeader, options.tail);
      }
    } catch (error) {
      return '❌ No usage data found. Please ensure Claude Code has been used and logs exist in ~/.claude/projects/';
    }
  }

  // Generate rolling usage output as string
  private generateRollingUsageOutput(records: HourlyStats[], full?: boolean, noHeader?: boolean, costLimit?: number, maxOutputLines?: number): string {
    if (records.length === 0) {
      return 'No data found for the specified criteria.';
    }

    let output = '';

    if (!noHeader) {
      output += ' ╭───────────────────────────────────────────╮\n';
      output += ' │                                           │\n';
      output += ' │    ccmonitor - Limit Monitor (5-Hour)     │\n';
      output += ' │                                           │\n';
      output += ' ╰───────────────────────────────────────────╯\n';
      output += '\n';
    }

    // Claude Pro の制限値（動的設定可能）
    const COST_LIMIT = costLimit || 10.0;  // Default: $10
    const TIME_WINDOW = 5;    // 5 時間

    // 最新の時刻から過去 5 時間のデータを計算
    // Filter out undefined records first
    const validRecords = records.filter(record => record && record.hour);
    const sortedRecords = validRecords.sort((a, b) => b.hour.localeCompare(a.hour));
    
    let displayRecords: HourlyStats[];
    
    if (full && sortedRecords.length > 0) {
      // full オプション: 連続した時間を生成
      const latestHour = new Date(sortedRecords[0].hour + ':00');
      const hoursToShow = 24; // 24 時間分生成（出力制限は後で行う）
      displayRecords = [];
      
      // 時間をマップに変換（高速検索用）
      const recordMap = new Map<string, HourlyStats>();
      for (const record of sortedRecords) {
        recordMap.set(record.hour, record);
      }
      
      // 連続した時間を生成
      for (let i = 0; i < hoursToShow; i++) {
        const currentHour = new Date(latestHour.getTime() - i * 60 * 60 * 1000);
        const hourKey = `${currentHour.getFullYear()}-${String(currentHour.getMonth() + 1).padStart(2, '0')}-${String(currentHour.getDate()).padStart(2, '0')} ${String(currentHour.getHours()).padStart(2, '0')}:00`;
        
        if (recordMap.has(hourKey)) {
          displayRecords.push(recordMap.get(hourKey)!);
        } else {
          // データがない時間は 0 で埋める
          displayRecords.push({
            hour: hourKey,
            inputTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
            cost: 0,
            sessionCount: 0,
            avgInputPerSession: 0,
            avgOutputPerSession: 0
          });
        }
      }
    } else {
      displayRecords = sortedRecords; // 出力制限は後で行う
    }

    output += '┌──────────────────┬───────────┬───────────┬───────────────┐\n';
    output += '│ Current Hour     │ Hour Cost │5-Hour Cost│ Limit Progress│\n';
    output += '├──────────────────┼───────────┼───────────┼───────────────┤\n';

    let outputRowCount = 0;

    for (let i = 0; i < displayRecords.length; i++) {
      // Check if we've reached the max output lines limit (like Unix tail -n)
      if (maxOutputLines && outputRowCount >= maxOutputLines) {
        break;
      }

      const currentRecord = displayRecords[i];
      const currentHour = new Date(currentRecord.hour + ':00');

      // 過去 5 時間のデータを収集
      let rollingCost = 0;
      let rollingTokens = 0;

      for (const record of sortedRecords) {
        const recordHour = new Date(record.hour + ':00');
        const hoursDiff = (currentHour.getTime() - recordHour.getTime()) / (1000 * 60 * 60);

        if (hoursDiff >= 0 && hoursDiff < TIME_WINDOW) {
          rollingCost += record.cost;
          rollingTokens += record.totalTokens;
        }
      }

      const progressPercent = (rollingCost / COST_LIMIT * 100);
      const progressBar = this.createProgressBar(progressPercent);

      const hour = currentRecord.hour.padEnd(16);
      const hourCost = `$${currentRecord.cost.toFixed(2)}`.padStart(9);
      const rollingCostStr = `$${rollingCost.toFixed(2)}`.padStart(9);
      const progressText = `${progressPercent.toFixed(1)}%`.padStart(6);
      const progress = `${progressText} ${progressBar}`.padEnd(13);

      // 色付け: 80% 以上で赤、 60% 以上で黄色
      const colorCode = progressPercent >= 80 ? '\x1b[31m' : progressPercent >= 60 ? '\x1b[33m' : '\x1b[32m';
      const resetCode = '\x1b[0m';

      output += `│ ${hour} │ ${hourCost} │ ${rollingCostStr} │${colorCode}${progress}${resetCode}│\n`;
      outputRowCount++;

      // 警告表示（出力行数制限をチェック）
      if (progressPercent >= 90 && (!maxOutputLines || outputRowCount < maxOutputLines)) {
        output += `│ ${' '.repeat(16)} │ ${' '.repeat(9)} │ ${' '.repeat(9)} │ 🚨 OVER LIMIT │\n`;
        outputRowCount++;
      } else if (progressPercent >= 80 && (!maxOutputLines || outputRowCount < maxOutputLines)) {
        output += `│ ${' '.repeat(16)} │ ${' '.repeat(9)} │ ${' '.repeat(9)} │ ⚠️ HIGH USAGE │\n`;
        outputRowCount++;
      }
    }

    output += '└──────────────────┴───────────┴───────────┴───────────────┘\n';

    if (!noHeader) {
      output += '\n📊 Claude Code Limits:\n';
      output += '   • Cost Limit: $' + COST_LIMIT.toFixed(2) + ' per 5-hour window\n';
      output += '   • Time Window: Rolling 5-hour period\n';
      output += '   • Color: \x1b[32mGreen (Safe)\x1b[0m | \x1b[33mYellow (Caution)\x1b[0m | \x1b[31mRed (Danger)\x1b[0m\n';
    }

    return output;
  }

  // Generate table output as string
  private generateTableOutput(records: HourlyStats[], full?: boolean, noHeader?: boolean, maxOutputLines?: number): string {
    // For now, just return a placeholder - we can implement this if needed for table mode
    return 'Table output not implemented yet for buffered mode';
  }

  async watchMode(options: {
    interval: number;
    since?: string;
    until?: string;
    tail?: number;
    full: boolean;
    noHeader: boolean;
    costLimit: number;
  }): Promise<void> {
    let isRunning = true;
    
    // Graceful shutdown handler
    const shutdown = () => {
      isRunning = false;
      console.log('\n👋 Watch mode stopped');
      process.exit(0);
    };
    
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    
    // Show initial message briefly, then start watch mode
    console.clear();
    console.log(`🔄 Starting watch mode (refresh every ${options.interval}s)`);
    console.log('   Press Ctrl+C to stop');
    
    // Initialize cache for efficient incremental data loading (issue #3 response)
    console.log('   Initializing cache for efficient monitoring...');
    await this.initializeCache();
    
    // Wait a brief moment to show the message, then start
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    let isFirstRun = true;
    
    while (isRunning) {
      try {
        // Prepare timestamp
        const now = new Date();
        
        // Calculate available rows like watch command
        const terminalRows = process.stdout.rows || 24;
        // Reserve space for:
        // - Last updated line (1) + empty line (1)
        // - Header box (5 lines if not noHeader, 0 if noHeader)
        // - Table header (3 lines) + table footer (1 line) + empty line (1)
        // - Limits info (4 lines if not noHeader, 0 if noHeader)
        const reservedRows = options.noHeader ? 
          1 + 1 + 3 + 1 + 1 :  // 7 lines total
          1 + 1 + 5 + 1 + 3 + 1 + 1 + 4; // 17 lines total
        const availableDataRows = Math.max(1, terminalRows - reservedRows);
        
        // Auto-adjust tail to fit terminal size (like watch command)
        const effectiveTail = options.tail ? Math.min(options.tail, availableDataRows) : availableDataRows;
        
        // Use efficient incremental data loading (issue #3 response) 
        // For rolling mode, need additional 5 hours for rolling window calculation
        const estimatedTail = effectiveTail + 5;
        await this.collectIncremental({ since: options.since, tail: estimatedTail });
        
        // Get cached data and generate buffered output
        let records: HourlyStats[] = Array.from(this.cachedHourlyStats.values()).filter(record => record && record.hour);
        
        // Filter by date range
        if (options.since) {
          records = records.filter(r => r.hour >= options.since!);
        }
        if (options.until) {
          records = records.filter(r => r.hour <= options.until!);
        }
        
        const output = this.generateRollingUsageOutput(records, options.full, options.noHeader, options.costLimit, effectiveTail);

        const timestamp = `⏰ Last updated: ${now.toLocaleTimeString()} (refreshing every ${options.interval}s)`;
        
        // Build complete output in buffer to prevent cursor flashing
        const completeOutput = timestamp + '\n\n' + output.trimEnd();
        
        // Clear screen and move to home position, then output everything at once
        process.stdout.write('\x1b[2J\x1b[3J\x1b[H' + completeOutput + '\n');
        
        isFirstRun = false;
        
      } catch (error) {
        console.error('❌ Error during watch update:', error);
        console.error('Error details:', error.message);
        console.error('Stack trace:', error.stack);
        // Continue watching despite errors
      }
      
      // Wait for next update
      await new Promise(resolve => setTimeout(resolve, options.interval * 1000));
    }
  }

  // Testing helper methods
  getCacheSize(): number {
    return this.cachedHourlyStats.size;
  }

  getSeenMessageIds(): Set<string> {
    return this.seenMessageIds;
  }

  getCachedStats(): Map<string, HourlyStats> {
    return this.cachedHourlyStats;
  }

  // For testing purposes - allows manual cache initialization
  async initializeCache(): Promise<void> {
    this.cachedHourlyStats.clear();
    this.seenMessageIds.clear();
    
    // Load existing data from persistent storage if it exists
    try {
      const content = await readFile(this.logFile, 'utf-8');
      const lines = content.trim().split('\n');
      
      for (const line of lines) {
        try {
          const record = JSON.parse(line);
          const hourStats: HourlyStats = {
            hour: record.hour,
            inputTokens: record.inputTokens,
            outputTokens: record.outputTokens,
            totalTokens: record.totalTokens,
            cost: record.cost,
            sessionCount: record.sessionCount,
            avgInputPerSession: record.inputTokens / record.sessionCount,
            avgOutputPerSession: record.outputTokens / record.sessionCount
          };
          this.cachedHourlyStats.set(record.hour, hourStats);
        } catch (e) {
          // Skip malformed lines
        }
      }
    } catch (error) {
      // No existing cache file, start fresh
    }

    // Also populate from Claude logs
    const entries = await this.loadClaudeData();
    for (const entry of entries) {
      if (entry.message?.id) {
        this.seenMessageIds.add(entry.message.id);
      }
    }
  }

}

// CLI Interface
async function main() {
  // Pre-process args to handle --watch without value
  let args = process.argv.slice(2);
  let watchIndex = -1;
  
  // Find --watch option
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--watch') {
      watchIndex = i;
      break;
    }
  }
  
  // If --watch found without value, add default value
  if (watchIndex !== -1) {
    if (watchIndex + 1 >= args.length || args[watchIndex + 1].startsWith('-')) {
      // No value provided or next arg is another option, insert default
      args.splice(watchIndex + 1, 0, '60');
    }
  }

  const { values, positionals } = parseArgs({
    args: args,
    options: {
      'path': { type: 'string', short: 'p' },
      'claude-dir': { type: 'string' },
      'since': { type: 'string', short: 's' },
      'until': { type: 'string', short: 'u' },
      'json': { type: 'boolean', short: 'j' },
      'tail': { type: 'string', short: 't' },
      'help': { type: 'boolean', short: 'h' },
      'version': { type: 'boolean', short: 'v' },
      'rolling': { type: 'boolean', short: 'r' },
      'full': { type: 'boolean', short: 'f' },
      'no-header': { type: 'boolean' },
      'cost-limit': { type: 'string' },
      'watch': { type: 'string' }
    },
    allowPositionals: true
  });

  if (values.help) {
    console.log(`
ccmonitor - Claude Code 使用量監視ツール

USAGE:
  ccmonitor <command> [options]

COMMANDS:
  report      Show hourly usage report (auto-collects data)
  rolling     Show 5-hour rolling usage (auto-collects data)

OPTIONS:
  -p, --path <path>        Custom data directory (default: ~/.ccmonitor)
  --claude-dir <path>      Custom Claude directory (default: ~/.claude)
  -s, --since <datetime>   Filter from datetime (YYYY-MM-DD HH:mm format)
  -u, --until <datetime>   Filter until datetime (YYYY-MM-DD HH:mm format)
  -t, --tail <number>      Show last N hours only
  -j, --json              Output in JSON format
  -r, --rolling           Show 5-hour rolling usage monitor
  -f, --full              Show all hours including zero usage (for rolling mode)
  --no-header             Hide feature description headers for compact display
  --cost-limit <amount>   Set custom cost limit for rolling usage monitor (default: 10)
  --watch [interval]      Watch mode with auto-refresh (default: 60 seconds)
  -h, --help              Show this help
  -v, --version           Show version

EXAMPLES:
  ccmonitor report
  ccmonitor rolling
  ccmonitor rolling --full
  ccmonitor report --since "2025-06-15 09:00" --tail 24
  ccmonitor report --rolling --full
  ccmonitor report --json
  
  # Custom cost limits for different plans
  ccmonitor rolling --cost-limit 50   # For Max $100 plan
  ccmonitor rolling --cost-limit 200  # For Max $200 plan
  
  # Compact display without headers (useful for scripting)
  ccmonitor report --no-header --tail 5
  ccmonitor rolling --no-header
  
  # Watch mode for continuous monitoring
  ccmonitor rolling --watch          # Default 60 seconds
  ccmonitor rolling --watch 30       # Every 30 seconds
  ccmonitor rolling --watch 120 --cost-limit 50
`);
    return;
  }

  if (values.version) {
    console.log('ccmonitor v3.4.0');
    return;
  }

  // Validate --cost-limit option
  let costLimit = 10.0; // Default value
  if (values['cost-limit']) {
    const parsedCostLimit = parseFloat(values['cost-limit'] as string);
    if (isNaN(parsedCostLimit) || parsedCostLimit <= 0 || parsedCostLimit > 10000) {
      console.error('❌ Error: --cost-limit must be a number between 1 and 10000');
      process.exit(1);
    }
    costLimit = parsedCostLimit;
  }

  const command = positionals[0] || 'report';
  const monitor = new ClaudeUsageMonitor(values.path as string, values['claude-dir'] as string);

  switch (command) {
    case 'report':
      await monitor.report({
        since: values.since as string,
        until: values.until as string,
        json: values.json as boolean,
        tail: values.tail ? parseInt(values.tail as string) : undefined,
        rolling: values.rolling as boolean,
        full: values.full as boolean,
        noHeader: values['no-header'] as boolean,
        costLimit: costLimit
      });
      break;
    case 'rolling':
      // Handle --watch mode
      if (values.watch !== undefined) {
        const watchInterval = values.watch === '' ? 60 : parseInt(values.watch as string);
        if (isNaN(watchInterval) || watchInterval < 5) {
          console.error('❌ Error: --watch interval must be 5 seconds or more');
          process.exit(1);
        }
        
        await monitor.watchMode({
          interval: watchInterval,
          since: values.since as string,
          until: values.until as string,
          tail: values.tail ? parseInt(values.tail as string) : undefined,
          full: values.full as boolean,
          noHeader: values['no-header'] as boolean,
          costLimit: costLimit
        });
      } else {
        await monitor.report({
          since: values.since as string,
          until: values.until as string,
          json: values.json as boolean,
          tail: values.tail ? parseInt(values.tail as string) : undefined, // Don't limit for rolling - need 5-hour window data
          rolling: true,
          full: values.full as boolean,
          noHeader: values['no-header'] as boolean,
          costLimit: costLimit
        });
      }
      break;
    default:
      console.error(`Unknown command: ${command}`);
      console.error('Available commands: report, rolling');
      console.error('Run --help for usage information');
      process.exit(1);
  }
}

if (import.meta.main) {
  main().catch(error => {
    console.error('❌ Fatal error in ccmonitor:', error);
    console.error('Stack trace:', error.stack);
    process.exit(1);
  });
}
