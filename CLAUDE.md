# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Claude Usage Monitor is a TypeScript tool that analyzes Claude Code usage patterns by parsing JSONL log files. It provides both historical reporting and real-time monitoring capabilities, with special focus on Claude Code Pro's usage limits ($10 per 5-hour rolling window).

## Architecture

The core application is a single TypeScript file (`claude-usage-monitor.ts`) that uses Bun runtime. Key architectural components:

- **ClaudeUsageMonitor class**: Main orchestrator handling data collection, aggregation, and reporting
- **Data Processing Pipeline**: Reads JSONL files from `~/.claude/projects/`, deduplicates by message ID, and aggregates usage by hour
- **Rolling Window Analysis**: Calculates 5-hour rolling totals for Pro limit monitoring
- **Display Engines**: Two rendering modes - standard hourly reports and rolling usage monitors

## Essential Commands

### Basic Operations
```bash
# Make executable (first time only)
chmod +x claude-usage-monitor.ts

# Collect current usage data from Claude logs
./claude-usage-monitor.ts collect

# Show hourly usage report
./claude-usage-monitor.ts report

# Monitor 5-hour rolling usage (Pro limits)
./claude-usage-monitor.ts rolling
```

### Monitoring & Filtering
```bash
# Start continuous monitoring (1-hour intervals)
./claude-usage-monitor.ts watch

# Show specific time ranges
./claude-usage-monitor.ts report --since "2025-06-15 09:00" --until "2025-06-16 18:00"

# Show last N hours only
./claude-usage-monitor.ts report --tail 24

# Rolling usage with standard report options
./claude-usage-monitor.ts report --rolling
```

### Process Management
```bash
# Start background monitoring
nohup ./claude-usage-monitor.ts watch > claude-monitor.log 2>&1 &

# Check if watch is running
ps aux | grep claude-usage-monitor

# Stop monitoring
pkill -f claude-usage-monitor

# View monitoring logs
tail -f claude-monitor.log
```

## Data Sources and Processing

- **Input**: JSONL files from `~/.claude/projects/*/` containing Claude Code session logs
- **Deduplication**: Uses message ID to prevent counting the same response multiple times
- **Cost Calculation**: Accurate pricing for Claude Sonnet 4 including cache tokens:
  - Input tokens: $0.003/1K
  - Output tokens: $0.015/1K  
  - Cache creation: $0.0037/1K
  - Cache read: $0.0003/1K
- **Storage**: Aggregated data stored in `~/.claude-usage-monitor/usage-log.jsonl`

## Key Features

### Rolling Usage Monitor
The rolling usage monitor tracks Claude Code Pro's $10/5-hour limit with:
- Color-coded progress bars (green/yellow/red)
- Hour-specific cost display alongside 5-hour rolling totals
- Automatic alerts: "HIGH USAGE" at 80%, "OVER LIMIT" at 90%
- Compact table format optimized for 3-digit percentages

### Watch Mode
Automatically collects data and displays rolling usage every hour, essential for Pro users to avoid hitting usage limits unexpectedly. Runs in background and logs to `claude-monitor.log`.

## Implementation Details

### Data Deduplication Strategy
Critical for accuracy: Claude Code creates multiple JSONL entries for the same message. The tool uses `message.id` to prevent double-counting:
```typescript
if (seenMessageIds.has(entry.message.id)) {
  continue;
}
seenMessageIds.add(entry.message.id);
```

### Cost Calculation Precision
Matches ccusage tool pricing for Claude Sonnet 4:
- Standard input: $0.003/1K tokens
- Cache creation: $0.0037/1K tokens  
- Cache read: $0.0003/1K tokens
- Output: $0.015/1K tokens

### Display Architecture
- `displayTable()`: Standard hourly reports with ccusage-compatible formatting
- `displayRollingUsage()`: Pro limit monitoring with progress visualization
- Both use consistent padding and alignment for clean terminal output