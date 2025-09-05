# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ccmonitor is a command-line tool that analyzes Claude Code usage patterns by parsing JSONL log files. It provides historical reporting and real-time monitoring capabilities, with configurable cost limits for different Claude Code subscription plans. As of v3.0.0, it supports both Node.js (via npm/npx) and Bun runtimes with dual distribution architecture.

## Architecture

Dual-runtime architecture supporting both development and production deployment:

### Source Files
- **ccmonitor.ts**: TypeScript source (Bun runtime) - primary development version
- **ccmonitor.js**: CommonJS build (Node.js runtime) - npm distribution version
- **build.js**: Build system converting TypeScript to Node.js-compatible JavaScript

### Core Components
- **ClaudeUsageMonitor class**: Main orchestrator handling data collection, aggregation, and reporting
- **Data Processing Pipeline**: Reads JSONL files from `~/.claude/projects/`, deduplicates by message ID, and aggregates usage by hour
- **Rolling Window Analysis**: Calculates 5-hour rolling totals with configurable cost limits
- **Display Engines**: Two rendering modes - standard hourly reports and rolling usage monitors with optional compact mode (`--no-header`)
- **Configurable Limits**: Support for custom cost limits via `--cost-limit` option for different subscription plans

## Essential Commands

### Development Setup
```bash
# For Node.js development
npm install  # No dependencies, but sets up npm scripts

# For Bun development (optional)
curl -fsSL https://bun.sh/install | bash
chmod +x ccmonitor.ts
```

### Build and Release
```bash
# Build JavaScript version for npm distribution
npm run build

# Release new versions (automatically builds, commits, pushes, and publishes to npm)
npm run release:patch  # 3.0.1 → 3.0.2
npm run release:minor  # 3.0.1 → 3.1.0  
npm run release:major  # 3.0.1 → 4.0.0
```

### Testing and Verification
```bash
# Test TypeScript version (development)
./ccmonitor.ts --help
./ccmonitor.ts --version

# Test built JavaScript version (production)
npm run build
./ccmonitor.js --help
./ccmonitor.js --version

# Test npm distribution
npx ccmonitor --version

# Verify data collection works
./ccmonitor.ts report --json | head -5
```

### Basic Usage
```bash
# Show hourly usage report (auto-collects data)
./ccmonitor report

# Show 5-hour rolling usage for Pro limit monitoring (auto-collects data)
./ccmonitor rolling

# Continuous monitoring (default 60-second updates)
./ccmonitor rolling --watch

# Quick continuous monitoring (every 10 seconds)
./ccmonitor rolling --watch 10
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

# Show all hours including zero usage (rolling mode)
./ccmonitor rolling --full

# Custom cost limits for different subscription plans
./ccmonitor rolling --cost-limit 50   # For Max $100 plan
./ccmonitor rolling --cost-limit 200  # For Max $200 plan

# Compact display without feature headers (useful for scripting)
./ccmonitor report --no-header --tail 5
./ccmonitor rolling --no-header

# Watch mode combinations
./ccmonitor rolling --watch --full --tail 10           # All hours with terminal size limit
./ccmonitor rolling --watch 30 --no-header             # Compact continuous monitoring
./ccmonitor rolling --watch --cost-limit 50 --tail 8   # Custom limits with size control
```

## Data Sources and Processing

- **Input**: JSONL files from `~/.claude/projects/*/` containing Claude Code session logs
- **Deduplication**: Uses message ID to prevent counting the same response multiple times
- **Cost Calculation**: Accurate model-specific pricing based on Anthropic official rates:
  - **Claude Sonnet 4**: Input $3/M, Output $15/M, Cache creation $3.75/M, Cache read $0.30/M
  - **Claude Opus 4**: Input $15/M, Output $75/M, Cache creation $18.75/M, Cache read $1.50/M
  - **Claude Haiku 3.5**: Input $0.80/M, Output $4/M, Cache creation $1/M, Cache read $0.08/M
  - Model detection: Automatically reads model from JSONL logs (`message.model` field)
  - Fallback: Defaults to Sonnet 4 pricing for unknown models
