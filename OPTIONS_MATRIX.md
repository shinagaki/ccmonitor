# ccmonitor Options Matrix

## Commands and Supported Options

| Option | Short | Type | report | rolling | rolling --watch | Description |
|--------|-------|------|--------|---------|----------------|-------------|
| `--path` | `-p` | string | ✅ | ✅ | ✅ | Custom data directory path |
| `--claude-dir` | | string | ✅ | ✅ | ✅ | Custom Claude projects directory |
| `--since` | `-s` | string | ✅ | ✅ | ✅ | Start time filter |
| `--until` | `-u` | string | ✅ | ✅ | ✅ | End time filter |
| `--json` | `-j` | boolean | ✅ | ✅ | ❌ | JSON output format |
| `--tail` | `-t` | string | ✅ | ✅ | ✅ | Limit output lines |
| `--full` | `-f` | boolean | ✅ | ✅ | ✅ | Show all hours including zero |
| `--no-header` | | boolean | ✅ | ✅ | ✅ | Suppress descriptive headers |
| `--cost-limit` | | string | ❌ | ✅ | ✅ | Custom cost limit (default: 10) |
| `--watch` | | string | ❌ | ✅ | N/A | Watch interval in seconds |
| `--help` | `-h` | boolean | ✅ | ✅ | ✅ | Show help |
| `--version` | `-v` | boolean | ✅ | ✅ | ✅ | Show version |

## Command Behavior

### `report` command
```bash
ccmonitor report [options]
```
- **Primary function**: Display hourly usage statistics
- **Output**: Table format with hourly breakdown + totals
- **Special options**:
  - `--json`: Outputs raw data in JSON format
  - `--full`: Shows all hours including zero usage for time continuity
  
### `rolling` command  
```bash
ccmonitor rolling [options]
ccmonitor rolling --watch [interval] [options]
```
- **Primary function**: Display 5-hour rolling usage monitoring
- **Output**: Rolling window analysis with progress bars
- **Special options**:
  - `--watch`: Enables continuous monitoring (minimum 5 seconds)
  - `--json`: Outputs rolling calculations in JSON format

### `rolling --watch` (Watch Mode)
```bash 
ccmonitor rolling --watch [interval] [options]
```
- **Primary function**: Real-time continuous monitoring
- **Output**: Live-updating terminal display
- **Restrictions**:
  - `--json`: Not supported (incompatible with live updates)
  - Interval must be ≥5 seconds

## Option Combinations

### Time Filtering Options
- `--since` + `--until`: Time range filtering
- `--tail`: Limit recent hours (works with time filters)
- `--full`: Show all hours including zero usage

### Display Options  
- `--json`: Machine-readable output (report/rolling only)
- `--no-header`: Compact display for scripting
- `--cost-limit`: Custom spending limits (default: $10/5-hour)

### Integration Options
- `--rolling` in `report`: Combines hourly report with rolling analysis
- `--watch` in `rolling`: Continuous monitoring mode

## Testing Coverage Matrix

| Option Combination | Tested | Priority |
|-------------------|--------|----------|
| `report --tail` | ✅ | High |
| `report --json` | ✅ | High |  
| `report --since --until` | ✅ | High |
| `report --full` | ✅ | Medium |
| `rolling --tail` | ✅ | High |
| `rolling --json` | ✅ | Medium |
| `rolling --cost-limit` | ✅ | High |
| `rolling --watch` | ✅ | High |
| `rolling --watch --tail` | ✅ | High |
| `rolling --watch --cost-limit` | ✅ | High |
| `--no-header` combinations | ✅ | Medium |
| Time filter combinations | ✅ | Medium |

## Known Issues

### Fixed Issues
- ✅ `report --tail` was not working (Fixed in v3.5.0+)

### Verified Working
- ✅ `--json` output consistency between commands (both produce valid JSON)
- ✅ Time filter edge cases with `--full` (properly includes zero hours)
- ✅ Clear command separation (report = hourly stats, rolling = 5-hour monitoring)

## Test Scenarios Completed

### High Priority Tests - All Working
1. ✅ Report and rolling commands work independently with clean separation
2. ✅ `rolling --json --tail 5` (JSON output with last 5 hours)
3. ✅ `rolling --cost-limit 100 --full` (custom limit with all hours including zero)
4. ✅ `report --full --since "2025-01-01"` (time filter with zero hour display)

### Medium Priority Tests - All Working
1. ✅ All combinations with `--no-header` (compact display without feature headers)
2. ✅ Edge cases with time filtering (since/until combinations work properly)
3. ✅ Large `--cost-limit` values validation (accepts values up to 10000)
4. ✅ `--watch` with various intervals (5+ second intervals supported)

### Integration Tests Completed
1. ✅ Multiple option combinations (all tested and working)
2. ✅ Error handling for invalid combinations (proper error messages for invalid values)
3. ✅ Performance with large datasets + options (incremental loading works efficiently)
4. ✅ Watch mode stability under load (tested with various intervals and options)

## Summary

All major option combinations have been **verified working** through CLI testing:

- **Basic Commands**: `report`, `rolling` work with all supported options
- **Filtering Options**: `--since`, `--until`, `--tail`, `--full` work correctly
- **Display Options**: `--json`, `--no-header` work across both commands  
- **Rolling Specific**: `--cost-limit`, `--watch` work with various combinations
- **Complex Combinations**: Multi-option scenarios like `rolling --watch --cost-limit 50 --tail 8` work properly
- **Edge Cases**: Invalid inputs provide appropriate error messages
- **Performance**: All options work efficiently with incremental data loading