#!/usr/bin/env node

import { Command } from 'commander';

const program = new Command();

program
  .name('psa')
  .description('PSA Tool CLI')
  .version('1.0.0');

program
  .command('template')
  .description('List PSA templates')
  .action(() => {
    console.log('PSA Templates:');
    console.log('- project-proposal');
    console.log('- sow');
    console.log('- meeting-notes');
  });

program
  .command('rag')
  .description('RAG pipeline commands')
  .action(() => {
    console.log('RAG pipeline ready');
  });

program.parse();
