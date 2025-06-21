# Claude Usage Monitor

A command-line tool for monitoring Claude Code usage patterns with time-based analysis, similar to Linux's `sar` command but for Claude Code sessions.

## Features

- 📊 **Hourly Usage Reports**: Track input/output tokens and costs by hour
- 🔄 **Rolling Window Monitoring**: Monitor Claude Code Pro's $10/5-hour limits in real-time  
- 🎯 **Accurate Cost Calculation**: Precise pricing for Claude Sonnet 4 including cache tokens
- 📈 **Progress Visualization**: Color-coded progress bars for usage limits
- ⚡ **Auto Data Collection**: Automatically scans and processes the latest Claude Code logs
- 🔍 **Flexible Filtering**: Time range filtering and tail options

## Quick Start

### Prerequisites
- [Bun runtime](https://bun.sh/) installed
- Claude Code installed and used (generates logs in `~/.claude/projects/`)

### Installation

1. Clone this repository:
```bash
git clone https://github.com/yourusername/claude-usage-monitor.git
cd claude-usage-monitor
chmod +x claude-usage-monitor.ts
```

2. Or download directly:
```bash
curl -O https://raw.githubusercontent.com/yourusername/claude-usage-monitor/main/claude-usage-monitor.ts
chmod +x claude-usage-monitor.ts
```

### Basic Usage

```bash
# Show hourly usage report
./claude-usage-monitor.ts report

# Monitor rolling 5-hour usage for Pro limits
./claude-usage-monitor.ts rolling
```

## Usage Examples

### Hourly Reports
```bash
# Basic hourly report
./claude-usage-monitor.ts report

# Last 24 hours only
./claude-usage-monitor.ts report --tail 24

# Specific time range
./claude-usage-monitor.ts report --since "2025-06-20 09:00" --until "2025-06-20 18:00"

# JSON output for scripting
./claude-usage-monitor.ts report --json
```

### Rolling Usage Monitoring
```bash
# Monitor Pro usage limits (5-hour rolling window)
./claude-usage-monitor.ts rolling

# Include rolling view in report
./claude-usage-monitor.ts report --rolling
```

## Understanding the Output

### Hourly Report
```
 ╭──────────────────────────────────────────╮
 │                                          │
 │  Claude Code Token Usage Report - Hourly │
 │                                          │
 ╰──────────────────────────────────────────╯

┌──────────────────┬──────────────┬──────────────┬──────────────┬────────────┐
│ Hour             │        Input │       Output │        Total │ Cost (USD) │
├──────────────────┼──────────────┼──────────────┼──────────────┼────────────┤
│ 2025-06-20 14:00 │        1,234 │        5,678 │        6,912 │      $0.45 │
│ 2025-06-20 15:00 │        2,345 │        6,789 │        9,134 │      $0.67 │
│ 2025-06-20 16:00 │        3,456 │        7,890 │       11,346 │      $0.89 │
└──────────────────┴──────────────┴──────────────┴──────────────┴────────────┘
│ Total            │        7,035 │       20,357 │       27,392 │      $2.01 │
└──────────────────┴──────────────┴──────────────┴──────────────┴────────────┘
```

### Rolling Usage Monitor
```
╭───────────────────────────────────────────────╮
│                                               │
│  Claude Code Pro Usage Limit Monitor (5-Hour) │
│                                               │
╰───────────────────────────────────────────────╯

┌──────────────────┬────────────┬────────────┬───────────────┐
│ Current Hour     │ Hour Cost  │ 5-Hour Cost│ Limit Progress│
├──────────────────┼────────────┼────────────┼───────────────┤
│ 2025-06-20 14:00 │      $0.45 │      $2.34 │  23% ██░░░░░░│
│ 2025-06-20 15:00 │      $0.67 │      $3.12 │  31% ███░░░░░│
│ 2025-06-20 16:00 │      $1.23 │      $8.45 │  84% ███████░ ⚠️ HIGH USAGE│
│ 2025-06-20 17:00 │      $0.89 │      $9.12 │  91% ████████ 🚨 OVER LIMIT│
└──────────────────┴────────────┴────────────┴───────────────┘

📊 Claude Code Pro Limits:
   • Cost Limit: $10.00 per 5-hour window
   • Time Window: Rolling 5-hour period
   • Color: Green (Safe) | Yellow (Caution) | Red (Danger)
```

- **Green bars**: 0-59% of $10 limit (Safe)
- **Yellow bars**: 60-79% of limit (Caution)  
- **Red bars**: 80%+ of limit (Danger)
- **Warnings**: ⚠️ HIGH USAGE at 80%, 🚨 OVER LIMIT at 90%

## Data Sources

The tool automatically processes:
- **Claude Code Logs**: JSONL files from `~/.claude/projects/*/`
- **Aggregated Data**: Stored in `~/.claude-usage-monitor/usage-log.jsonl`
- **Deduplication**: Prevents counting the same message multiple times using message IDs

## Cost Calculation

Accurate pricing for Claude Sonnet 4:
- **Input tokens**: $0.003 per 1K tokens
- **Output tokens**: $0.015 per 1K tokens
- **Cache creation**: $0.0037 per 1K tokens
- **Cache read**: $0.0003 per 1K tokens

## Command Reference

### Global Options
- `--help`: Show help information
- `--version`: Show version information

### Report Command
```bash
./claude-usage-monitor.ts report [options]
```

**Options:**
- `--since <datetime>`: Start time (e.g., "2025-06-20 09:00")
- `--until <datetime>`: End time (e.g., "2025-06-20 18:00")  
- `--tail <hours>`: Show only last N hours
- `--rolling`: Include rolling usage view
- `--json`: Output in JSON format

### Rolling Command
```bash
./claude-usage-monitor.ts rolling [options]
```

**Options:**
- `--tail <hours>`: Show only last N hours
- `--json`: Output in JSON format

## Pro Usage Limits

Claude Code Pro has a $10 spending limit per 5-hour rolling window. The rolling monitor helps you:

- ⚠️ **Track approaching limits** before hitting them
- 📊 **Visualize usage patterns** throughout the day  
- 🚨 **Get alerts** at 80% (HIGH USAGE) and 90% (OVER LIMIT)
- ⏰ **Plan usage** around the rolling window

## Troubleshooting

### Common Issues

**"No Claude Code data found"**
- Ensure Claude Code is installed and has been used
- Check that `~/.claude/projects/` exists and contains JSONL files
- Verify file permissions allow reading the log files

**"Bun command not found"**
- Install Bun: `curl -fsSL https://bun.sh/install | bash`
- Restart your terminal or source your shell profile

**Inaccurate usage data**
- The tool automatically deduplicates entries using message IDs
- If you see duplicates, please report as a bug

### Getting Help

```bash
# Show detailed help
./claude-usage-monitor.ts --help

# Check version
./claude-usage-monitor.ts --version
```

## Technical Details

### Architecture
- **Single File**: Pure TypeScript with Bun runtime
- **Data Processing**: Efficient JSONL parsing with deduplication
- **Storage**: Local aggregation in `~/.claude-usage-monitor/`
- **Display**: Terminal-optimized formatting with color coding

### Performance
- Processes thousands of log entries efficiently
- Automatic incremental updates (only processes new data)
- Minimal memory footprint

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature-name`
3. Make your changes
4. Test thoroughly with your own Claude Code data
5. Submit a pull request

## License

MIT License - see [LICENSE](LICENSE) file for details.

---

**Note**: This tool is unofficial and not affiliated with Anthropic. It analyzes locally stored Claude Code logs and does not send any data externally.