import {defineConfig} from '@playwright/test';import {readFileSync} from 'node:fs';
const session=JSON.parse(readFileSync('/tmp/monocle-help-20261029/hanamaru-stack/session.json','utf8'));if(new URL(session.web).hostname!=='127.0.0.1')throw Error('Loopback only');
export default defineConfig({testDir:'./e2e',testMatch:'help.spec.ts',workers:1,retries:0,timeout:60000,reporter:[['line'],['json',{outputFile:'../../test-results/help-results.json'}]],use:{baseURL:session.web,channel:'chrome',locale:'ja-JP',timezoneId:'Asia/Tokyo',trace:'off',video:'off'}});
