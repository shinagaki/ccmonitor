# ccmonitor

A command-line tool for monitoring Claude Code usage patterns with time-based analysis, similar to Linux's `sar` command but for Claude Code sessions.

> **📢 Repository Renamed**: This project was previously named `claude-usage-monitor` and is now renamed to `ccmonitor` for brevity. Please update your bookmarks and local repository URLs.
>
> **🚀 Now Available via npx**: As of v3.0.0, ccmonitor supports `npx ccmonitor` for instant usage without installation! No more manual downloads or Bun dependencies required. The tool now supports both Node.js (via npm/npx) and Bun runtimes.
> 
> **日本語版**: [README.ja.md](README.ja.md)

## Features

- 📊 **Hourly Usage Reports**: Track input/output tokens and costs by hour
- 🔄 **Rolling Window Monitoring**: Monitor Claude Code subscription plan limits in real-time (default: $10/5-hour for Pro)  
- ⏰ **Built-in Watch Mode**: Continuous monitoring with smooth updates (like Unix `watch` command)
- 🎯 **Accurate Cost Calculation**: Model-specific pricing for Claude Sonnet 4, Opus 4, and Haiku 3.5
- 📈 **Progress Visualization**: Color-coded progress bars for usage limits
- ⚡ **Auto Data Collection**: Automatically scans and processes the latest Claude Code logs
- 🔍 **Flexible Filtering**: Time range filtering and output line limiting (Unix `tail -n` compatible)
- 🎛️ **Compact Display**: `--no-header` option for scripting and monitoring
- 📐 **Terminal Adaptive**: Automatically adjusts display to terminal size in watch mode

## Quick Start

