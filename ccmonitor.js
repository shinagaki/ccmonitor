#!/usr/bin/env node

const { readdir, readFile, writeFile, mkdir, stat } = require('fs/promises');
const { join, resolve } = require('path');
const { homedir } = require('os');
const { parseArgs } = require('util');

// Version information from package.json
const currentVersion = '3.4.0';

class ClaudeUsageMonitor {
  constructor(dataPath, claudeDir) {
    this.dataPath = dataPath || join(homedir(), '.ccmonitor');
    this.logFile = join(this.dataPath, 'usage-log.jsonl');
    this.claudeDir = claudeDir || join(homedir(), '.claude');
  }

  async ensureDataDir() {
    try {
      await mkdir(this.dataPath, { recursive: true });
    } catch (error) {
      // Directory already exists
    }
  }

  calculateCost(inputTokens, outputTokens, cacheCreationTokens = 0, cacheReadTokens = 0, model = 'claude-sonnet-4-20250514') {
    // モデル別の正確な料金レート（Anthropic 公式料金）
    const pricingTable = {
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

  async loadClaudeData() {
    const entries = [];
    const seenMessageIds = new Set();

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

  getHourKey(timestamp) {
    const date = new Date(timestamp);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:00`;
  }

  async collect() {
    await this.ensureDataDir();

    const entries = await this.loadClaudeData();
    const hourlyStats = new Map();

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

      const stats = hourlyStats.get(hourKey);
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
  }

  async report(options = {}) {
    // Auto-collect data before reporting (like ccusage)
    await this.collect();

    try {
      const content = await readFile(this.logFile, 'utf-8');
      let records = content.trim().split('\n').map(line => JSON.parse(line));

      // Filter by date range
      if (options.since) {
        records = records.filter(r => r.hour >= options.since);
      }
      if (options.until) {
        records = records.filter(r => r.hour <= options.until);
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
        this.displayRollingUsage(records, options.full, options.noHeader, options.costLimit);
      } else {
        this.displayTable(records, options.full, options.noHeader);
      }
    } catch (error) {
      console.error('❌ No usage data found. Please ensure Claude Code has been used and logs exist in ~/.claude/projects/');
    }
  }

  displayTable(records, full, noHeader) {
    if (records.length === 0) {
      console.log('No data found for the specified criteria.');
      return;
    }

    let displayRecords;
    
    if (full && records.length > 0) {
      // full オプション: 連続した時間を生成
      const sortedRecords = records.sort((a, b) => b.hour.localeCompare(a.hour));
      const latestHour = new Date(sortedRecords[0].hour + ':00');
      const hoursToShow = 24; // 24 時間分表示
      displayRecords = [];
      
      // 時間をマップに変換（高速検索用）
      const recordMap = new Map();
      for (const record of sortedRecords) {
        recordMap.set(record.hour, record);
      }
      
      // 連続した時間を生成
      for (let i = 0; i < hoursToShow; i++) {
        const currentHour = new Date(latestHour.getTime() - i * 60 * 60 * 1000);
        const hourKey = `${currentHour.getFullYear()}-${String(currentHour.getMonth() + 1).padStart(2, '0')}-${String(currentHour.getDate()).padStart(2, '0')} ${String(currentHour.getHours()).padStart(2, '0')}:00`;
        
        if (recordMap.has(hourKey)) {
          displayRecords.push(recordMap.get(hourKey));
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

  displayRollingUsage(records, full, noHeader, costLimit) {
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
    const sortedRecords = records.sort((a, b) => b.hour.localeCompare(a.hour));
    
    let displayRecords;
    
    if (full && sortedRecords.length > 0) {
      // full オプション: 連続した時間を生成
      const latestHour = new Date(sortedRecords[0].hour + ':00');
      const hoursToShow = 24; // 24 時間分表示
      displayRecords = [];
      
      // 時間をマップに変換（高速検索用）
      const recordMap = new Map();
      for (const record of sortedRecords) {
        recordMap.set(record.hour, record);
      }
      
      // 連続した時間を生成
      for (let i = 0; i < hoursToShow; i++) {
        const currentHour = new Date(latestHour.getTime() - i * 60 * 60 * 1000);
        const hourKey = `${currentHour.getFullYear()}-${String(currentHour.getMonth() + 1).padStart(2, '0')}-${String(currentHour.getDate()).padStart(2, '0')} ${String(currentHour.getHours()).padStart(2, '0')}:00`;
        
        if (recordMap.has(hourKey)) {
          displayRecords.push(recordMap.get(hourKey));
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
      displayRecords = sortedRecords;
    }

    console.log('┌──────────────────┬───────────┬───────────┬───────────────┐');
    console.log('│ Current Hour     │ Hour Cost │5-Hour Cost│ Limit Progress│');
    console.log('├──────────────────┼───────────┼───────────┼───────────────┤');

    for (let i = 0; i < Math.min(displayRecords.length, 24); i++) {
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

      // 警告表示
      if (progressPercent >= 90) {
        console.log(`│ ${' '.repeat(16)} │ ${' '.repeat(9)} │ ${' '.repeat(9)} │ 🚨 OVER LIMIT │`);
      } else if (progressPercent >= 80) {
        console.log(`│ ${' '.repeat(16)} │ ${' '.repeat(9)} │ ${' '.repeat(9)} │ ⚠️ HIGH USAGE │`);
      }
    }

    console.log('└──────────────────┴───────────┴───────────┴───────────────┘');

    if (!noHeader) {
      console.log();
      console.log('📊 Claude Code Limits:');
      console.log(`   • Cost Limit: $${COST_LIMIT.toFixed(2)} per ${TIME_WINDOW}-hour window`);
      console.log(`   • Time Window: Rolling ${TIME_WINDOW}-hour period`);
      console.log('   • Color: \x1b[32mGreen (Safe)\x1b[0m | \x1b[33mYellow (Caution)\x1b[0m | \x1b[31mRed (Danger)\x1b[0m');
      console.log();
    }
  }

  createProgressBar(percent) {
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
      'rolling': { type: 'boolean', short: 'r' },
      'full': { type: 'boolean', short: 'f' },
      'no-header': { type: 'boolean' },
      'cost-limit': { type: 'string' }
    },
    allowPositionals: true
  });

  if (values.help) {
    console.log(`
ccmonitor - Claude Code 使用量監視ツール

USAGE:
  ccmonitor [command] [options]

COMMANDS:
  report      Show hourly usage report (auto-collects data)
  rolling     Show 5-hour rolling usage (auto-collects data)

OPTIONS:
  -p, --path         Custom data directory (default: ~/.ccmonitor)
  --claude-dir       Custom Claude directory (default: ~/.claude)
  -s, --since        Filter from datetime (YYYY-MM-DD HH:mm format)
  -u, --until        Filter until datetime (YYYY-MM-DD HH:mm format)
  -t, --tail         Show last N hours only
  -j, --json         Output in JSON format
  -r, --rolling      Show 5-hour rolling usage monitor
  -f, --full         Show all hours including zero usage (for rolling mode)
  --no-header        Hide feature description headers for compact display
  --cost-limit <amount>   Set custom cost limit for rolling usage monitor (default: 10)
  -h, --help         Show this help
  -v, --version      Show version

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
`);
    return;
  }

  if (values.version) {
    console.log(`ccmonitor v${currentVersion}`);
    return;
  }

  // Validate --cost-limit option
  let costLimit = 10.0; // Default value
  if (values['cost-limit']) {
    const parsedCostLimit = parseFloat(values['cost-limit']);
    if (isNaN(parsedCostLimit) || parsedCostLimit <= 0 || parsedCostLimit > 10000) {
      console.error('❌ Error: --cost-limit must be a number between 1 and 10000');
      process.exit(1);
    }
    costLimit = parsedCostLimit;
  }

  const command = positionals[0] || 'report';
  const monitor = new ClaudeUsageMonitor(values.path, values['claude-dir']);

  switch (command) {
    case 'report':
      await monitor.report({
        since: values.since,
        until: values.until,
        json: values.json,
        tail: values.tail ? parseInt(values.tail) : undefined,
        rolling: values.rolling,
        full: values.full,
        noHeader: values['no-header'],
        costLimit: costLimit
      });
      break;
    case 'rolling':
      await monitor.report({
        since: values.since,
        until: values.until,
        json: values.json,
        tail: values.tail ? parseInt(values.tail) : undefined,
        rolling: true,
        full: values.full,
        noHeader: values['no-header'],
        costLimit: costLimit
      });
      break;
    default:
      console.error(`Unknown command: ${command}`);
      console.error('Available commands: report, rolling');
      console.error('Run --help for usage information');
      process.exit(1);
  }
}

if (require.main === module) {
  main().catch(console.error);
}
