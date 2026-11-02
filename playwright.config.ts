import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'tests',testMatch:'**/*.browser.ts',workers:1,retries:0,use:{baseURL:process.env.UM_PROOF_APP_ORIGIN||'http://127.0.0.1:4419',channel:'chrome',headless:true},reporter:[['list']],timeout:30000});
