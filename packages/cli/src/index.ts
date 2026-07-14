#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { getCapabilities, planSync, SERVICE_DEFINITIONS } from '@watchbridge/core';
import { parseMappedCsv, type MappedCsvImportConfig } from '@watchbridge/connectors';

export interface CliIo {
  readText(path: string): Promise<string>;
  writeLine(message: string): void;
}

const defaultIo: CliIo = {
  readText: (path) => readFile(path, 'utf8'),
  writeLine: (message) => console.log(message)
};

export async function run(args: string[], io: CliIo = defaultIo): Promise<void> {
  const [command, source, target, feature] = args;
  if (command === 'plan' && source && target && feature) {
    const ops = planSync({
      source: source as never,
      target: target as never,
      dryRun: true,
      selection: { [feature]: true }
    });
    io.writeLine(JSON.stringify(ops, null, 2));
    return;
  }

  if (command === 'services') {
    io.writeLine(JSON.stringify(SERVICE_DEFINITIONS.map((service) => ({
      ...service,
      capabilities: getCapabilities(service.id)
    })), null, 2));
    return;
  }

  if (command === 'import-mapped-csv' && source && target) {
    const [csv, configText] = await Promise.all([io.readText(source), io.readText(target)]);
    const config = JSON.parse(configText) as MappedCsvImportConfig;
    io.writeLine(JSON.stringify(parseMappedCsv(csv, config), null, 2));
    return;
  }

  io.writeLine(`WatchBridge Sync CLI

Usage:
  watchbridge plan letterboxd imdb ratings
  watchbridge services
  watchbridge import-mapped-csv export.csv mapping.json

The mapping JSON format is documented in docs/MANUAL_CSV_IMPORT.md.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void run(process.argv.slice(2));
}
