# Claude Usage Monitor

A simple command-line tool to monitor Claude Code usage patterns with hourly reporting and 5-hour rolling usage limits for Claude Code Pro users.

## Features

- **Hourly Usage Reports**: Track token usage and costs by hour
- **5-Hour Rolling Monitor**: Monitor Claude Code Pro's $10/5-hour limit with visual progress bars
- **Auto Data Collection**: Automatically collects latest data before each report
- **Beautiful Tables**: Clean, aligned output similar to ccusage
- **Accurate Pricing**: Supports all Claude Sonnet 4 token types including cache tokens

## Installation

Requires [Bun](https://bun.sh/) runtime:

```bash
curl -fsSL https://bun.sh/install | bash
```

## Usage

Make the script executable:
```bash
chmod +x claude-usage-monitor.ts
```

### Basic Commands

```bash
# Show hourly usage report (auto-collects data)
./claude-usage-monitor.ts report

# Show 5-hour rolling usage for Pro limits (auto-collects data)
./claude-usage-monitor.ts rolling
```

### Options

```bash
# Show specific time range
./claude-usage-monitor.ts report --since "2025-06-15 09:00" --until "2025-06-16 18:00"

# Show last N hours only
./claude-usage-monitor.ts report --tail 24

# Output in JSON format
./claude-usage-monitor.ts report --json
```

## Example Output

### Hourly Report
```
┌──────────────────┬──────────────┬──────────────┬──────────────┬────────────┐
│ Hour             │        Input │       Output │        Total │ Cost (USD) │
├──────────────────┼──────────────┼──────────────┼──────────────┼────────────┤
│ 2025-06-16 09:00 │    3,414,874 │        2,715 │    3,417,589 │      $1.62 │
│ 2025-06-16 08:00 │    1,501,766 │       15,231 │    1,516,997 │      $1.22 │
└──────────────────┴──────────────┴──────────────┴──────────────┴────────────┘
```

### Rolling Usage Monitor
```
┌──────────────────┬────────────┬────────────┬───────────────┐
│ Current Hour     │ Hour Cost  │ 5-Hour Cost│ Limit Progress│
├──────────────────┼────────────┼────────────┼───────────────┤
│ 2025-06-16 09:00 │      $1.62 │      $6.69 │ 66.9% █████░░░│
│ 2025-06-16 08:00 │      $1.22 │      $4.27 │ 42.7% ███░░░░░│
└──────────────────┴────────────┴────────────┴───────────────┘
```

## Data Source

Reads Claude Code session logs from `~/.claude/projects/*/` and stores aggregated data in `~/.claude-usage-monitor/usage-log.jsonl`.

## Privacy

This tool only processes local Claude Code session logs on your machine. No data is transmitted to external services. All processing happens locally.

## Requirements

- [Bun](https://bun.sh/) runtime
- Claude Code installed and with some usage history
- Unix-like environment (Linux, macOS, WSL)

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT - see [LICENSE](LICENSE) file for details.