#!/usr/bin/env node
// @bun @bun-cjs - transpiled by build.js
// ccmonitor.ts
var import_promises = require("fs/promises");
var import_path = require("path");
var import_os = require("os");
var import_util = require("util");

class ClaudeUsageMonitor {
  dataPath;
  logFile;
  claudeDir;
  cachedHourlyStats = new Map;
  fileLastModified = new Map;
  seenMessageIds = new Set;
  lastIncrementalScan = new Date(0);
  constructor(dataPath, claudeDir) {
    this.dataPath = dataPath || import_path.join(import_os.homedir(), ".ccmonitor");
    this.logFile = import_path.join(this.dataPath, "usage-log.jsonl");
    this.claudeDir = claudeDir || import_path.join(import_os.homedir(), ".claude");
  }
  async ensureDataDir() {
    try {
      await import_promises.mkdir(this.dataPath, { recursive: true });
    } catch (error) {}
  }
  calculateCost(inputTokens, outputTokens, cacheCreationTokens = 0, cacheReadTokens = 0, model = "claude-sonnet-4-20250514") {
    const pricingTable = {
      "claude-sonnet-4-20250514": {
        input: 0.003,
        output: 0.015,
        cacheCreation: 0.0037,
        cacheRead: 0.0003
      },
      "claude-opus-4-20250514": {
        input: 0.015,
        output: 0.075,
        cacheCreation: 0.01875,
        cacheRead: 0.0015
      },
      "claude-haiku-3.5-20241022": {
        input: 0.0008,
        output: 0.004,
        cacheCreation: 0.001,
        cacheRead: 0.00008
      }
    };
    const pricing = pricingTable[model] || pricingTable["claude-sonnet-4-20250514"];
    return inputTokens / 1000 * pricing.input + outputTokens / 1000 * pricing.output + cacheCreationTokens / 1000 * pricing.cacheCreation + cacheReadTokens / 1000 * pricing.cacheRead;
  }
  async loadClaudeData() {
    const entries = [];
    const seenMessageIds = new Set;
    try {
      const projectsPath = import_path.join(this.claudeDir, "projects");
      const projects = await import_promises.readdir(projectsPath);
      for (const project of projects) {
        const projectPath = import_path.join(projectsPath, project);
        const files = await import_promises.readdir(projectPath);
        for (const file of files) {
          if (file.endsWith(".jsonl")) {
            const filePath = import_path.join(projectPath, file);
            const content = await import_promises.readFile(filePath, "utf-8");
            const lines = content.trim().split(`
`);
            for (const line of lines) {
              try {
                const entry = JSON.parse(line);
                if (entry.timestamp && entry.type === "assistant" && entry.message?.usage && entry.message?.id) {
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
                    const model = entry.message.model || "claude-sonnet-4-20250514";
                    entries.push({
                      timestamp: entry.timestamp,
                      type: entry.type,
                      message: entry.message,
                      cost: this.calculateCost(inputTokens, outputTokens, cacheCreationTokens, cacheReadTokens, model)
                    });
                  }
                }
              } catch (e) {}
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
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:00`;
  }
  async loadClaudeDataIncremental(timeFilter) {
    const newEntries = [];
    try {
      const projectsPath = import_path.join(this.claudeDir, "projects");
      const projects = await import_promises.readdir(projectsPath);
      for (const project of projects) {
        const projectPath = import_path.join(projectsPath, project);
        const files = await import_promises.readdir(projectPath);
        for (const file of files) {
          if (file.endsWith(".jsonl")) {
            const filePath = import_path.join(projectPath, file);
            const stats = await import_promises.stat(filePath);
            const lastModified = stats.mtime.getTime();
            const previousModified = this.fileLastModified.get(filePath) || 0;
            if (lastModified <= previousModified) {
              continue;
            }
            this.fileLastModified.set(filePath, lastModified);
            const content = await import_promises.readFile(filePath, "utf-8");
            const lines = content.trim().split(`
`);
            for (const line of lines) {
              try {
                const entry = JSON.parse(line);
                if (entry.timestamp && entry.type === "assistant" && entry.message?.usage && entry.message?.id) {
                  if (this.seenMessageIds.has(entry.message.id)) {
                    continue;
                  }
                  const entryTime = new Date(entry.timestamp);
                  if (timeFilter) {
                    if (timeFilter.since) {
                      const sinceTime = new Date(timeFilter.since);
                      if (entryTime < sinceTime) {
                        continue;
                      }
                    }
                    if (timeFilter.tail) {
                      const tailHours = timeFilter.tail;
                      const cutoffTime = new Date(Date.now() - tailHours * 60 * 60 * 1000);
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
                    const model = entry.message.model || "claude-sonnet-4-20250514";
                    newEntries.push({
                      timestamp: entry.timestamp,
                      type: entry.type,
                      message: entry.message,
                      cost: this.calculateCost(inputTokens, outputTokens, cacheCreationTokens, cacheReadTokens, model)
                    });
                  }
                }
              } catch (e) {
                continue;
              }
            }
          }
        }
      }
    } catch (error) {}
    return newEntries;
  }
  async initializeCache() {
    this.cachedHourlyStats.clear();
    this.seenMessageIds.clear();
    try {
      const content = await import_promises.readFile(this.logFile, "utf-8");
      const records = content.trim().split(`
`).map((line) => JSON.parse(line));
      for (const record of records) {
        this.cachedHourlyStats.set(record.hour, record);
      }
      const entries = await this.loadClaudeData();
      for (const entry of entries) {
        if (entry.message?.id) {
          this.seenMessageIds.add(entry.message.id);
        }
      }
    } catch (error) {}
  }
  async collectIncremental(timeFilter) {
    await this.ensureDataDir();
    const newEntries = await this.loadClaudeDataIncremental(timeFilter);
    if (newEntries.length === 0) {
      return 0;
    }
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
      const stats = this.cachedHourlyStats.get(hourKey);
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
    await this.writeCachedStats();
    return newEntries.length;
  }
  async writeCachedStats() {
    const statsArray = Array.from(this.cachedHourlyStats.values()).sort((a, b) => a.hour.localeCompare(b.hour));
    const content = statsArray.map((stats) => JSON.stringify(stats)).join(`
`);
    await import_promises.writeFile(this.logFile, content, "utf-8");
  }
  async collect() {
    await this.ensureDataDir();
    const entries = await this.loadClaudeData();
    const hourlyStats = new Map;
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
        stats.inputTokens += inputTokens + cacheCreationTokens + cacheReadTokens;
        stats.outputTokens += outputTokens;
        stats.totalTokens += inputTokens + outputTokens + cacheCreationTokens + cacheReadTokens;
        stats.cost += entry.cost || 0;
        stats.sessionCount += 1;
      }
    }
    for (const stats of hourlyStats.values()) {
      stats.avgInputPerSession = stats.sessionCount > 0 ? stats.inputTokens / stats.sessionCount : 0;
      stats.avgOutputPerSession = stats.sessionCount > 0 ? stats.outputTokens / stats.sessionCount : 0;
    }
    const logData = Array.from(hourlyStats.values()).sort((a, b) => a.hour.localeCompare(b.hour)).map((stats) => JSON.stringify(stats)).join(`
`);
    await import_promises.writeFile(this.logFile, logData);
  }
  async report(options) {
    await this.initializeCache();
    let estimatedTail = options.tail;
    if (options.rolling && options.tail) {
      estimatedTail = options.tail + 5;
    }
    await this.collectIncremental({ since: options.since, tail: estimatedTail });
    try {
      let records = Array.from(this.cachedHourlyStats.values()).filter((record) => record && record.hour);
      if (options.since) {
        records = records.filter((r) => r.hour >= options.since);
      }
      if (options.until) {
        records = records.filter((r) => r.hour <= options.until);
      }
      if (options.json) {
        console.log(JSON.stringify(records, null, 2));
        return;
      }
      if (options.rolling) {
        this.displayRollingUsage(records, options.full, options.noHeader, options.costLimit, options.tail || options.maxDataRows);
      } else {
        this.displayTable(records, options.full, options.noHeader, options.tail);
      }
    } catch (error) {
      console.error("\u274C No usage data found. Please ensure Claude Code has been used and logs exist in ~/.claude/projects/");
    }
  }
  displayTable(records, full, noHeader, maxOutputLines) {
    if (records.length === 0) {
      console.log("No data found for the specified criteria.");
      return;
    }
    let displayRecords;
    if (full && records.length > 0) {
      const sortedRecords = records.sort((a, b) => b.hour.localeCompare(a.hour));
      const latestHour = new Date(sortedRecords[0].hour + ":00");
      const hoursToShow = 24;
      displayRecords = [];
      const recordMap = new Map;
      for (const record of sortedRecords) {
        recordMap.set(record.hour, record);
      }
      for (let i = 0;i < hoursToShow; i++) {
        const currentHour = new Date(latestHour.getTime() - i * 60 * 60 * 1000);
        const hourKey = `${currentHour.getFullYear()}-${String(currentHour.getMonth() + 1).padStart(2, "0")}-${String(currentHour.getDate()).padStart(2, "0")} ${String(currentHour.getHours()).padStart(2, "0")}:00`;
        if (recordMap.has(hourKey)) {
          displayRecords.push(recordMap.get(hourKey));
        } else {
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
      console.log(`
 \u256D\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u256E`);
      console.log(" \u2502                                         \u2502");
      console.log(" \u2502     ccmonitor - Hourly Usage Report     \u2502");
      console.log(" \u2502                                         \u2502");
      console.log(" \u2570\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u256F");
      console.log();
    }
    const line1 = "\u250C\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u252C\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u252C\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u252C\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u252C\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2510";
    const line2 = "\u2502 Hour             \u2502        Input \u2502       Output \u2502        Total \u2502 Cost (USD) \u2502";
    const line3 = "\u251C\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u253C\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u253C\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u253C\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u253C\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2524";
    console.log(line1);
    console.log(line2);
    console.log(line3);
    let totalInput = 0, totalOutput = 0, totalCost = 0, totalSessions = 0;
    let outputRowCount = 0;
    for (const record of displayRecords) {
      if (maxOutputLines && outputRowCount >= maxOutputLines) {
        break;
      }
      totalInput += record.inputTokens;
      totalOutput += record.outputTokens;
      totalCost += record.cost;
      totalSessions += record.sessionCount;
      const hour = record.hour.padEnd(16);
      const input = record.inputTokens.toLocaleString().padStart(12);
      const output = record.outputTokens.toLocaleString().padStart(12);
      const total = record.totalTokens.toLocaleString().padStart(12);
      const cost = `$${record.cost.toFixed(2)}`.padStart(10);
      console.log(`\u2502 ${hour} \u2502 ${input} \u2502 ${output} \u2502 ${total} \u2502 ${cost} \u2502`);
      outputRowCount++;
    }
    console.log("\u251C\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u253C\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u253C\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u253C\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u253C\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2524");
    const totalHour = "Total".padEnd(16);
    const totalInputStr = totalInput.toLocaleString().padStart(12);
    const totalOutputStr = totalOutput.toLocaleString().padStart(12);
    const totalTotalStr = (totalInput + totalOutput).toLocaleString().padStart(12);
    const totalCostStr = `$${totalCost.toFixed(2)}`.padStart(10);
    console.log(`\u2502 ${totalHour} \u2502 ${totalInputStr} \u2502 ${totalOutputStr} \u2502 ${totalTotalStr} \u2502 ${totalCostStr} \u2502`);
    console.log("\u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2534\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2534\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2534\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2534\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2518");
    console.log();
  }
  displayRollingUsage(records, full, noHeader, costLimit, maxOutputLines) {
    if (records.length === 0) {
      console.log("No data found for the specified criteria.");
      return;
    }
    if (!noHeader) {
      console.log(`
 \u256D\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u256E`);
      console.log(" \u2502                                           \u2502");
      console.log(" \u2502    ccmonitor - Limit Monitor (5-Hour)     \u2502");
      console.log(" \u2502                                           \u2502");
      console.log(" \u2570\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u256F");
      console.log();
    }
    const COST_LIMIT = costLimit || 10;
    const TIME_WINDOW = 5;
    const validRecords = records.filter((record) => record && record.hour);
    const sortedRecords = validRecords.sort((a, b) => b.hour.localeCompare(a.hour));
    let displayRecords;
    if (full && sortedRecords.length > 0) {
      const latestHour = new Date(sortedRecords[0].hour + ":00");
      const hoursToShow = 24;
      displayRecords = [];
      const recordMap = new Map;
      for (const record of sortedRecords) {
        recordMap.set(record.hour, record);
      }
      for (let i = 0;i < hoursToShow; i++) {
        const currentHour = new Date(latestHour.getTime() - i * 60 * 60 * 1000);
        const hourKey = `${currentHour.getFullYear()}-${String(currentHour.getMonth() + 1).padStart(2, "0")}-${String(currentHour.getDate()).padStart(2, "0")} ${String(currentHour.getHours()).padStart(2, "0")}:00`;
        if (recordMap.has(hourKey)) {
          displayRecords.push(recordMap.get(hourKey));
        } else {
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
    console.log("\u250C\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u252C\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u252C\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u252C\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2510");
    console.log("\u2502 Current Hour     \u2502 Hour Cost \u25025-Hour Cost\u2502 Limit Progress\u2502");
    console.log("\u251C\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u253C\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u253C\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u253C\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2524");
    let outputRowCount = 0;
    for (let i = 0;i < displayRecords.length; i++) {
      if (maxOutputLines && outputRowCount >= maxOutputLines) {
        break;
      }
      const currentRecord = displayRecords[i];
      const currentHour = new Date(currentRecord.hour + ":00");
      let rollingCost = 0;
      let rollingTokens = 0;
      for (const record of sortedRecords) {
        const recordHour = new Date(record.hour + ":00");
        const hoursDiff = (currentHour.getTime() - recordHour.getTime()) / (1000 * 60 * 60);
        if (hoursDiff >= 0 && hoursDiff < TIME_WINDOW) {
          rollingCost += record.cost;
          rollingTokens += record.totalTokens;
        }
      }
      const progressPercent = rollingCost / COST_LIMIT * 100;
      const progressBar = this.createProgressBar(progressPercent);
      const hour = currentRecord.hour.padEnd(16);
      const hourCost = `$${currentRecord.cost.toFixed(2)}`.padStart(9);
      const rollingCostStr = `$${rollingCost.toFixed(2)}`.padStart(9);
      const progressText = `${progressPercent.toFixed(1)}%`.padStart(6);
      const progress = `${progressText} ${progressBar}`.padEnd(13);
      const colorCode = progressPercent >= 80 ? "\x1B[31m" : progressPercent >= 60 ? "\x1B[33m" : "\x1B[32m";
      const resetCode = "\x1B[0m";
      console.log(`\u2502 ${hour} \u2502 ${hourCost} \u2502 ${rollingCostStr} \u2502${colorCode}${progress}${resetCode}\u2502`);
      outputRowCount++;
      if (progressPercent >= 90 && (!maxOutputLines || outputRowCount < maxOutputLines)) {
        console.log(`\u2502 ${" ".repeat(16)} \u2502 ${" ".repeat(9)} \u2502 ${" ".repeat(9)} \u2502 \uD83D\uDEA8 OVER LIMIT \u2502`);
        outputRowCount++;
      } else if (progressPercent >= 80 && (!maxOutputLines || outputRowCount < maxOutputLines)) {
        console.log(`\u2502 ${" ".repeat(16)} \u2502 ${" ".repeat(9)} \u2502 ${" ".repeat(9)} \u2502 \u26A0\uFE0F HIGH USAGE \u2502`);
        outputRowCount++;
      }
    }
    console.log("\u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2534\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2534\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2534\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2518");
    if (!noHeader) {
      console.log();
      console.log("\uD83D\uDCCA Claude Code Limits:");
      console.log(`   \u2022 Cost Limit: $${COST_LIMIT.toFixed(2)} per ${TIME_WINDOW}-hour window`);
      console.log(`   \u2022 Time Window: Rolling ${TIME_WINDOW}-hour period`);
      console.log("   \u2022 Color: \x1B[32mGreen (Safe)\x1B[0m | \x1B[33mYellow (Caution)\x1B[0m | \x1B[31mRed (Danger)\x1B[0m");
      console.log();
    }
  }
  createProgressBar(percent) {
    const width = 8;
    const filled = Math.max(0, Math.min(width, Math.round(percent / 100 * width)));
    const empty = Math.max(0, width - filled);
    return "\u2588".repeat(filled) + "\u2591".repeat(empty);
  }
  async generateReportOutputIncremental(options) {
    let estimatedTail = options.tail;
    if (options.rolling && options.tail) {
      estimatedTail = options.tail + 5;
    }
    await this.collectIncremental({ since: options.since, tail: estimatedTail });
    let records = Array.from(this.cachedHourlyStats.values()).filter((record) => record && record.hour);
    if (options.since) {
      records = records.filter((r) => r.hour >= options.since);
    }
    if (options.until) {
      records = records.filter((r) => r.hour <= options.until);
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
  async generateRollingOutputIncremental(options) {
    const estimatedTail = options.tail ? options.tail + 5 : undefined;
    await this.collectIncremental({ since: options.since, tail: estimatedTail });
    let records = Array.from(this.cachedHourlyStats.values()).filter((record) => record && record.hour);
    if (options.since) {
      records = records.filter((r) => r.hour >= options.since);
    }
    if (options.until) {
      records = records.filter((r) => r.hour <= options.until);
    }
    if (options.json) {
      return JSON.stringify(records, null, 2);
    }
    return this.generateRollingUsageOutput(records, options.full, options.noHeader, options.costLimit, options.tail || options.maxDataRows);
  }
  async generateReportOutput(options) {
    await this.initializeCache();
    let estimatedTail = options.tail;
    if (options.rolling && options.tail) {
      estimatedTail = options.tail + 5;
    }
    await this.collectIncremental({ since: options.since, tail: estimatedTail });
    try {
      let records = Array.from(this.cachedHourlyStats.values()).filter((record) => record && record.hour);
      if (options.since) {
        records = records.filter((r) => r.hour >= options.since);
      }
      if (options.until) {
        records = records.filter((r) => r.hour <= options.until);
      }
      if (options.json) {
        return JSON.stringify(records, null, 2);
      }
      if (options.rolling) {
        return this.generateRollingUsageOutput(records, options.full, options.noHeader, options.costLimit, options.tail || options.maxDataRows);
      } else {
        return this.generateTableOutput(records, options.full, options.noHeader, options.tail);
      }
    } catch (error) {
      return "\u274C No usage data found. Please ensure Claude Code has been used and logs exist in ~/.claude/projects/";
    }
  }
  generateRollingUsageOutput(records, full, noHeader, costLimit, maxOutputLines) {
    if (records.length === 0) {
      return "No data found for the specified criteria.";
    }
    let output = "";
    if (!noHeader) {
      output += ` \u256D\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u256E
`;
      output += ` \u2502                                           \u2502
`;
      output += ` \u2502    ccmonitor - Limit Monitor (5-Hour)     \u2502
`;
      output += ` \u2502                                           \u2502
`;
      output += ` \u2570\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u256F
`;
      output += `
`;
    }
    const COST_LIMIT = costLimit || 10;
    const TIME_WINDOW = 5;
    const validRecords = records.filter((record) => record && record.hour);
    const sortedRecords = validRecords.sort((a, b) => b.hour.localeCompare(a.hour));
    let displayRecords;
    if (full && sortedRecords.length > 0) {
      const latestHour = new Date(sortedRecords[0].hour + ":00");
      const hoursToShow = 24;
      displayRecords = [];
      const recordMap = new Map;
      for (const record of sortedRecords) {
        recordMap.set(record.hour, record);
      }
      for (let i = 0;i < hoursToShow; i++) {
        const currentHour = new Date(latestHour.getTime() - i * 60 * 60 * 1000);
        const hourKey = `${currentHour.getFullYear()}-${String(currentHour.getMonth() + 1).padStart(2, "0")}-${String(currentHour.getDate()).padStart(2, "0")} ${String(currentHour.getHours()).padStart(2, "0")}:00`;
        if (recordMap.has(hourKey)) {
          displayRecords.push(recordMap.get(hourKey));
        } else {
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
    output += `\u250C\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u252C\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u252C\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u252C\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2510
`;
    output += `\u2502 Current Hour     \u2502 Hour Cost \u25025-Hour Cost\u2502 Limit Progress\u2502
`;
    output += `\u251C\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u253C\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u253C\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u253C\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2524
`;
    let outputRowCount = 0;
    for (let i = 0;i < displayRecords.length; i++) {
      if (maxOutputLines && outputRowCount >= maxOutputLines) {
        break;
      }
      const currentRecord = displayRecords[i];
      const currentHour = new Date(currentRecord.hour + ":00");
      let rollingCost = 0;
      let rollingTokens = 0;
      for (const record of sortedRecords) {
        const recordHour = new Date(record.hour + ":00");
        const hoursDiff = (currentHour.getTime() - recordHour.getTime()) / (1000 * 60 * 60);
        if (hoursDiff >= 0 && hoursDiff < TIME_WINDOW) {
          rollingCost += record.cost;
          rollingTokens += record.totalTokens;
        }
      }
      const progressPercent = rollingCost / COST_LIMIT * 100;
      const progressBar = this.createProgressBar(progressPercent);
      const hour = currentRecord.hour.padEnd(16);
      const hourCost = `$${currentRecord.cost.toFixed(2)}`.padStart(9);
      const rollingCostStr = `$${rollingCost.toFixed(2)}`.padStart(9);
      const progressText = `${progressPercent.toFixed(1)}%`.padStart(6);
      const progress = `${progressText} ${progressBar}`.padEnd(13);
      const colorCode = progressPercent >= 80 ? "\x1B[31m" : progressPercent >= 60 ? "\x1B[33m" : "\x1B[32m";
      const resetCode = "\x1B[0m";
      output += `\u2502 ${hour} \u2502 ${hourCost} \u2502 ${rollingCostStr} \u2502${colorCode}${progress}${resetCode}\u2502
`;
      outputRowCount++;
      if (progressPercent >= 90 && (!maxOutputLines || outputRowCount < maxOutputLines)) {
        output += `\u2502 ${" ".repeat(16)} \u2502 ${" ".repeat(9)} \u2502 ${" ".repeat(9)} \u2502 \uD83D\uDEA8 OVER LIMIT \u2502
`;
        outputRowCount++;
      } else if (progressPercent >= 80 && (!maxOutputLines || outputRowCount < maxOutputLines)) {
        output += `\u2502 ${" ".repeat(16)} \u2502 ${" ".repeat(9)} \u2502 ${" ".repeat(9)} \u2502 \u26A0\uFE0F HIGH USAGE \u2502
`;
        outputRowCount++;
      }
    }
    output += `\u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2534\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2534\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2534\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2518
`;
    if (!noHeader) {
      output += `
\uD83D\uDCCA Claude Code Limits:
`;
      output += "   \u2022 Cost Limit: $" + COST_LIMIT.toFixed(2) + ` per 5-hour window
`;
      output += `   \u2022 Time Window: Rolling 5-hour period
`;
      output += `   \u2022 Color: \x1B[32mGreen (Safe)\x1B[0m | \x1B[33mYellow (Caution)\x1B[0m | \x1B[31mRed (Danger)\x1B[0m
`;
    }
    return output;
  }
  generateTableOutput(records, full, noHeader, maxOutputLines) {
    return "Table output not implemented yet for buffered mode";
  }
  async watchMode(options) {
    let isRunning = true;
    const shutdown = () => {
      isRunning = false;
      console.log(`
\uD83D\uDC4B Watch mode stopped`);
      process.exit(0);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
    console.clear();
    console.log(`\uD83D\uDD04 Starting watch mode (refresh every ${options.interval}s)`);
    console.log("   Press Ctrl+C to stop");
    console.log("   Initializing cache for efficient monitoring...");
    await this.initializeCache();
    await new Promise((resolve2) => setTimeout(resolve2, 1000));
    let isFirstRun = true;
    while (isRunning) {
      try {
        const now = new Date;
        const terminalRows = process.stdout.rows || 24;
        const reservedRows = options.noHeader ? 1 + 1 + 3 + 1 + 1 : 1 + 1 + 5 + 1 + 3 + 1 + 1 + 4;
        const availableDataRows = Math.max(1, terminalRows - reservedRows);
        const effectiveTail = options.tail ? Math.min(options.tail, availableDataRows) : availableDataRows;
        const estimatedTail = effectiveTail + 5;
        await this.collectIncremental({ since: options.since, tail: estimatedTail });
        let records = Array.from(this.cachedHourlyStats.values()).filter((record) => record && record.hour);
        if (options.since) {
          records = records.filter((r) => r.hour >= options.since);
        }
        if (options.until) {
          records = records.filter((r) => r.hour <= options.until);
        }
        const output = this.generateRollingUsageOutput(records, options.full, options.noHeader, options.costLimit, effectiveTail);
        const timestamp = `\u23F0 Last updated: ${now.toLocaleTimeString()} (refreshing every ${options.interval}s)`;
        const completeOutput = timestamp + `

` + output.trimEnd();
        process.stdout.write("\x1B[2J\x1B[3J\x1B[H" + completeOutput + `
`);
        isFirstRun = false;
      } catch (error) {
        console.error("\u274C Error during watch update:", error);
        console.error("Error details:", error.message);
        console.error("Stack trace:", error.stack);
      }
      await new Promise((resolve2) => setTimeout(resolve2, options.interval * 1000));
    }
  }
  getCacheSize() {
    return this.cachedHourlyStats.size;
  }
  getSeenMessageIds() {
    return this.seenMessageIds;
  }
  getCachedStats() {
    return this.cachedHourlyStats;
  }
  async initializeCache() {
    this.cachedHourlyStats.clear();
    this.seenMessageIds.clear();
    try {
      const content = await import_promises.readFile(this.logFile, "utf-8");
      const lines = content.trim().split(`
`);
      for (const line of lines) {
        try {
          const record = JSON.parse(line);
          const hourStats = {
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
        } catch (e) {}
      }
    } catch (error) {}
    const entries = await this.loadClaudeData();
    for (const entry of entries) {
      if (entry.message?.id) {
        this.seenMessageIds.add(entry.message.id);
      }
    }
  }
}
async function main() {
  let args = process.argv.slice(2);
  let watchIndex = -1;
  for (let i = 0;i < args.length; i++) {
    if (args[i] === "--watch") {
      watchIndex = i;
      break;
    }
  }
  if (watchIndex !== -1) {
    if (watchIndex + 1 >= args.length || args[watchIndex + 1].startsWith("-")) {
      args.splice(watchIndex + 1, 0, "60");
    }
  }
  const { values, positionals } = import_util.parseArgs({
    args,
    options: {
      path: { type: "string", short: "p" },
      "claude-dir": { type: "string" },
      since: { type: "string", short: "s" },
      until: { type: "string", short: "u" },
      json: { type: "boolean", short: "j" },
      tail: { type: "string", short: "t" },
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
      rolling: { type: "boolean", short: "r" },
      full: { type: "boolean", short: "f" },
      "no-header": { type: "boolean" },
      "cost-limit": { type: "string" },
      watch: { type: "string" }
    },
    allowPositionals: true
  });
  if (values.help) {
    console.log(`
ccmonitor - Claude Code \u4F7F\u7528\u91CF\u76E3\u8996\u30C4\u30FC\u30EB

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
    console.log("ccmonitor v3.5.0");
    return;
  }
  let costLimit = 10;
  if (values["cost-limit"]) {
    const parsedCostLimit = parseFloat(values["cost-limit"]);
    if (isNaN(parsedCostLimit) || parsedCostLimit <= 0 || parsedCostLimit > 1e4) {
      console.error("\u274C Error: --cost-limit must be a number between 1 and 10000");
      process.exit(1);
    }
    costLimit = parsedCostLimit;
  }
  const command = positionals[0] || "report";
  const monitor = new ClaudeUsageMonitor(values.path, values["claude-dir"]);
  switch (command) {
    case "report":
      await monitor.report({
        since: values.since,
        until: values.until,
        json: values.json,
        tail: values.tail ? parseInt(values.tail) : undefined,
        rolling: values.rolling,
        full: values.full,
        noHeader: values["no-header"],
        costLimit
      });
      break;
    case "rolling":
      if (values.watch !== undefined) {
        const watchInterval = values.watch === "" ? 60 : parseInt(values.watch);
        if (isNaN(watchInterval) || watchInterval < 5) {
          console.error("\u274C Error: --watch interval must be 5 seconds or more");
          process.exit(1);
        }
        await monitor.watchMode({
          interval: watchInterval,
          since: values.since,
          until: values.until,
          tail: values.tail ? parseInt(values.tail) : undefined,
          full: values.full,
          noHeader: values["no-header"],
          costLimit
        });
      } else {
        await monitor.report({
          since: values.since,
          until: values.until,
          json: values.json,
          tail: values.tail ? parseInt(values.tail) : undefined,
          rolling: true,
          full: values.full,
          noHeader: values["no-header"],
          costLimit
        });
      }
      break;
    default:
      console.error(`Unknown command: ${command}`);
      console.error("Available commands: report, rolling");
      console.error("Run --help for usage information");
      process.exit(1);
  }
}
if (require.main == module) {
  main().catch((error) => {
    console.error("\u274C Fatal error in ccmonitor:", error);
    console.error("Stack trace:", error.stack);
    process.exit(1);
  });
}

