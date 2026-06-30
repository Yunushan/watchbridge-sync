#!/usr/bin/env node
import { planSync } from '@watchbridge/core';

const [command, source, target, feature] = process.argv.slice(2);

if (command === 'plan' && source && target && feature) {
  const ops = planSync({
    source: source as never,
    target: target as never,
    dryRun: true,
    selection: { [feature]: true }
  });
  console.log(JSON.stringify(ops, null, 2));
} else {
  console.log(`WatchBridge Sync CLI

Usage:
  watchbridge plan letterboxd imdb ratings`);
}
