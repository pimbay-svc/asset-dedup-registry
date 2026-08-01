#!/usr/bin/env node
// Strips leading indentation from Stryker's incremental.json snapshot after `test:mutation:snapshot`
// regenerates it. Structural whitespace only, one line per entry stays intact — JSON string values can't
// contain a literal newline (must be \n-escaped), so trimming leading whitespace per physical line is safe
// and keeps the file diffable per mutant/entry instead of collapsing it to one unreadable line.
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const target = join(dirname(fileURLToPath(import.meta.url)), 'incremental.json');
const content = readFileSync(target, 'utf8');
writeFileSync(target, content.replace(/^[ \t]+/gm, ''));