- **Storage**: Aggregated data stored in `~/.ccmonitor/usage-log.jsonl`

## Key Features

### Rolling Usage Monitor
The rolling usage monitor tracks configurable cost limits (default: $10/5-hour) with:
- Color-coded progress bars (green/yellow/red)
- Hour-specific cost display alongside 5-hour rolling totals
- Automatic alerts: "HIGH USAGE" at 80%, "OVER LIMIT" at 90%
- Compact table format optimized for 3-digit percentages
- **--cost-limit option**: Support for custom limits (Pro: $10, Max plans: $50-$200)
- **--full option**: Display all hours including zero usage for complete time continuity analysis

### Auto Data Collection
Both `report` and `rolling` commands automatically collect the latest usage data before displaying results, eliminating the need for manual data collection steps. This matches ccusage behavior and provides a seamless user experience.

### Compact Display Mode
The `--no-header` option removes feature description headers while preserving table structure, making it ideal for:
- Scripting and automation
- Real-time monitoring with built-in watch mode
- Space-constrained terminal displays

### Built-in Watch Mode
The `--watch` option provides continuous monitoring similar to Unix `watch` command:
- **Default Interval**: 60 seconds when no interval specified (`--watch`)
- **Custom Intervals**: Specify seconds (`--watch 30` for 30-second updates)
- **Terminal Size Aware**: Automatically adjusts display to fit terminal height
- **Smooth Updates**: No screen flickering, cursor-controlled updates
- **Output Line Limiting**: Respects `--tail` option for consistent display
- **Buffered Output**: Prevents scrolling and cursor jumping

#### Watch Mode Usage:
```bash
# Default 60-second monitoring
ccmonitor rolling --watch

# Custom 30-second updates with limit monitoring
ccmonitor rolling --watch 30 --cost-limit 50

# Compact continuous monitoring 
ccmonitor rolling --watch --no-header --tail 5
```

### Output Line Control (Unix tail -n Compatible)
The `--tail` option now uses output-line-based limiting (like Unix `tail -n`):
- Counts actual displayed lines including OVER LIMIT/HIGH USAGE messages
- Works consistently across both regular and watch modes
- Automatic terminal size adjustment in watch mode

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
Dynamic model-specific pricing using Anthropic official rates:
- **Model Detection**: Automatically extracts model from `entry.message.model` in JSONL logs
- **Multi-Model Support**: Claude Sonnet 4, Opus 4, and Haiku 3.5 with accurate per-token pricing
- **Pricing Table**: Centralized pricing configuration supporting input/output/cache creation/cache read tokens
- **Fallback Strategy**: Unknown models default to Sonnet 4 pricing for compatibility

### Display Architecture
- `displayTable()`: Standard hourly reports with ccusage-compatible formatting
- `displayRollingUsage()`: Configurable limit monitoring with progress visualization (accepts costLimit parameter)
- Both use consistent padding and alignment for clean terminal output

## Project Structure

### Core Implementation
- **ccmonitor.ts**: Main executable TypeScript file with shebang `#!/usr/bin/env bun`
- **ClaudeUsageMonitor class**: Primary class containing all functionality
- **No dependencies**: Zero external dependencies, uses only Node.js built-ins

## Development Guidelines

### Code Constraints
- **Dual-File Architecture**: Keep TypeScript source (`ccmonitor.ts`) and built JavaScript (`ccmonitor.js`) in sync
- **Zero Runtime Dependencies**: Use only Node.js/Bun built-ins (fs, path, os, util)
- **CommonJS Distribution**: Built version must be CommonJS-compatible for maximum npm compatibility
- **TypeScript**: Maintain strict typing in source file
- **Version Synchronization**: build.js automatically reads version from package.json and injects it into generated JavaScript code. Only update package.json version for releases; ccmonitor.ts version must be manually synchronized.

### Adding New Command-Line Options
When adding new CLI options, you MUST update ALL THREE files:

