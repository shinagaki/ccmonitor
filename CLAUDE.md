# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ccmonitor is a command-line tool that analyzes Claude Code usage patterns by parsing JSONL log files. It provides historical reporting and real-time monitoring capabilities, with special focus on Claude Code Pro's usage limits ($10 per 5-hour rolling window).

## Architecture

Single TypeScript file (`ccmonitor.ts`) using Bun runtime with key components:
- **ClaudeUsageMonitor class**: Main orchestrator handling data collection, aggregation, and reporting
- **Data Processing Pipeline**: Reads JSONL files from `~/.claude/projects/`, deduplicates by message ID, and aggregates usage by hour
- **Rolling Window Analysis**: Calculates 5-hour rolling totals for Pro limit monitoring
- **Display Engines**: Two rendering modes - standard hourly reports and rolling usage monitors

## Essential Commands

### Development Setup
```bash
# Install Bun runtime (if not already installed)
curl -fsSL https://bun.sh/install | bash

# Make executable (first time only)
chmod +x ccmonitor.ts

# Run directly with Bun (alternative to chmod +x)
bun ccmonitor.ts [command]
```

### Testing and Verification
```bash
# Test basic functionality
./ccmonitor --help
./ccmonitor --version

# Verify data collection works
./ccmonitor report --json | head -5
```

### Basic Usage
```bash
# Show hourly usage report (auto-collects data)
./ccmonitor report

# Show 5-hour rolling usage for Pro limit monitoring (auto-collects data)
./ccmonitor rolling
```

### Advanced Options
```bash
# Show specific time range
./ccmonitor report --since "2025-06-15 09:00" --until "2025-06-16 18:00"

# Show last N hours only
./ccmonitor report --tail 24

# Enable rolling view in report command
./ccmonitor report --rolling

# Output in JSON format for scripting
./ccmonitor report --json
```

## Data Sources and Processing

- **Input**: JSONL files from `~/.claude/projects/*/` containing Claude Code session logs
- **Deduplication**: Uses message ID to prevent counting the same response multiple times
- **Cost Calculation**: Accurate pricing for Claude Sonnet 4 including cache tokens:
  - Input tokens: $0.003/1K
  - Output tokens: $0.015/1K  
  - Cache creation: $0.0037/1K
  - Cache read: $0.0003/1K
- **Storage**: Aggregated data stored in `~/.ccmonitor/usage-log.jsonl`

## Key Features

### Rolling Usage Monitor
The rolling usage monitor tracks Claude Code Pro's $10/5-hour limit with:
- Color-coded progress bars (green/yellow/red)
- Hour-specific cost display alongside 5-hour rolling totals
- Automatic alerts: "HIGH USAGE" at 80%, "OVER LIMIT" at 90%
- Compact table format optimized for 3-digit percentages

### Auto Data Collection
Both `report` and `rolling` commands automatically collect the latest usage data before displaying results, eliminating the need for manual data collection steps. This matches ccusage behavior and provides a seamless user experience.

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

## Project Structure

### Core Implementation
- **ccmonitor.ts**: Main executable TypeScript file with shebang `#!/usr/bin/env bun`
- **ClaudeUsageMonitor class**: Primary class containing all functionality
- **No dependencies**: Zero external dependencies, uses only Node.js built-ins

## Development Guidelines

### Code Constraints
- **Single File Architecture**: All functionality must remain in `ccmonitor.ts`
- **Zero Dependencies**: Use only Node.js/Bun built-ins (fs, path, os, util)
- **Self-Contained**: No package.json or build process required
- **TypeScript**: Maintain strict typing throughout

### Testing Strategy
```bash
# Manual testing with real data
./ccmonitor report --json | jq '.[0]'  # Verify JSON structure
./ccmonitor rolling --tail 5         # Test rolling calculations

# Edge case testing
./ccmonitor report --since "invalid-date"  # Error handling
./ccmonitor report --tail 0               # Boundary conditions
```

### Linting and Type Checking
Since this is a TypeScript project, run type checking when making changes:
```bash
# Type check with Bun (built-in TypeScript support)
bun --check ccmonitor.ts

# For stricter type checking during development
bunx tsc --noEmit ccmonitor.ts
```

### Debugging Commands
```bash
# Check data collection status
ls -la ~/.ccmonitor/

# Verify JSONL parsing
./ccmonitor report --json | head -1 | jq .

# Debug timestamp parsing
./ccmonitor report --since "$(date -d '1 hour ago' '+%Y-%m-%d %H:%M')"

# Validate cost calculations manually
bun -e "console.log((1000/1000) * 0.003 + (2000/1000) * 0.015)"  # Expected: 0.033
```