### Prerequisites
- Node.js 16+ installed
- Claude Code installed and used (generates logs in `~/.claude/projects/`)
- Optional: [Bun runtime](https://bun.sh/) for development (TypeScript direct execution)

### Installation

#### Option 1: npx (Recommended - No installation required)
```bash
# Run directly with npx (most convenient)
npx ccmonitor report
npx ccmonitor rolling

# Or install globally
npm install -g ccmonitor
ccmonitor report
```

#### Option 2: Download and run locally (Development)
```bash
# Clone this repository
git clone https://github.com/shinagaki/ccmonitor.git
cd ccmonitor

# For Node.js users - build and run JavaScript version
npm run build
./ccmonitor.js report

# For Bun development - run TypeScript directly  
chmod +x ccmonitor.ts
./ccmonitor.ts report
```

#### Option 3: Direct download
```bash
# Download built JavaScript version (Node.js compatible)
curl -O https://raw.githubusercontent.com/shinagaki/ccmonitor/main/ccmonitor.js
chmod +x ccmonitor.js
./ccmonitor.js report

# Or download TypeScript version (Bun required)
curl -O https://raw.githubusercontent.com/shinagaki/ccmonitor/main/ccmonitor.ts
chmod +x ccmonitor.ts
./ccmonitor.ts report
```

### Basic Usage

```bash
# With npx (no installation required)
npx ccmonitor report
npx ccmonitor rolling

# With local installation
./ccmonitor.js report  # Node.js version (built from TypeScript)
./ccmonitor.ts report  # Bun version (TypeScript direct execution)

# With global installation
ccmonitor report
ccmonitor rolling
```

## Usage Examples

### Hourly Reports
```bash
# Basic hourly report
npx ccmonitor report

# Last 24 hours only
npx ccmonitor report --tail 24

# Specific time range
npx ccmonitor report --since "2025-06-20 09:00" --until "2025-06-20 18:00"

# JSON output for scripting
npx ccmonitor report --json

# Show all hours including zero usage
npx ccmonitor report --full

# Compact display without feature headers (useful for scripting)
npx ccmonitor report --no-header --tail 5
```

### Rolling Usage Monitoring
```bash
# Monitor usage limits (5-hour rolling window, default: $10 Pro limit)
npx ccmonitor rolling

# Custom cost limits for different subscription plans
npx ccmonitor rolling --cost-limit 50   # For Max $100 plan
npx ccmonitor rolling --cost-limit 200  # For Max $200 plan

# Rolling usage monitoring with custom cost limits
npx ccmonitor rolling --cost-limit 50

# Compact rolling display for monitoring
npx ccmonitor rolling --no-header
```

### Built-in Watch Mode (Continuous Monitoring)
```bash
# Default 60-second continuous monitoring
npx ccmonitor rolling --watch

# Custom interval monitoring 
npx ccmonitor rolling --watch 30  # Every 30 seconds

# Compact continuous monitoring
npx ccmonitor rolling --watch --no-header --tail 5

# Monitor custom cost limits
npx ccmonitor rolling --watch --cost-limit 50 --tail 8
```

## Understanding the Output

### Hourly Report
```
 ╭─────────────────────────────────────────╮
 │                                         │
 │     ccmonitor - Hourly Usage Report     │
 │                                         │
 ╰─────────────────────────────────────────╯

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
╭───────────────────────────────────────────╮
│                                           │
│    ccmonitor - Limit Monitor (5-Hour)     │
│                                           │
╰───────────────────────────────────────────╯

┌──────────────────┬───────────┬───────────┬───────────────┐
│ Current Hour     │ Hour Cost │5-Hour Cost│ Limit Progress│
├──────────────────┼───────────┼───────────┼───────────────┤
│ 2025-06-20 14:00 │     $0.45 │     $2.34 │  23.0% ██░░░░░░│
│ 2025-06-20 15:00 │     $0.67 │     $3.12 │  31.0% ███░░░░░│
│ 2025-06-20 16:00 │     $1.23 │     $8.45 │  84.0% ███████░│
│ 2025-06-20 17:00 │     $0.89 │     $9.12 │  91.0% ████████│
└──────────────────┴───────────┴───────────┴───────────────┘

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
- **Aggregated Data**: Stored in `~/.ccmonitor/usage-log.jsonl`
- **Deduplication**: Prevents counting the same message multiple times using message IDs

## Cost Calculation

Model-specific pricing (per 1K tokens):
- **Claude Sonnet 4**: Input $3, Output $15, Cache creation $3.75, Cache read $0.30
- **Claude Opus 4**: Input $15, Output $75, Cache creation $18.75, Cache read $1.50  
- **Claude Haiku 3.5**: Input $0.80, Output $4, Cache creation $1, Cache read $0.08

Model detection is automatic from Claude Code logs.

## Command Reference

### Global Options
- `--help`: Show help information
- `--version`: Show version information

### Report Command
```bash
npx ccmonitor report [options]
```

**Options:**
- `--since <datetime>`: Start time (e.g., "2025-06-20 09:00")
- `--until <datetime>`: End time (e.g., "2025-06-20 18:00")  
- `--tail <hours>`: Show only last N hours
- `--full`: Show all hours including zero usage
- `--json`: Output in JSON format

### Rolling Command
```bash
npx ccmonitor rolling [options]
```

**Options:**
- `--tail <hours>`: Show only last N hours
- `--full`: Show all hours including zero usage
- `--cost-limit <amount>`: Set custom cost limit (default: 10)
- `--json`: Output in JSON format

## Usage Limits

Claude Code subscription plans have spending limits per 5-hour rolling window (based on author's analysis). The rolling monitor helps you track these limits:

- **Pro Plan**: $10/5-hour (default)
- **Max Plans**: Custom limits can be set with `--cost-limit` option

The monitor helps you:

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

**Migrating from previous versions**
- If you previously used `claude-usage-monitor.ts`, rename it to `ccmonitor.ts`
- Old aggregated data is stored in `~/.claude-usage-monitor/` but ccmonitor uses `~/.ccmonitor/`
- Migration options:
  - **Quick migration**: `mv ~/.claude-usage-monitor ~/.ccmonitor` (preserves aggregated data)
  - **Fresh start**: Delete old directory and let ccmonitor rebuild from Claude Code logs
- After migration, you can safely delete `~/.claude-usage-monitor/` if you moved the data
- **Note**: Aggregated data only contains usage summaries, not original Claude Code logs, so rebuilding is always possible

### Getting Help

```bash
# Show detailed help
npx ccmonitor --help

# Check version
npx ccmonitor --version
```

## Technical Details

### Architecture
- **Single File**: Pure TypeScript with Bun runtime
- **Data Processing**: Efficient JSONL parsing with deduplication
- **Storage**: Local aggregation in `~/.ccmonitor/`
- **Display**: Terminal-optimized formatting with color coding

### Performance
- Processes thousands of log entries efficiently
- Automatic incremental updates (only processes new data)
- Minimal memory footprint

## Development

### Building for Node.js

If you're working with the TypeScript source and want to create a Node.js compatible version:

```bash
# Build JavaScript version from TypeScript
npm run build

# Test the built version
./ccmonitor.js --version
```

### Publishing to npm

```bash
# Build and publish (automatically runs build before publish)
npm publish

# Test installation from npm
npm install -g ccmonitor
ccmonitor --version
```

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature-name`
3. Make your changes
4. Test thoroughly with your own Claude Code data
5. Run `npm run build` to ensure JavaScript version works
6. Submit a pull request

## Acknowledgments

Special thanks to [@xxGodLiuxx](https://github.com/xxGodLiuxx) for inspiring the watch mode feature and providing valuable insights on memory management and continuous monitoring patterns.

## License

MIT License - see [LICENSE](LICENSE) file for details.

---

**Note**: This tool is unofficial and not affiliated with Anthropic. It analyzes locally stored Claude Code logs and does not send any data externally.