1. **ccmonitor.ts**: Add to parseArgs options and help text
2. **build.js**: Add to parseArgs options, help text, validation logic, and method calls
3. **Test both versions**: `./ccmonitor.ts --help` and `./ccmonitor.js --help`

**Critical**: build.js does NOT automatically copy from ccmonitor.ts. Each change must be manually replicated.

**CLI Option Addition Checklist:**
- [ ] Add option to `parseArgs` options in ccmonitor.ts
- [ ] Add option to `parseArgs` options in build.js  
- [ ] Add option description to help text in ccmonitor.ts
- [ ] Add option description to help text in build.js
- [ ] Add validation logic in ccmonitor.ts (if needed)
- [ ] Add validation logic in build.js (if needed)
- [ ] Pass option to method calls in ccmonitor.ts
- [ ] Pass option to method calls in build.js
- [ ] Update method signatures to accept new parameter
- [ ] Test: `./ccmonitor.ts --help`
- [ ] Test: `npm run build && ./ccmonitor.js --help`
- [ ] Test: Functionality works in both versions

### Testing Strategy

#### Automated Test Suite (Vitest)
```bash
# Install test dependencies
npm install

# Run all tests
npm test

# Run tests in watch mode (for development)
npm run test:watch

# Generate coverage report
npm run test:coverage

# Run tests with UI (browser-based)
npm run test:ui
```

#### Test Categories
- **Unit Tests** (`tests/unit/`): Pure functions (cost calculation, time utilities, deduplication)
- **Integration Tests** (`tests/integration/`): Cache management, incremental loading, data consistency  
- **Performance Tests** (`tests/performance/`): Optimization effectiveness, memory usage, scalability
- **Mock Tests** (`tests/mocks/`): File I/O operations, CLI integration

#### Test Coverage Focus Areas
- **Cost Calculation**: All models (Sonnet 4, Opus 4, Haiku 3.5) with cache tokens, edge cases, precision
- **Time Processing**: Hour boundaries, timezone handling, date range filtering, tail calculations
- **Deduplication**: Message ID tracking, large-scale duplicate detection, cross-file scenarios
- **Performance**: Large datasets (10K+ entries), incremental vs. full scan, watch mode efficiency
- **Real-world Scenarios**: Multi-project structures, file modification tracking, concurrent access

#### Manual Testing with Real Data
```bash
# Manual testing with real data
./ccmonitor report --json | jq '.[0]'  # Verify JSON structure
./ccmonitor rolling --tail 5         # Test rolling calculations
./ccmonitor rolling --full --tail 10 # Test full mode with continuous hours

# Watch mode testing
timeout 10 ./ccmonitor rolling --watch 5 --tail 3    # Test watch mode with limits
timeout 8 ./ccmonitor rolling --watch --no-header    # Test compact watch mode
./ccmonitor rolling --watch                          # Test default 60-second interval

# Edge case testing
./ccmonitor report --since "invalid-date"  # Error handling
./ccmonitor report --tail 0               # Boundary conditions
./ccmonitor rolling --watch 2             # Should error (< 5 seconds)

# Real-time monitoring integration
watch -n 60 './ccmonitor rolling --no-header'     # Monitor default limits
watch -n 30 './ccmonitor rolling --full --no-header --cost-limit 50'  # Custom limit monitoring
./ccmonitor rolling --cost-limit 200 --tail 12   # Test custom limits
```

### Version Release Process
Version synchronization is critical with dual-file architecture:
```bash
# Standard npm-based releases (automatically syncs package.json and builds)
npm run release:patch  # For bug fixes (auto-increments version)
npm run release:minor  # For new features
npm run release:major  # For breaking changes

# Manual version sync (if needed)
# 1. Update package.json version
# 2. Update ccmonitor.ts version string manually
# 3. Run npm run build (automatically syncs to ccmonitor.js)
```

### Linting and Type Checking
```bash
# Type check with Bun (built-in TypeScript support)
bun --check ccmonitor.ts

# For stricter type checking during development
bunx tsc --noEmit ccmonitor.ts

# Validate build output
npm run build && ./ccmonitor.js --version
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

