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

  constructor(dataPath?: string, claudeDir?: string) {
    this.dataPath = dataPath || join(homedir(), '.claude-usage-monitor');
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

  private calculateCost(inputTokens: number, outputTokens: number, cacheCreationTokens: number = 0, cacheReadTokens: number = 0): number {
    // Claude Sonnet 4の正確な料金レート（ccusageと同じ）
    const INPUT_COST_PER_1K = 0.003;        // $0.003 per 1K input tokens
    const OUTPUT_COST_PER_1K = 0.015;       // $0.015 per 1K output tokens
    const CACHE_CREATION_COST_PER_1K = 0.0037; // $0.0037 per 1K cache creation tokens
    const CACHE_READ_COST_PER_1K = 0.0003;     // $0.0003 per 1K cache read tokens
    
    return (inputTokens / 1000) * INPUT_COST_PER_1K + 
           (outputTokens / 1000) * OUTPUT_COST_PER_1K +
           (cacheCreationTokens / 1000) * CACHE_CREATION_COST_PER_1K +
           (cacheReadTokens / 1000) * CACHE_READ_COST_PER_1K;
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
                    entries.push({
                      timestamp: entry.timestamp,
                      type: entry.type,
                      message: entry.message,
                      cost: this.calculateCost(inputTokens, outputTokens, cacheCreationTokens, cacheReadTokens)
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
        
        // Input tokensには通常のinput + cache creation + cache readを含める（表示用）
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
    console.log(`✅ Usage data collected and saved to ${this.logFile}`);
  }

  async report(options: { since?: string; until?: string; json?: boolean; tail?: number; rolling?: boolean }): Promise<void> {
    // Auto-collect data before reporting (like ccusage)
    await this.collect();
    
    try {
      const content = await readFile(this.logFile, 'utf-8');
      let records: HourlyStats[] = content.trim().split('\n').map(line => JSON.parse(line));
      
      // Filter by date range
      if (options.since) {
        records = records.filter(r => r.hour >= options.since!);
      }
      if (options.until) {
        records = records.filter(r => r.hour <= options.until!);
      }
      
      // Get last N records if tail is specified
      if (options.tail) {
        records = records.slice(-options.tail);
      }
      
      if (options.json) {
        console.log(JSON.stringify(records, null, 2));
        return;
      }
      
      if (options.rolling) {
        this.displayRollingUsage(records);
      } else {
        this.displayTable(records);
      }
    } catch (error) {
      console.error('❌ No usage data found. Please ensure Claude Code has been used and logs exist in ~/.claude/projects/');
    }
  }

  private displayTable(records: HourlyStats[]): void {
    if (records.length === 0) {
      console.log('No data found for the specified criteria.');
      return;
    }
    
    console.log('\n ╭──────────────────────────────────────────╮');
    console.log(' │                                          │');
    console.log(' │  Claude Code Token Usage Report - Hourly │');
    console.log(' │                                          │');
    console.log(' ╰──────────────────────────────────────────╯');
    console.log();
    
    // ccusageスタイルの表
    const line1 = '┌──────────────────┬──────────────┬──────────────┬──────────────┬────────────┐';
    const line2 = '│ Hour             │        Input │       Output │        Total │ Cost (USD) │';
    const line3 = '├──────────────────┼──────────────┼──────────────┼──────────────┼────────────┤';
    
    console.log(line1);
    console.log(line2);
    console.log(line3);
    
    // Data rows
    let totalInput = 0, totalOutput = 0, totalCost = 0, totalSessions = 0;
    
    for (const record of records) {
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

  private displayRollingUsage(records: HourlyStats[]): void {
    if (records.length === 0) {
      console.log('No data found for the specified criteria.');
      return;
    }
    
    console.log('\n ╭───────────────────────────────────────────────╮');
    console.log(' │                                               │');
    console.log(' │  Claude Code Pro Usage Limit Monitor (5-Hour) │');
    console.log(' │                                               │');
    console.log(' ╰───────────────────────────────────────────────╯');
    console.log();
    
    // Claude Proの制限値
    const COST_LIMIT = 10.0;  // $10
    const TIME_WINDOW = 5;    // 5時間
    
    // 最新の時刻から過去5時間のデータを計算
    const sortedRecords = records.sort((a, b) => b.hour.localeCompare(a.hour));
    
    console.log('┌──────────────────┬────────────┬────────────┬───────────────┐');
    console.log('│ Current Hour     │ Hour Cost  │ 5-Hour Cost│ Limit Progress│');
    console.log('├──────────────────┼────────────┼────────────┼───────────────┤');
    
    for (let i = 0; i < Math.min(sortedRecords.length, 24); i++) {
      const currentRecord = sortedRecords[i];
      const currentHour = new Date(currentRecord.hour + ':00');
      
      // 過去5時間のデータを収集
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
      const hourCost = `$${currentRecord.cost.toFixed(2)}`.padStart(10);
      const rollingCostStr = `$${rollingCost.toFixed(2)}`.padStart(10);
      const progressText = `${progressPercent.toFixed(1)}%`.padStart(6);
      const progress = `${progressText} ${progressBar}`.padEnd(13);
      
      // 色付け: 80%以上で赤、60%以上で黄色
      const colorCode = progressPercent >= 80 ? '\x1b[31m' : progressPercent >= 60 ? '\x1b[33m' : '\x1b[32m';
      const resetCode = '\x1b[0m';
      
      console.log(`│ ${hour} │ ${hourCost} │ ${rollingCostStr} │${colorCode}${progress}${resetCode}│`);
      
      // 警告表示
      if (progressPercent >= 90) {
        console.log(`│ ${' '.repeat(16)} │ ${' '.repeat(10)} │ ${' '.repeat(10)} │ 🚨 OVER LIMIT │`);
      } else if (progressPercent >= 80) {
        console.log(`│ ${' '.repeat(16)} │ ${' '.repeat(10)} │ ${' '.repeat(10)} │ ⚠️ HIGH USAGE │`);
      }
    }
    
    console.log('└──────────────────┴────────────┴────────────┴───────────────┘');
    
    console.log();
    console.log('📊 Claude Code Pro Limits:');
    console.log(`   • Cost Limit: $${COST_LIMIT.toFixed(2)} per ${TIME_WINDOW}-hour window`);
    console.log(`   • Time Window: Rolling ${TIME_WINDOW}-hour period`);
    console.log('   • Color: [32mGreen (Safe)[0m | [33mYellow (Caution)[0m | [31mRed (Danger)[0m');
    console.log();
  }
  
  private createProgressBar(percent: number): string {
    const width = 8;
    const filled = Math.max(0, Math.min(width, Math.round((percent / 100) * width)));
    const empty = Math.max(0, width - filled);
    return '█'.repeat(filled) + '░'.repeat(empty);
  }

}

// CLI Interface
async function main() {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: {
      'path': { type: 'string', short: 'p' },
      'claude-dir': { type: 'string' },
      'since': { type: 'string', short: 's' },
      'until': { type: 'string', short: 'u' },
      'json': { type: 'boolean', short: 'j' },
      'tail': { type: 'string', short: 't' },
      'help': { type: 'boolean', short: 'h' },
      'version': { type: 'boolean', short: 'v' },
      'rolling': { type: 'boolean', short: 'r' }
    },
    allowPositionals: true
  });
  
  if (values.help) {
    console.log(`
Claude Usage Monitor - 時間別使用量監視ツール

USAGE:
  claude-usage-monitor <command> [options]

COMMANDS:
  report      Show hourly usage report (auto-collects data)
  rolling     Show 5-hour rolling usage (auto-collects data)

OPTIONS:
  -p, --path <path>        Custom data directory (default: ~/.claude-usage-monitor)
  --claude-dir <path>      Custom Claude directory (default: ~/.claude)
  -s, --since <datetime>   Filter from datetime (YYYY-MM-DD HH:mm format)
  -u, --until <datetime>   Filter until datetime (YYYY-MM-DD HH:mm format)
  -t, --tail <number>      Show last N hours only
  -j, --json              Output in JSON format
  -r, --rolling           Show 5-hour rolling usage monitor
  -h, --help              Show this help
  -v, --version           Show version

EXAMPLES:
  claude-usage-monitor report
  claude-usage-monitor rolling
  claude-usage-monitor report --since "2025-06-15 09:00" --tail 24
  claude-usage-monitor report --rolling
  claude-usage-monitor report --json
`);
    return;
  }
  
  if (values.version) {
    console.log('Claude Usage Monitor v1.0.0');
    return;
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
        rolling: values.rolling as boolean
      });
      break;
    case 'rolling':
      await monitor.report({
        since: values.since as string,
        until: values.until as string,
        json: values.json as boolean,
        tail: values.tail ? parseInt(values.tail as string) : undefined,
        rolling: true
      });
      break;
    default:
      console.error(`Unknown command: ${command}`);
      console.error('Available commands: report, rolling');
      console.error('Run --help for usage information');
      process.exit(1);
  }
}

if (import.meta.main) {
  main().catch(console.error);
}

