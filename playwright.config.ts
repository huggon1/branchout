import {defineConfig} from '@playwright/test';
export default defineConfig({
 testDir:'tests',testMatch:'**/*.spec.ts',
 use:{channel:'chrome',baseURL:'http://127.0.0.1:4329',viewport:{width:1440,height:1000}},
 webServer:{command:'npm run dev -- --port 4329 --strictPort',url:'http://127.0.0.1:4329',reuseExistingServer:false},
 workers:1,reporter:'list'
});
