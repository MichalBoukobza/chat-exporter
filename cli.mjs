#!/usr/bin/env node
// Command-line export: node cli.mjs <share-url> [--out dir] [--json] [--txt] [--stdout]

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { extractFromUrl } from './src/extract.mjs';
import { ExportError } from './src/providers.mjs';
import { PROVIDER_LABELS, toJson, toMarkdown, toPlainText } from './src/lib/conversation.mjs';

function parseArgs(argv) {
  const flags = { out: 'exports', json: false, txt: false, stdout: false, allowAnyHost: false, provider: null };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--out' || arg === '-o') flags.out = argv[++i] || flags.out;
    else if (arg === '--json') flags.json = true;
    else if (arg === '--txt') flags.txt = true;
    else if (arg === '--stdout') flags.stdout = true;
    else if (arg === '--allow-any-host') flags.allowAnyHost = true;
    else if (arg === '--provider') flags.provider = argv[++i] || null;
    else if (arg === '--help' || arg === '-h') flags.help = true;
    else if (!arg.startsWith('-')) positional.push(arg);
  }
  return { flags, positional };
}

function slugify(text) {
  return String(text || 'conversation')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'conversation';
}

const { flags, positional } = parseArgs(process.argv.slice(2));

if (flags.help || !positional.length) {
  console.log(`
  Chat Exporter CLI

  Usage:
    node cli.mjs <share-url> [options]

  Options:
    -o, --out <dir>     output directory (default: exports)
        --json          also write a .json file
        --txt           also write a .txt file
        --stdout        print Markdown to stdout instead of files
        --provider <k>  force provider: chatgpt | claude | gemini | deepseek
        --allow-any-host scrape any public https page
    -h, --help          show this help

  Examples:
    node cli.mjs https://chatgpt.com/share/xxxx --json
    node cli.mjs https://claude.ai/share/xxxx --stdout

  Private conversations need the browser capture in the web UI (npm start).
`);
  process.exit(positional.length ? 0 : 1);
}

try {
  const { conversation } = await extractFromUrl(positional[0], {
    providerHint: flags.provider,
    allowAnyHost: flags.allowAnyHost,
  });

  const markdown = toMarkdown(conversation);
  const label = PROVIDER_LABELS[conversation.provider] || 'Chat';

  if (flags.stdout) {
    process.stdout.write(markdown);
  } else {
    await mkdir(flags.out, { recursive: true });
    const stamp = new Date().toISOString().slice(0, 10);
    const base = path.join(flags.out, `${slugify(conversation.title)}-${conversation.provider}-${stamp}`);
    const written = [];
    await writeFile(`${base}.md`, markdown, 'utf8');
    written.push(`${base}.md`);
    if (flags.txt) {
      await writeFile(`${base}.txt`, toPlainText(conversation), 'utf8');
      written.push(`${base}.txt`);
    }
    if (flags.json) {
      await writeFile(`${base}.json`, toJson(conversation), 'utf8');
      written.push(`${base}.json`);
    }
    console.log(`${label}: ${conversation.stats.messages} messages, ${conversation.stats.words} words (via ${conversation.method})`);
    for (const file of written) console.log(`  wrote ${file}`);
  }
} catch (error) {
  if (error instanceof ExportError) {
    console.error(`\n  ${error.message}`);
    if (error.hint) console.error(`  ${error.hint}`);
    for (const suggestion of error.suggestions || []) console.error(`  - ${suggestion}`);
    if (error.attempts?.length) {
      console.error('\n  Attempts:');
      for (const attempt of error.attempts) {
        console.error(`    ${attempt.strategy}: ${attempt.error || attempt.detail || attempt.status || ''}`);
      }
    }
    process.exitCode = 1;
  } else {
    console.error(error);
    process.exitCode = 1;
  }
}